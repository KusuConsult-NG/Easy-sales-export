import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase";
import { doc, getDoc, updateDoc } from "firebase/firestore";

/**
 * API Route: Verify Paystack Payment for Cooperative Membership
 * 
 * This endpoint verifies the payment with Paystack and updates the membership record
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

        const { reference } = await request.json();

        if (!reference) {
            return NextResponse.json(
                { success: false, message: "Payment reference is required" },
                { status: 400 }
            );
        }

        // Verify payment with Paystack
        const paystackSecretKey = process.env.PAYSTACK_SECRET_KEY;
        if (!paystackSecretKey) {
            return NextResponse.json(
                { success: false, message: "Payment system not configured" },
                { status: 500 }
            );
        }

        const verifyResponse = await fetch(
            `https://api.paystack.co/transaction/verify/${reference}`,
            {
                headers: {
                    Authorization: `Bearer ${paystackSecretKey}`,
                },
            }
        );

        if (!verifyResponse.ok) {
            return NextResponse.json(
                { success: false, message: "Failed to verify payment" },
                { status: 400 }
            );
        }

        const verifyData = await verifyResponse.json();

        if (!verifyData.status || verifyData.data.status !== "success") {
            return NextResponse.json(
                { success: false, message: "Payment not successful" },
                { status: 400 }
            );
        }

        // Update membership record
        const userId = session.user.id;
        const membershipRef = doc(db, "cooperative_members", userId);
        const membershipDoc = await getDoc(membershipRef);

        if (!membershipDoc.exists()) {
            return NextResponse.json(
                { success: false, message: "Membership record not found" },
                { status: 404 }
            );
        }

        // Update payment status
        await updateDoc(membershipRef, {
            paymentStatus: "completed",
            paymentVerifiedAt: new Date(),
            updatedAt: new Date(),
        });

        return NextResponse.json({
            success: true,
            message: "Payment verified successfully. Your application is pending approval.",
        });
    } catch (error) {
        console.error("Payment verification error:", error);
        return NextResponse.json(
            { success: false, message: "Internal server error" },
            { status: 500 }
        );
    }
}
