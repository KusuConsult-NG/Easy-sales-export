import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase";
import { doc, getDoc, setDoc, collection } from "firebase/firestore";

/**
 * API Route: Submit Loan Application
 */
export async function POST(request: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user) {
            return NextResponse.json(
                { success: false, message: "Unauthorized" },
                { status: 401 }
            );
        }

        const userId = session.user.id;
        const body = await request.json();
        const { productId, amount, purpose } = body;

        // Validate inputs
        if (!productId || !amount || !purpose) {
            return NextResponse.json(
                { success: false, message: "Missing required fields" },
                { status: 400 }
            );
        }

        // Check membership status
        const membershipRef = doc(db, "cooperative_members", userId);
        const membershipDoc = await getDoc(membershipRef);

        if (!membershipDoc.exists()) {
            return NextResponse.json(
                { success: false, message: "You must be a cooperative member to apply for loans" },
                { status: 403 }
            );
        }

        const membershipData = membershipDoc.data();

        // Check membership status - must be active (not just approved)
        if (membershipData.membershipStatus !== "active") {
            return NextResponse.json(
                { success: false, message: "Your membership must be active before applying for loans. Please complete registration payment." },
                { status: 403 }
            );
        }

        // Check membership tier - must be Premium for loans
        if (membershipData.membershipTier !== "premium") {
            return NextResponse.json(
                { success: false, message: "Only Premium members (₦20,000 tier) can apply for loans. Please upgrade your membership." },
                { status: 403 }
            );
        }

        // Get loan product details
        const productRef = doc(db, "loan_products", productId);
        const productDoc = await getDoc(productRef);

        if (!productDoc.exists()) {
            return NextResponse.json(
                { success: false, message: "Loan product not found" },
                { status: 404 }
            );
        }

        const product = productDoc.data();

        // Validate amount range
        if (amount < product.minAmount || amount > product.maxAmount) {
            return NextResponse.json(
                {
                    success: false,
                    message: `Loan amount must be between ₦${product.minAmount.toLocaleString()} and ₦${product.maxAmount.toLocaleString()}`
                },
                { status: 400 }
            );
        }

        // ELIGIBILITY CHECK #1: Check savings requirement (must have 2x loan amount in savings)
        const totalSavings = membershipData.totalContributions || 0;
        const requiredSavings = amount * 2;

        if (totalSavings < requiredSavings) {
            return NextResponse.json(
                {
                    success: false,
                    message: `Insufficient savings. You need at least ₦${requiredSavings.toLocaleString()} in contributions (2x loan amount). Current savings: ₦${totalSavings.toLocaleString()}`
                },
                { status: 403 }
            );
        }

        // ELIGIBILITY CHECK #2: Check for existing active loans
        const { collection: collectionFn, query, where, getDocs } = await import("firebase/firestore");
        const existingLoansQuery = query(
            collectionFn(db, "loan_applications"),
            where("userId", "==", userId),
            where("status", "in", ["pending", "approved", "active"])
        );
        const existingLoansSnapshot = await getDocs(existingLoansQuery);

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

        // Calculate monthly payment (simple calculation)
        const monthlyRate = product.interestRate / 100 / 12;
        const monthlyPayment = (amount * monthlyRate * Math.pow(1 + monthlyRate, product.durationMonths)) /
            (Math.pow(1 + monthlyRate, product.durationMonths) - 1);

        // Create loan application
        const applicationRef = doc(collection(db, "loan_applications"));
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
            appliedAt: new Date(),
            createdAt: new Date(),
        };

        await setDoc(applicationRef, applicationData);

        return NextResponse.json({
            success: true,
            message: "Loan application submitted successfully",
            applicationId: applicationRef.id,
            data: applicationData
        });
    } catch (error) {
        console.error("Failed to submit loan application:", error);
        return NextResponse.json(
            { success: false, message: "Internal server error" },
            { status: 500 }
        );
    }
}
