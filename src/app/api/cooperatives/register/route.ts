import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase";
import { collection, doc, setDoc, getDoc } from "firebase/firestore";
import { generateReference } from "@/lib/paystack";
import { COLLECTIONS } from "@/lib/types/firestore";

export async function POST(request: NextRequest) {
    try {
        const session = await auth();

        if (!session?.user) {
            return NextResponse.json(
                { success: false, error: "Unauthorized" },
                { status: 401 }
            );
        }

        const body = await request.json();
        const {
            firstName,
            middleName,
            lastName,
            dateOfBirth,
            gender,
            email,
            phone,
            stateOfOrigin,
            lga,
            residentialAddress,
            occupation,
            nextOfKin,
            tier,
        } = body;

        // Validation
        if (!firstName || !lastName || !email || !phone || !dateOfBirth) {
            return NextResponse.json(
                { success: false, error: "Missing required fields" },
                { status: 400 }
            );
        }

        // Check if user already has a membership application
        const userDoc = await getDoc(doc(db, COLLECTIONS.USERS, session.user.id));
        if (userDoc.exists() && userDoc.data().cooperativeMembershipId) {
            return NextResponse.json(
                { success: false, error: "You already have a cooperative membership" },
                { status: 400 }
            );
        }

        // Generate payment reference
        const paymentReference = generateReference("COOP");
        const membershipId = doc(collection(db, COLLECTIONS.COOPERATIVE_MEMBERS)).id;

        // Determine registration fee based on tier
        const registrationFee = tier === "premium" ? 20000 : 10000;

        // Create pending membership record
        const memberData = {
            id: membershipId,
            userId: session.user.id,
            cooperativeId: "default", // You can implement multiple cooperatives later
            firstName,
            middleName: middleName || "",
            lastName,
            dateOfBirth: new Date(dateOfBirth),
            gender,
            email,
            phone,
            stateOfOrigin,
            lga,
            residentialAddress,
            occupation,
            nextOfKin: {
                fullName: nextOfKin.fullName,
                phone: nextOfKin.phone,
                residentialAddress: nextOfKin.residentialAddress,
            },
            membershipTier: tier,
            registrationFee,
            membershipStatus: "pending",
            paymentReference,
            savingsBalance: 0,
            loanBalance: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        // Save to Firestore
        await setDoc(doc(db, COLLECTIONS.COOPERATIVE_MEMBERS, membershipId), memberData);

        // Initialize Paystack payment
        const paystackResponse = await fetch("https://api.paystack.co/transaction/initialize", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
            },
            body: JSON.stringify({
                email: session.user.email,
                amount: registrationFee * 100, // Convert to kobo
                reference: paymentReference,
                callback_url: `${process.env.NEXTAUTH_URL}/cooperatives/verify-payment?reference=${paymentReference}&type=registration`,
                metadata: {
                    membershipId,
                    userId: session.user.id,
                    tier,
                    type: "cooperative_registration",
                },
            }),
        });

        const paystackData = await paystackResponse.json();

        if (!paystackData.status) {
            // Clean up if payment initialization fails
            return NextResponse.json(
                { success: false, error: "Payment initialization failed" },
                { status: 500 }
            );
        }

        return NextResponse.json({
            success: true,
            paymentUrl: paystackData.data.authorization_url,
            membershipId,
            reference: paymentReference,
        });
    } catch (error: any) {
        console.error("Cooperative registration error:", error);
        return NextResponse.json(
            { success: false, error: error.message || "Registration failed" },
            { status: 500 }
        );
    }
}
