export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
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

        // Check if user already has a membership application (Admin SDK)
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        if (userDoc.exists && userDoc.data()?.cooperativeMembershipId) {
            return NextResponse.json(
                { success: false, error: "You already have a cooperative membership" },
                { status: 400 }
            );
        }

        // Generate payment reference
        const paymentReference = generateReference("COOP");
        const membershipId = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc().id;

        // Determine registration fee based on tier
        const registrationFee = tier === "premium" ? 20000 : 10000;

        // ── STEP 1: Initialize Paystack FIRST ──────────────────────────────────
        // Bug fix: we previously created the Firestore doc before calling Paystack.
        // If Paystack failed, the doc was orphaned in 'pending' state and the user
        // could never re-register ("You already have a membership" on next attempt).
        // Now we only write to Firestore AFTER Paystack confirms initialisation.
        const paystackResponse = await fetch("https://api.paystack.co/transaction/initialize", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
            },
            body: JSON.stringify({
                email: session.user.email,
                amount: registrationFee * 100,
                reference: paymentReference,
                callback_url: `${process.env.NEXT_PUBLIC_APP_URL}/cooperatives/verify-payment?reference=${paymentReference}&type=registration`,
                metadata: {
                    membershipId,
                    userId: session.user.id,
                    membershipTier: tier,
                    type: "cooperative_membership_registration",
                },
            }),
        });

        const paystackData = await paystackResponse.json();

        if (!paystackData.status) {
            logger.error("[Cooperative Register] Paystack init failed", {
                userId: session.user.id,
                reference: paymentReference,
                paystackStatus: paystackData.status,
                paystackMessage: paystackData.message,
            });
            return NextResponse.json(
                { success: false, error: paystackData.message || "Payment initialization failed" },
                { status: 500 }
            );
        }

        const authorizationUrl: string = paystackData.data.authorization_url;

        // ── STEP 2: Write Firestore doc AFTER Paystack confirms ────────────────
        // If this write fails after a successful Paystack init, log a CRITICAL
        // alert so ops can manually create the record and link it to the payment.
        const memberData = {
            id: membershipId,
            userId: session.user.id,
            cooperativeId: "default",
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
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        };

        try {
            await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(membershipId).set(memberData);
        } catch (firestoreErr: any) {
            // CRITICAL: Paystack was initialized but we couldn't save the membership record.
            // The user's browser will be redirected to Paystack. If they pay, the webhook
            // will try to find this doc via userId fallback. Log everything for manual recovery.
            logger.error("[Cooperative Register] CRITICAL: Paystack initialized but Firestore write failed", {
                userId: session.user.id,
                membershipId,
                paymentReference,
                tier,
                authorizationUrl,
                error: firestoreErr.message,
            });
            // Return the payment URL anyway — the webhook's userId fallback will handle the doc.
            // Do NOT block the user from paying.
        }

        return NextResponse.json({
            success: true,
            paymentUrl: authorizationUrl,
            membershipId,
            reference: paymentReference,
        });
    } catch (error: any) {
        logger.error("Cooperative registration error:", error);
        return NextResponse.json(
            { success: false, error: error.message || "Registration failed" },
            { status: 500 }
        );
    }
}
