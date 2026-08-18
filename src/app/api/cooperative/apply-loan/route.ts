export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { canTransactAsMember, NOT_A_TRANSACTING_MEMBER_MESSAGE } from "@/lib/cooperative-membership-status";

import { calculateRepaymentTerms } from "@/lib/loan-terms";
import { isEligibleForLoan } from "@/lib/cooperative-tiers";
import { FieldValue } from "@/lib/firestore-compat";
import { withRateLimit } from "@/lib/rate-limit";

/**
 * API Route: Submit Loan Application
 * Rate-limited to prevent duplicate/spam submissions.
 */
async function applyLoanHandler(request: NextRequest) {
    try {
        const session = (await requireSession()).session;
        if (!session?.user) {
            return NextResponse.json(
                { success: false, message: "Unauthorized" },
                { status: 401 }
            );
        }

        const userId = session.user.id;
        const body = await request.json();
        const { productId, amount: rawAmount, purpose, guarantorName, guarantorPhone, guarantorEmail, guarantorRelationship } = body;

        // Validate inputs
        if (!productId || !rawAmount || !purpose || !guarantorName || !guarantorPhone) {
            return NextResponse.json(
                { success: false, message: "Missing required fields (including guarantor name and phone)" },
                { status: 400 }
            );
        }

        // Coerce the amount ONCE, here, and refuse anything that is not a
        // positive finite number.
        //
        // `amount` came off a JSON body and was used raw. Every check below it
        // is a comparison, and a comparison against a non-number is false, not
        // an error — so `amount: "abc"` was neither less than minAmount nor
        // greater than maxAmount, and `"abc" * 2` is NaN, which no savings
        // balance is less than. Both the range check and the savings
        // requirement passed. What stopped it was calculateRepaymentTerms
        // throwing much further down, which surfaced as a 500 "Internal server
        // error" — the checks themselves had already been bypassed.
        //
        // A string of digits was worse: "5000" coerces through every comparison
        // and would have been STORED as a string on the application, for the
        // approval and disbursement paths to do arithmetic on.
        //
        // Validating the type at the boundary is what makes the guards below
        // mean what they read as.
        const amount = typeof rawAmount === "number" ? rawAmount : Number(rawAmount);
        if (!Number.isFinite(amount) || amount <= 0) {
            return NextResponse.json(
                { success: false, message: "Loan amount must be a positive number" },
                { status: 400 }
            );
        }
        if (typeof guarantorName !== "string" || typeof guarantorPhone !== "string") {
            // .trim() is called on both below; a non-string there is a 500.
            return NextResponse.json(
                { success: false, message: "Guarantor name and phone must be text" },
                { status: 400 }
            );
        }

        // Check membership status (Admin SDK)
        const membershipDoc = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(userId).get();

        if (!membershipDoc.exists) {
            return NextResponse.json(
                { success: false, message: "You must be a cooperative member to apply for loans" },
                { status: 403 }
            );
        }

        const membershipData = membershipDoc.data()!;

        // "approved" is the LEGACY spelling of "active", not a lesser status —
        // the member directory and the admin list both query for either, under
        // the comment "both are fully approved members". Refusing it here left a
        // legacy member holding the role, listed in the directory and carrying
        // an ID card, unable to do this. One rule now, in
        // lib/cooperative-membership-status.ts.
        if (!canTransactAsMember(membershipData)) {
            return NextResponse.json(
                { success: false, message: NOT_A_TRANSACTING_MEMBER_MESSAGE },
                { status: 403 }
            );
        }


        // Get loan product details (Admin SDK)
        const productDoc = await db.collection(COLLECTIONS.LOAN_PRODUCTS).doc(productId).get();

        if (!productDoc.exists) {
            return NextResponse.json(
                { success: false, message: "Loan product not found" },
                { status: 404 }
            );
        }

        const product = productDoc.data()!;

        // Validate amount range.
        //
        // The bounds are coerced before comparing for the same reason the
        // amount is: a product saved without minAmount/maxAmount made both
        // comparisons false — `x < undefined` is false, not an error — so the
        // range check silently passed everything, and the error message it
        // would have produced called .toLocaleString() on undefined. An
        // unusable bound is a broken product, not an unbounded one.
        const minAmount = Number(product.minAmount);
        const maxAmount = Number(product.maxAmount);
        if (!Number.isFinite(minAmount) || !Number.isFinite(maxAmount) || minAmount > maxAmount) {
            logger.error("[apply-loan] Loan product has unusable amount bounds", {
                productId, minAmount: product.minAmount, maxAmount: product.maxAmount,
            });
            return NextResponse.json(
                { success: false, message: "This loan product is not currently available" },
                { status: 409 }
            );
        }
        if (amount < minAmount || amount > maxAmount) {
            return NextResponse.json(
                {
                    success: false,
                    message: `Loan amount must be between ₦${minAmount.toLocaleString()} and ₦${maxAmount.toLocaleString()}`
                },
                { status: 400 }
            );
        }

        // ELIGIBILITY CHECK #1: savings must cover twice the loan.
        //
        // Two corrections, both in the same two lines.
        //
        // WRONG FIELD. This read `totalContributions` — the CUMULATIVE LIFETIME
        // total, incremented on every contribution and decremented nowhere in
        // src/. A member who paid in ₦100,000 and had already withdrawn ₦95,000
        // still reported ₦100,000 here and qualified for a ₦50,000 loan against
        // ₦5,000 of actual security. `savingsBalance` is the spendable figure,
        // and it is what the withdraw route was corrected to for this exact
        // reason (see its comment) and what the member-facing loan action uses.
        //
        // OPEN-CODED POLICY. The 2× requirement was written out here as
        // `amount * 2`, a third copy of a rule that already lives in
        // lib/cooperative-tiers.ts as maxLoanMultiplier: 0.5. That constant was
        // corrected from 3 to 0.5; copies like this one are why such a
        // correction does not take. isEligibleForLoan is the single place the
        // rule is expressed, so a future change to it reaches every path at
        // once — including the minimum-contribution floor, which this route
        // never applied at all.
        const totalSavings = Number(membershipData.savingsBalance) || 0;
        const eligibility = isEligibleForLoan(totalSavings, amount, 0);
        if (!eligibility.eligible) {
            return NextResponse.json(
                { success: false, message: eligibility.reason ?? "You are not eligible for this loan amount." },
                { status: 403 }
            );
        }

        // ELIGIBILITY CHECK #2: Check for existing active loans (Admin SDK)
        const existingLoansSnapshot = await db.collection(COLLECTIONS.LOAN_APPLICATIONS)
            .where("userId", "==", userId)
            .where("status", "in", ["pending", "approved", "active"])
            .get();

        if (!existingLoansSnapshot.empty) {
            return NextResponse.json(
                {
                    success: false,
                    message: "You already have an active or pending loan. Please clear existing loans before applying for a new one."
                },
                { status: 403 }
            );
        }

        // ELIGIBILITY CHECK #3: Check payment status (no outstanding debts)
        if (membershipData.paymentStatus !== "completed") {
            return NextResponse.json(
                {
                    success: false,
                    message: "Your membership payment is not complete. Please settle all outstanding payments before applying for loans."
                },
                { status: 403 }
            );
        }

        // product.interestRate is a MONTHLY percentage (see cooperative-tiers.ts).
        // This previously divided by 12 as well, treating it as an annual rate —
        // so the monthly payment quoted here was a twelfth of what the repayment
        // schedule generator, which reads the same field as monthly, went on to bill.
        //
        // The annuity formula was also inlined here, and divided by zero on an
        // interest-free product: at r = 0 the denominator (1+r)^n - 1 is 0, and
        // 0/0 is NaN, so `monthlyPayment: NaN` was written onto the loan
        // application. Nothing downstream would have flagged it.
        //
        // lib/loan-terms.ts already solves this — it validates its inputs, and
        // its comment names this exact case: "A zero rate is interest-free: the
        // annuity formula divides by zero there." It also runs in kobo, so a
        // full schedule does not drift. Using it rather than keeping a third
        // copy of the same maths.
        if (!Number.isFinite(product.interestRate) || product.interestRate < 0
            || !Number.isInteger(product.durationMonths) || product.durationMonths < 1) {
            // A product predating the validation added to loan-products.ts.
            // Refusing is right: quoting a payment from unusable terms is worse
            // than declining to quote one.
            logger.error("[apply-loan] Loan product has unusable terms", {
                productId,
                interestRate: product.interestRate,
                durationMonths: product.durationMonths,
            });
            return NextResponse.json(
                { success: false, message: "This loan product is not currently available" },
                { status: 409 }
            );
        }

        const terms = calculateRepaymentTerms(amount, product.durationMonths, product.interestRate);
        const monthlyPayment = terms.monthlyPayment;

        // Create loan application (Admin SDK)
        const applicationRef = db.collection(COLLECTIONS.LOAN_APPLICATIONS).doc();
        const applicationData = {
            userId,
            productId,
            productName: product.name,
            amount,
            purpose,
            interestRate: product.interestRate,
            durationMonths: product.durationMonths,
            monthlyPayment: Math.round(monthlyPayment),
            status: "pending",
            guarantorName: guarantorName.trim(),
            guarantorPhone: guarantorPhone.trim(),
            guarantorEmail: guarantorEmail?.trim() || "",
            guarantorRelationship: guarantorRelationship || "",
            guarantorVerified: false,
            appliedAt: FieldValue.serverTimestamp(),
            createdAt: FieldValue.serverTimestamp(),
        };

        await applicationRef.set(applicationData);

        return NextResponse.json({
            success: true,
            message: "Loan application submitted successfully",
            applicationId: applicationRef.id,
            data: {
                ...applicationData,
                appliedAt: new Date().toISOString(),
                createdAt: new Date().toISOString(),
            }
        });
    } catch (error) {
        logger.error("Failed to submit loan application:", error);
        return NextResponse.json(
            { success: false, message: "Internal server error" },
            { status: 500 }
        );
    }
}

export const POST = withRateLimit(applyLoanHandler);
