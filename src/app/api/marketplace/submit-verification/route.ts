export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue } from "@/lib/firestore-compat";
import { rateLimit, createRateLimitResponse } from '@/lib/rate-limiter';
import { rateLimitConfig } from '@/lib/rate-limits.config';

const verificationLimiter = rateLimit(rateLimitConfig.serverAction);

/**
 * API Route: Submit Seller Verification
 */
export async function POST(request: NextRequest) {

    try {
        const session = (await requireSession()).session;
        if (!session?.user) {
            return NextResponse.json(
                { success: false, message: "Unauthorized" },
                { status: 401 }
            );
        }

        // Keyed on the ACCOUNT, not the IP address.
        //
        // This endpoint is authenticated, and rate-limits.config.ts already
        // spells out why an IP key is the wrong unit here: "Nigerian mobile
        // networks share IPs heavily, so a limit tuned as though an IP were a
        // person locks out real users." That note was written for the public
        // contact form and applies with more force to a signed-in one — behind a
        // carrier NAT, a handful of members exhausting this limit blocked
        // everyone else sharing that address.
        //
        // The four payment ACTIONS already key on session.user.id. The API
        // routes doing the same work did not, so one convention was correct and
        // the other was not, for the same operation.
        //
        // The check moves below the session because that is where the user id
        // exists. The trade is that an unauthenticated flood now reaches
        // requireSession() first — which reads a token and returns 401 without
        // touching the database, so it is the cheap path either way, and
        // volumetric protection belongs at the edge rather than here.
        const rateLimitResult = await verificationLimiter.check(session.user.id);
        if (!rateLimitResult.success) {
            return createRateLimitResponse(rateLimitResult);
        }

        const userId = session.user.id;

        // Check if user already has a verification request (Admin SDK)
        const existingDoc = await db.collection(COLLECTIONS.SELLER_VERIFICATIONS).doc(userId).get();
        if (existingDoc.exists) {
            const existingData = existingDoc.data()!;
            if (existingData.status === "pending") {
                return NextResponse.json(
                    { success: false, message: "You already have a pending verification request" },
                    { status: 400 }
                );
            }
        }

        const formData = await request.formData();

        const businessName = formData.get("businessName") as string;
        const businessType = formData.get("businessType") as string;
        const businessDescription = formData.get("businessDescription") as string;
        const phone = formData.get("phone") as string;
        const email = formData.get("email") as string;
        const address = formData.get("address") as string;
        const state = formData.get("state") as string;
        const lga = formData.get("lga") as string;
        const bankName = formData.get("bankName") as string;
        const accountNumber = formData.get("accountNumber") as string;
        const accountName = formData.get("accountName") as string;

        const businessDoc = formData.get("businessDoc") as File;
        const idDoc = formData.get("idDoc") as File;
        const addressProof = formData.get("addressProof") as File;

        if (!businessName || !businessType || !businessDescription ||
            !phone || !email || !address || !state || !lga ||
            !bankName || !accountNumber || !accountName) {
            return NextResponse.json(
                { success: false, message: "Missing required fields" },
                { status: 400 }
            );
        }

        if (!businessDoc || !idDoc || !addressProof) {
            return NextResponse.json(
                { success: false, message: "All document uploads are required" },
                { status: 400 }
            );
        }

        // Create verification record (Admin SDK)
        await db.collection(COLLECTIONS.SELLER_VERIFICATIONS).doc(userId).set({
            userId,
            businessName,
            businessType,
            businessDescription,
            phone,
            email,
            address,
            state,
            lga,
            documents: {
                businessDoc: `placeholder_${businessDoc.name}`,
                idDoc: `placeholder_${idDoc.name}`,
                addressProof: `placeholder_${addressProof.name}`,
            },
            bankDetails: {
                bankName,
                accountNumber,
                accountName,
            },
            bankAccount: {
                bankName,
                accountNumber,
                accountName,
            },
            status: "pending",
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });

        // Update marketplace_sellers with pending status
        await db.collection(COLLECTIONS.MARKETPLACE_SELLERS).doc(userId).set({
            userId,
            verificationStatus: "pending",
            verificationId: userId,
            createdAt: FieldValue.serverTimestamp(),
        });

        return NextResponse.json({
            success: true,
            message: "Verification submitted successfully"
        });
    } catch (error) {
        logger.error("Failed to submit verification:", error);
        return NextResponse.json(
            { success: false, message: "Internal server error" },
            { status: 500 }
        );
    }
}
