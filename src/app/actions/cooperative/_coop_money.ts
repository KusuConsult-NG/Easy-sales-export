"use server";

import { supabaseDb as db } from "@/lib/supabase-db";
import { isPaymentBypassAccount } from "@/lib/payment-bypass";
import { autoProvisionZereCooperative } from "@/lib/cooperative-provisioning";
import { runQueryWithRetry } from "@/lib/firestore-utils";
import { logger } from '@/lib/logger';
import { FieldValue } from "@/lib/firestore-compat";
import { getBaseUrl } from "@/lib/server-utils";
import { initializePaystackPayment, nairaToKobo } from "@/lib/paystack-server";
import { requireSession } from "@/lib/session-guard";
import { logAuditAction } from "@/app/actions/audit";
import { invalidateCooperativeCache, invalidateAdminGlobalStats } from "@/lib/cache-invalidation";
import { COLLECTIONS } from "@/lib/types/firestore";
import { debitJsonbBalance, claimSingleOpenLoanApplication } from "@/lib/wallet-ledger";
import { COOPERATIVE_CONFIG } from "@/lib/constants";
import { contributionSchema, loanApplicationSchema, fixedSavingsSchema, type MembershipRegistrationState, type LoanApplicationState, type FixedSavingsState, type WithdrawalActionState } from "@/lib/types/cooperative";
import { withFlexibleSafeAction } from "@/lib/safe-action";
import { parseFormData } from "@/lib/form-validation";
import type { CooperativeTransaction, MakeContributionState, GetTransactionsState } from "@/lib/types/cooperative";
import { serializeDocs } from "@/lib/firestore-serialize";
import { revalidatePath } from "next/cache";
import { calculateRepaymentTerms } from "@/lib/loan-terms";
import { parseCurrencyStringToFloat } from "@/lib/utils";

/**
 * Server Actions for Cooperative Management
 * 
 * Handles cooperative membership, contributions, and transaction history.
 * Works with the existing submitWithdrawalAction for withdrawal requests.
 * 
 * PHASE 2 PRD ADDITIONS:
 * - Membership registration with Paystack integration
 * - Fixed savings management
 * - Loan application and management
 */


// ============================================
// MEMBERSHIP REGISTRATION (PRD Phase 2)
// =========================================


/**
 * Register a new cooperative member with Paystack payment integration
 */
/**
 * 1. INITIATE PAYMENT (Step 1)
 * Creates a partial membership record and initializes Paystack
 */
