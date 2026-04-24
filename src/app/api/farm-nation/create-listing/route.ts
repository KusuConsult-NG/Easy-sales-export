export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue } from "firebase-admin/firestore";

/**
 * API Route: Create Land Listing
 */
export async function POST(request: NextRequest) {
    try {
        const session = (await requireSession()).session;
        if (!session?.user) {
            return NextResponse.json(
                { success: false, data: null, meta: null, error: "Unauthorized" },
                { status: 401 }
            );
        }

        const userId = session.user.id;

        // Get user details (Admin SDK)
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
        if (!userDoc.exists) {
            return NextResponse.json(
                { success: false, data: null, meta: null, error: "User not found" },
                { status: 404 }
            );
        }

        const formData = await request.formData();

        // Extract form fields
        const title = formData.get("title") as string;
        const category = formData.get("category") as string;
        const description = formData.get("description") as string;
        const state = formData.get("state") as string;
        const lga = formData.get("lga") as string;
        const address = formData.get("address") as string;
        const size = Number(formData.get("size"));
        const unit = formData.get("unit") as string;
        const pricePerUnit = Number(formData.get("pricePerUnit"));
        const totalPrice = Number(formData.get("totalPrice"));
        const latitude = formData.get("latitude") as string;
        const longitude = formData.get("longitude") as string;
        const availableForSale = formData.get("availableForSale") === "true";
        const availableForRent = formData.get("availableForRent") === "true";
        const escrowAvailable = formData.get("escrowAvailable") === "true";

        // Validate required fields
        if (!title || !category || !description || !state || !lga || !address ||
            !size || !unit || !pricePerUnit || !totalPrice) {
            return NextResponse.json(
                { success: false, data: null, meta: null, error: "Missing required fields" },
                { status: 400 }
            );
        }

        // Extract media files (placeholder for cloud storage upload)
        const images: string[] = [];
        let videoUrl = "";

        for (let i = 0; i < 8; i++) {
            const image = formData.get(`image${i}`) as File;
            if (image) {
                images.push(`placeholder_${image.name}`);
            }
        }

        const video = formData.get("video") as File;
        if (video) {
            videoUrl = `placeholder_${video.name}`;
        }

        // Process documents
        const documents: any = {};
        const landTitle = formData.get("landTitle") as File;
        const surveyPlan = formData.get("surveyPlan") as File;
        const taxClearance = formData.get("taxClearance") as File;

        if (landTitle) documents.landTitle = `placeholder_${landTitle.name}`;
        if (surveyPlan) documents.surveyPlan = `placeholder_${surveyPlan.name}`;
        if (taxClearance) documents.taxClearance = `placeholder_${taxClearance.name}`;

        if (!documents.landTitle || !documents.surveyPlan) {
            return NextResponse.json(
                { success: false, data: null, meta: null, error: "Land title and survey plan are required" },
                { status: 400 }
            );
        }

        const gpsCoordinates = latitude && longitude ? {
            latitude: parseFloat(latitude),
            longitude: parseFloat(longitude)
        } : null;

        const userData = userDoc.data()!;

        // Create land listing (Admin SDK)
        const listingRef = db.collection(COLLECTIONS.LAND_LISTINGS).doc();
        await listingRef.set({
            userId,
            ownerName: userData.name || userData.email,
            title,
            category,
            description,
            state,
            lga,
            address,
            size,
            unit,
            pricePerUnit,
            totalPrice,
            gpsCoordinates,
            images,
            videoUrl,
            documents,
            availableForSale,
            availableForRent,
            escrowAvailable,
            verificationStatus: "pending",
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });

        return NextResponse.json({
            success: true,
            data: { message: "Land listing created successfully", listingId: listingRef.id },
            meta: null
        });
    } catch (error) {
        logger.error("Failed to create land listing:", error);
        return NextResponse.json(
            { success: false, data: null, meta: null, error: "Internal server error" },
            { status: 500 }
        );
    }
}
