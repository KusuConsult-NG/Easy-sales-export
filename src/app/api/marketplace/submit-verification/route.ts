import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { rateLimit, getClientIp, createRateLimitResponse } from '@/lib/rate-limiter';
import { rateLimitConfig } from '@/lib/rate-limits.config';

const verificationLimiter = rateLimit(rateLimitConfig.serverAction);

/**
 * API Route: Submit Seller Verification
 */
export async function POST(request: NextRequest) {
    const clientIp = getClientIp(request);
    const rateLimitResult = await verificationLimiter.check(clientIp);

    if (!rateLimitResult.success) {
        return createRateLimitResponse(rateLimitResult);
    }

    try {
        const session = await auth();
        if (!session?.user) {
            return NextResponse.json(
                { success: false, message: "Unauthorized" },
                { status: 401 }
            );
        }

        const userId = session.user.id;

        // Check if user already has a verification request (Admin SDK)
        const existingDoc = await db.collection("seller_verifications").doc(userId).get();
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
        await db.collection("seller_verifications").doc(userId).set({
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
            status: "pending",
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });

        // Update marketplace_sellers with pending status
        await db.collection("marketplace_sellers").doc(userId).set({
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