async function _initiateCooperativePaymentAction(
    tier: "Member" = "Member"
): Promise<MembershipRegistrationState> { try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        if (!session?.user) { return { error: "You must be logged in", success: false as const, data: null };
        }

        const userId = session.user.id;
        
        // Payment bypass — see src/lib/payment-bypass.ts for who and why.
        if (isPaymentBypassAccount(session.user.email)) {
            await autoProvisionZereCooperative(userId, session.user.email);
            return {
                error: null,
                success: true as const,
                meta: null,
                data: { message: "Payment already completed", paymentUrl: null, redirectTo: "/cooperatives/onboarding" } as any
            };
        }
        const registrationFee = COOPERATIVE_CONFIG.registrationFee; // Reduced for low-barrier entry

        // Create or update partial membership record
        const memberRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(userId);

        // Check if already active or paid
        const memberDoc = await runQueryWithRetry(() => memberRef.get());
        if (memberDoc.exists) { const data = memberDoc.data();
            if (data?.membershipStatus === "active") {
                return {
                    error: null,
                    success: true as const,
                    meta: null,
                    data: { message: "You are already an active cooperative member.", paymentUrl: null, redirectTo: "/cooperatives/dashboard" } as any
                };
            }
            if (data?.paymentStatus === "completed") {
                // Payment was completed — guide them to onboarding rather than showing a raw error.
                return {
                    error: null,
                    success: true as const,
                    meta: null,
                    data: { message: "Payment already completed", paymentUrl: null, redirectTo: "/cooperatives/onboarding" } as any
                };
            }
        }

        await runQueryWithRetry(() => memberRef.set({ userId,
            membershipTier: tier,
            registrationFee,
            membershipStatus: "pending",
            // Only set paymentStatus to pending if they haven't already paid
            paymentStatus: memberDoc.exists && memberDoc.data()?.paymentStatus === "completed" ? "completed" : "pending",
            updatedAt: FieldValue.serverTimestamp(),
            // Preserve creation date if exists
            createdAt: memberDoc.exists ? memberDoc.data()?.createdAt : FieldValue.serverTimestamp() }, { merge: true }));

        const baseUrl = await getBaseUrl();
        const callbackUrl = `${baseUrl}/cooperatives/payment/callback`;

        // Initialize payment with Paystack
        const { authorizationUrl, reference } = await initializePaystackPayment(
            session.user.email || "",
            nairaToKobo(registrationFee),
            {
                userId,
                membershipId: userId,
                membershipTier: tier,
                type: "cooperative_membership_registration",
                callback_url: callbackUrl
            },
            callbackUrl
        );

        // Save reference
        await runQueryWithRetry(() => memberRef.update({ paymentReference: reference }));

        return { error: null,  success: true as const,
            meta: null
        , data: { message: "Action successful", paymentUrl: authorizationUrl } as any };

    } catch (error) { logger.error("Initiate cooperative payment failed:", {
            tier,
            error: error instanceof Error ? error.message : String(error)
        });
        const errMsg = error instanceof Error ? error.message : String(error);
        const isTransient = errMsg.includes("Premature close") || 
                            errMsg.includes("socket hang up") || 
                            errMsg.includes("ECONNRESET") ||
                            errMsg.includes("Client network socket disconnected") ||
                            errMsg.includes("FetchError") ||
                            errMsg.includes("fetch failed") ||
                            errMsg.includes("Connection closed") ||
                            errMsg.includes("Socket closed") ||
                            errMsg.includes("UNAVAILABLE") ||
                            errMsg.includes("stream terminated") ||
                            errMsg.includes("ERR_STREAM_PREMATURE_CLOSE");
        const userFriendlyMessage = isTransient 
            ? "A temporary connection issue occurred. Please try again." 
            : (errMsg && errMsg.length > 2 && !errMsg.includes("[object") ? errMsg : "Failed to initiate payment");
        return { error: userFriendlyMessage, success: false as const, data: null };
    }
}

export const initiateCooperativePaymentAction = withFlexibleSafeAction("initiateCooperativePaymentAction", _initiateCooperativePaymentAction);


