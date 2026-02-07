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
        if (membershipData.membershipStatus !== "approved") {
            return NextResponse.json(
                { success: false, message: "Your membership must be approved before applying for loans" },
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