async function _makeContributionAction(
    prevState: MakeContributionState,
    formData: FormData
): Promise<MakeContributionState> { try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required"};
        const { session } = sessionResult;
        if (!session?.user) { return { error: "You must be logged in to make a contribution", success: false as const, data: null };
        }

        const userId = session.user.id;

        // Strip currency formatting before validating.
        //
        // contributionSchema now coerces, which fixes the string-vs-number
        // rejection that broke every contribution. Coercion alone is not
        // enough for a formatted amount though: Number("₦10,000") is NaN, and
        // the amount field is currency-formatted in the UI. The loan path
        // already did this; this one did not, which would have left a subset of
        // submissions failing after the coercion fix and looked like the bug
        // was only half-fixed.
        const contribAmount = parseCurrencyStringToFloat(formData.get("amount") as string);
        const contribFd = new FormData();
        for (const [k, v] of formData.entries()) contribFd.append(k, v);
        contribFd.set("amount", isNaN(contribAmount) ? "0" : String(contribAmount));

        const parsed = parseFormData(contributionSchema, contribFd);
        if (!parsed.success) {
            return { error: parsed.error ?? "Validation failed", success: false as const, data: null };
        }
        const { cooperativeId, amount, type } = parsed.data;

        if (amount <= 0) { return { error: "Contribution amount must be positive", success: false as const, data: null };
        }

        // Verify membership
        const membershipsRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS);
        const membershipSnapshot = await membershipsRef
            .where("userId", "==", userId)
            .where("cooperativeId", "==", cooperativeId)
            .get();

        if (membershipSnapshot.empty) { return { error: "You are not a member of this cooperative", success: false as const, data: null };
        }

        const membershipDoc = membershipSnapshot.docs[0];

        // The comment here used to claim this was one atomic commit, and that
        // without it two concurrent contributions would double-count. Neither
        // was true: the adapter queues the writes and flushes them one by one
        // after the callback returns, so there was no isolation and no rollback.
        // The re-read of the membership inside the wrapper was protected by
        // nothing — the query four lines above already returned this document —
        // so it is gone rather than left there looking like a guard.
        //
        // The double-counting it worried about is handled by the primitive, not
        // the wrapper: FieldValue.increment applies the addition in SQL
        // (migration 010), so concurrent contributions cannot lose one another.
        //
        // The balance moves FIRST and the ledger rows are written LAST, so a
        // crash part-way leaves the member credited without a receipt rather
        // than a receipt with no credit.
        const txRef = db.collection(COLLECTIONS.COOPERATIVE_TRANSACTIONS).doc();

        if (type === "savings") {
            await membershipDoc.ref.update({
                savingsBalance: FieldValue.increment(amount)
            });
            await db.collection(COLLECTIONS.COOPERATIVES).doc(cooperativeId).update({
                totalSavings: FieldValue.increment(amount)
            });
        } else {
            await membershipDoc.ref.update({
                loanBalance: FieldValue.increment(-amount)
            });
        }

        // Ledger rows last — see the ordering note above.
        await txRef.set({
            userId,
            cooperativeId,
            type,
            amount,
            date: FieldValue.serverTimestamp(),
            status: "completed",
            description: type === "savings" ? "Savings contribution" : "Loan repayment"
        });

        // Universal ledger sync
        await db.collection(COLLECTIONS.TRANSACTIONS).doc(txRef.id).set({ id: txRef.id,
            userId,
            type: type,
            module: "cooperative",
            amount: amount,
            currency: "NGN",
            status: "completed",
            date: FieldValue.serverTimestamp(),
            reference: txRef.id,
            description: type === "savings" ? "Savings contribution" : "Loan repayment"
        });

        revalidatePath("/cooperatives");
        revalidatePath("/dashboard/cooperatives");
        revalidatePath("/cooperatives/dashboard");
        return { error: null, success: true as const, data: { message: "Contribution successful" }, meta: null };
    } catch (error) { logger.error("Contribution failed:", {
            error: error instanceof Error ? error.message : String(error)
        });
        return { error: error instanceof Error ? error.message : "Failed to make contribution", success: false as const, data: null };
    }
}

export const makeContributionAction = withFlexibleSafeAction("makeContributionAction", _makeContributionAction);


async function _submitWithdrawalAction(
    prevState: WithdrawalActionState,
    formData: FormData
): Promise<WithdrawalActionState> { try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required"};
        const { session } = sessionResult;
        if (!session?.user) { return { error: "You must be logged in", success: false as const, data: null };
        }

        const userId = session.user.id;
        const amount = parseCurrencyStringToFloat(formData.get("amount") as string);
        const reason = formData.get("reason") as string;
        const bankAccountStr = formData.get("bankAccount") as string;
        let bankAccount = null;

        if (isNaN(amount) || amount <= 0) { return { error: "Amount must be greater than zero", success: false as const, data: null };
        }

        try { bankAccount = bankAccountStr ? JSON.parse(bankAccountStr) : null;
        } catch (e) { return { error: "Invalid bank account details", success: false as const, data: null };
        }

        // Membership must be active before any money moves.
        const membershipSnap = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(userId).get();
        if (!membershipSnap.exists || membershipSnap.data()?.membershipStatus !== "active") {
            return { success: false as const, error: "You are not an active cooperative member", data: null };
        }

        // Reserve the funds under a row lock.
        //
        // This read savingsBalance, compared it to the amount, and then
        // decremented — all inside runTransaction, which takes no lock. Two
        // withdrawals submitted at once both read the same balance, both passed
        // the check, and both deducted, taking a member's savings negative.
        //
        // Migration 010 made that worse rather than better: the increments used
        // to lose one another, which accidentally hid the overdraft. Once they
        // apply correctly, both deductions land.
        const debit = await debitJsonbBalance({
            table: "cooperative_members",
            id: userId,
            field: "savingsBalance",
            amount,
        });

        if (!debit.ok) {
            return {
                success: false as const,
                error: debit.reason === "insufficient_funds"
                    ? "Insufficient savings balance"
                    : "You are not an active cooperative member",
                data: null,
            };
        }

        // Move the reserved funds into lockedBalance.
        //
        // The debit above only took the money OUT of savingsBalance. The admin
        // side of this flow assumes it also went somewhere: rejecting a request
        // does `savingsBalance += amount, lockedBalance -= amount`
        // (cooperative/_admin.ts), and approving does `lockedBalance -= amount`.
        // Without this increment the reject restored the savings correctly but
        // drove lockedBalance NEGATIVE by the amount, permanently, on every
        // request submitted through this door.
        //
        // Ordering: after the debit, never before. The debit is the step that
        // can legitimately fail on insufficient funds; incrementing first would
        // lock funds that were never taken.
        await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(userId).update({
            lockedBalance: FieldValue.increment(amount),
            updatedAt: FieldValue.serverTimestamp(),
        });

        // The funds are already reserved by the debit above, which is the only
        // thing here that took a lock. Wrapping the two writes below in
        // runTransaction gave them nothing — the adapter flushes them one by one
        // regardless — so they are written in order: the request row first, then
        // its audit entry.
        const withdrawalRef = db.collection(COLLECTIONS.COOPERATIVE_WITHDRAWALS).doc();
        await withdrawalRef.set({ userId,
            amount,
            reason: reason || "Standard Withdrawal",
            bankAccount,
            status: "pending",
            requestedAt: FieldValue.serverTimestamp(),
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp()
        });
        // Log audit
        await logAuditAction(
            "withdrawal_requested",
            withdrawalRef.id,
            "withdrawal",
            { amount, reason }
        );

        revalidatePath("/cooperatives/withdrawals");
        return { error: null,  success: true as const,
            meta: null
        , data: { message: "Action successful" } };
    } catch (error) { logger.error("Withdrawal error:", {
            error: error instanceof Error ? error.message : String(error)
        });
        return { error: error instanceof Error ? error.message : "Failed to submit withdrawal", success: false as const, data: null };
    }
}

export const submitWithdrawalAction = withFlexibleSafeAction("submitWithdrawalAction", _submitWithdrawalAction);


async function _getTransactionsAction(): Promise<GetTransactionsState> { try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { error: sessionResult.error?.error ?? "Authentication required", success: false as const, data: null };
        const { session } = sessionResult;
        if (!session?.user) { return { error: "You must be logged in", success: false as const, data: null };
        }

        const userId = session.user.id;
        const snapshot = await db.collection(COLLECTIONS.COOPERATIVE_TRANSACTIONS)
            .where("userId", "==", userId)
            .orderBy("date", "desc")
            .get();

        const transactions = serializeDocs<CooperativeTransaction>(snapshot.docs);

        return { error: null,  success: true as const, data: { transactions } };
    } catch (error) { logger.error("Get transactions error:", {
            error: error instanceof Error ? error.message : String(error)
        });
        return { error: error instanceof Error ? error.message : "An unexpected error occurred", success: false as const, data: null };
    }
}

export const getTransactionsAction = withFlexibleSafeAction("getTransactionsAction", _getTransactionsAction);


// ============================================
// LOAN MANAGEMENT (PRD Phase 2)
// ============================================

async function _applyForLoanAction(
    prevState: LoanApplicationState,
    formData: FormData
): Promise<LoanApplicationState> { try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required"};
        const { session } = sessionResult;
        if (!session?.user) { return { error: "You must be logged in to apply for a loan", success: false as const, data: null };
        }

        const userId = session.user.id;

        // DISEASE 6 FIX: parseFormData binding
        const amountNum = parseCurrencyStringToFloat(formData.get("amount") as string);
        const loanFd = new FormData();
        for (const [k, v] of formData.entries()) loanFd.append(k, v);
        loanFd.set("amount", isNaN(amountNum) ? "0" : String(amountNum));

        const parsed = parseFormData(loanApplicationSchema, loanFd);
        if (!parsed.success) {
            return { error: parsed.error ?? "Validation failed", success: false as const, data: null };
        }
        const { productId, amount, purpose } = parsed.data;

        // The double-lending guard is now the insert itself — see the claim at
        // the end of this function.
        //
        // It used to be a pair of reads here: query both loan collections for
        // open applications and refuse if either was non-empty. Those reads took
        // no lock (originally inside runTransaction, which does not provide one),
        // so two applications submitted together both saw an empty result and
        // both created a pending row.
        //
        // A row lock could not fix it, because the thing being guarded is the
        // ABSENCE of rows — there is nothing to lock. Migration 021 does the
        // check and the insert under a per-borrower advisory lock instead.
        const membershipsRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS);
        const membershipSnapshot = await membershipsRef.where("userId", "==", userId).get();

        if (membershipSnapshot.empty) {
            throw new Error("You must be a cooperative member to apply for a loan");
        }

        const membershipDoc = membershipSnapshot.docs[0];
        const membershipData = membershipDoc.data();

        const loansRef = db.collection(COLLECTIONS.COOPERATIVE_LOANS);

        // 2. Check Loan Limit (e.g., 3x Savings Balance)
        const savingsBalance = membershipData.savingsBalance || 0;
        const maxLoanAmount = savingsBalance * 3;

        if (amount > maxLoanAmount) {
            throw new Error(`Loan amount exceeds your limit of ₦${maxLoanAmount.toLocaleString()} (3x Savings)`);
        }

        // 3. The loan is written on the terms of the product the member chose.
        //
        // This read COLLECTIONS.COOPERATIVE_LOAN_PRODUCTS — "cooperative_loan_products",
        // a collection NOTHING WRITES. Every loan product the admin creates goes
        // into COLLECTIONS.LOAN_PRODUCTS ("loan_products"), which is what the
        // admin CRUD routes, the public list and /api/cooperative/apply-loan all
        // use. The only reference to the other name anywhere is its definition.
        //
        // So productDoc.exists was always false and every application fell
        // through to the defaults below it:
        //
        //     let interestRate = 5; // Default 5%
        //     let durationMonths = 6;
        //
        // The member page fetches products from /api/cooperative/loan-products,
        // shows the real rate, and quotes with calculateRepaymentTerms. Then it
        // submits here. So the borrower was quoted their product's terms and the
        // loan was recorded at 5% over 6 months, whichever product they picked.
        //
        // The interest maths differed too. This computed `amount * (rate/100)`
        // once — a flat charge — while the route and the quote treat
        // interestRate as a MONTHLY rate through calculateRepaymentTerms, which
        // cooperative-tiers.ts and loan-terms.ts both say is correct. Same
        // function now, so a rate change or a fix cannot reach only one of them.
        //
        // Fails closed on a missing or malformed product, as the route does. A
        // silent default is what turned this into money.
        const productDoc = await db.collection(COLLECTIONS.LOAN_PRODUCTS).doc(productId).get();
        if (!productDoc.exists) {
            throw new Error("That loan product is no longer available.");
        }

        const prod = productDoc.data()!;
        const interestRate = Number(prod.interestRate);
        const durationMonths = Number(prod.durationMonths);

        if (!Number.isFinite(interestRate) || interestRate < 0
            || !Number.isInteger(durationMonths) || durationMonths < 1) {
            logger.error("[Loan Apply] Loan product has unusable terms", {
                productId,
                interestRate: prod.interestRate,
                durationMonths: prod.durationMonths,
            });
            throw new Error("That loan product is not correctly configured. Please contact support.");
        }

        const terms = calculateRepaymentTerms(amount, durationMonths, interestRate);
        const interestAmount = terms.totalRepayment - amount;
        const totalRepayment = terms.totalRepayment;
        const monthlyPayment = terms.monthlyPayment;

        // Create the loan application, and let the insert be the guard.
        //
        // The claim refuses if the borrower has an open application in EITHER
        // collection, checked under a per-borrower advisory lock held across
        // the check and the insert. Two applications submitted together now
        // serialise: the second sees the first one's row and is refused.
        //
        // Timestamps are literal here rather than FieldValue.serverTimestamp():
        // the row is passed to Postgres as JSONB and sentinels are not resolved,
        // the same caveat claim_status_transition carries. created_at/updated_at
        // are set by the function itself.
        const newLoanRef = loansRef.doc();
        const nowIso = new Date().toISOString();

        const claim = await claimSingleOpenLoanApplication({
            userId,
            id: newLoanRef.id,
            table: "cooperative_loans",
            row: {
                memberId: userId,
                productId,
                amount,
                purpose,
                interestAmount,
                totalRepayment,
                monthlyPayment,
                durationMonths,
                status: "pending",
                appliedAt: nowIso,
                createdAt: nowIso,
                updatedAt: nowIso,
            },
        });

        if (!claim.claimed) {
            throw new Error("Active or pending loan application already exists platform-wide.");
        }

        try {
            await invalidateCooperativeCache(userId);
            await invalidateAdminGlobalStats();
        } catch (cacheError) {
            logger.error('[Loan Apply Cache] Cache clear error:', cacheError);
        }

        return { error: null, success: true as const,
            meta: null
        , data: { message: "Action successful" } };

    } catch (error) { logger.error("Loan application failed:", {
            error: error instanceof Error ? error.message : String(error)
        });
        return { error: error instanceof Error ? error.message : "Failed to submit loan application", success: false as const, data: null };
    }
}

export const applyForLoanAction = withFlexibleSafeAction("applyForLoanAction", _applyForLoanAction);


// ============================================
// FIXED SAVINGS (PRD Phase 2)
// ============================================

async function _createFixedSavingsAction(
    prevState: FixedSavingsState,
    formData: FormData
): Promise<FixedSavingsState> { try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required"};
        const { session } = sessionResult;
        if (!session?.user) { return { error: "You must be logged in", success: false as const, data: null };
        }

        const userId = session.user.id;

        const rawData = { amount: parseCurrencyStringToFloat(formData.get("amount") as string),
            durationMonths: Number(formData.get("durationMonths")) };

        const validationResult = fixedSavingsSchema.safeParse(rawData);
        if (!validationResult.success) { return { error: validationResult.error.issues[0]?.message || "Invalid input", success: false as const, data: null };
        }

        const { amount, durationMonths } = validationResult.data;

        if (amount <= 0) { return { error: "Amount must be positive", success: false as const, data: null };
        }

        const membershipSnapshot = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS)
            .where("userId", "==", userId)
            .limit(1)
            .get();

        if (membershipSnapshot.empty) {
            return { success: false as const, error: "Membership not found", data: null };
        }

        const membershipId = membershipSnapshot.docs[0].id;

        // Lock the savings before creating the plan.
        //
        // Same read-check-write as the withdrawal path: two plans created at
        // once both read the same savings balance, both passed the sufficiency
        // check, and both deducted — locking away more than the member had.
        const debit = await debitJsonbBalance({
            table: "cooperative_members",
            id: membershipId,
            field: "savingsBalance",
            amount,
        });

        if (!debit.ok) {
            return {
                success: false as const,
                error: debit.reason === "insufficient_funds"
                    ? "Insufficient savings balance to create this fixed savings plan"
                    : "Membership not found",
                data: null,
            };
        }

        // Create Fixed Savings Record. This is a single write; the
        // runTransaction wrapper around it bought nothing at all.
        const fixedSavingsRef = db.collection(COLLECTIONS.COOPERATIVE_FIXED_SAVINGS).doc();
        await fixedSavingsRef.set({ memberId: userId,
            amount,
            durationMonths,
            startDate: FieldValue.serverTimestamp(),
            status: "active",
            interestRate: 14, // 14% p.a.
            createdAt: FieldValue.serverTimestamp() });

        return { error: null, success: true as const, data: { message: "Fixed savings plan created" }  };
    } catch (error) { logger.error("Fixed savings creation failed:", {
            error: error instanceof Error ? error.message : String(error)
        });
        return { error: error instanceof Error ? error.message : "Failed to create fixed savings plan", success: false as const, data: null };
    }
}

export const createFixedSavingsAction = withFlexibleSafeAction("createFixedSavingsAction", _createFixedSavingsAction);
