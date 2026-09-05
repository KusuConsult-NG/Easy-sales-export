export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue } from "@/lib/firestore-compat";

import { parseCurrencyStringToFloat } from "@/lib/utils";
import { uploadFileToStorage } from "@/lib/storage-admin";

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
        const size = parseCurrencyStringToFloat(formData.get("size") as string);
        const unit = formData.get("unit") as string;
        const pricePerUnit = parseCurrencyStringToFloat(formData.get("pricePerUnit") as string);
        const totalPrice = parseCurrencyStringToFloat(formData.get("totalPrice") as string);
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

        /**
         * THE TITLE DEED WAS THE FILENAME.
         *
         * Every media and document field here was stored as
         * `placeholder_${file.name}` under a comment reading "placeholder for
         * cloud storage upload". Nothing was ever uploaded. The route then
         * REQUIRED landTitle and surveyPlan before writing — so a listing
         * entered the admin verification queue at `pending_verification`
         * carrying, as its proof of ownership, the string
         * "placeholder_deed.pdf".
         *
         * That is worse than storing nothing. An empty documents object reads
         * as "no evidence supplied"; a populated one reads as evidence, and the
         * reviewer approving a land sale is the person it misleads. This file
         * has been visited by an earlier finding — the ownerId/status note
         * below — which left the placeholders in place.
         *
         * Uploaded for real now, through the same helper the export and KYC
         * document paths use. It resolves Cloudinary when configured and falls
         * back to a local write when it is not, so this route no longer
         * fabricates a URL under either condition.
         *
         * An upload that FAILS refuses the request rather than storing
         * something. Half a listing whose deed did not upload is the same
         * misleading record by another route.
         */
        const uploadOrFail = async (file: File, path: string): Promise<string> => {
            const url = await uploadFileToStorage(file, path);
            if (!url) throw new Error(`Upload produced no URL for ${path}`);
            return url;
        };

        const isUploadable = (value: unknown): value is File =>
            value instanceof File && value.size > 0;

        const landTitle = formData.get("landTitle");
        const surveyPlan = formData.get("surveyPlan");
        const taxClearance = formData.get("taxClearance");
        const video = formData.get("video");

        // Required documents are checked BEFORE anything is uploaded. The old
        // refusal sat after all eleven placeholders had been built, which cost
        // nothing then because nothing was uploaded; now that they are real
        // uploads, a request that is going to be refused must not spend any.
        if (!isUploadable(landTitle) || !isUploadable(surveyPlan)) {
            return NextResponse.json(
                { success: false, data: null, meta: null, error: "Land title and survey plan are required" },
                { status: 400 }
            );
        }

        const images: string[] = [];
        for (let i = 0; i < 8; i++) {
            const image = formData.get(`image${i}`);
            if (isUploadable(image)) {
                images.push(await uploadOrFail(image, `land-listings/${userId}/image-${i}`));
            }
        }

        const videoUrl = isUploadable(video)
            ? await uploadOrFail(video, `land-listings/${userId}/video`)
            : "";

        const documents: Record<string, string> = {
            landTitle: await uploadOrFail(landTitle, `land-listings/${userId}/land-title`),
            surveyPlan: await uploadOrFail(surveyPlan, `land-listings/${userId}/survey-plan`),
        };
        if (isUploadable(taxClearance)) {
            documents.taxClearance = await uploadOrFail(
                taxClearance, `land-listings/${userId}/tax-clearance`);
        }

        const gpsCoordinates = latitude && longitude ? {
            latitude: parseFloat(latitude),
            longitude: parseFloat(longitude)
        } : null;

        const userData = userDoc.data()!;

        // Create land listing (Admin SDK)
        //
        // This wrote `userId` and `verificationStatus`. Every reader of this
        // collection uses `ownerId` and `status`:
        //
        //   farm-nation.ts        .where('ownerId', '==', userId)   — my listings
        //   land-listings.ts      .where("status", "==", "verified") — the browse list
        //   farm-nation-admin.ts  .where("status", "==", "pending_verification")
        //                                                           — the review queue
        //
        // and the other writer of this collection, _createLandListingAction,
        // writes both. So a listing created here was invisible to its own owner,
        // never entered the verification queue, and therefore could never become
        // verified and appear in the marketplace. It existed and nothing could
        // see it.
        //
        // `ownerId` and `status` are written now. `userId` and
        // `verificationStatus` are kept alongside rather than renamed, in case a
        // row already exists that something reads by them.
        //
        // `pending_verification` rather than `draft`, because this route sets
        // verificationStatus: "pending" — it submits, it does not save a draft.
        // land-listing-status.ts is the vocabulary, and `draft` is not in it:
        // land-actions creates `pending_verification`, farm-nation creates
        // `available`. `available` would put a listing on sale with no review at
        // all, which is not this route's decision to take.
        const listingRef = db.collection(COLLECTIONS.LAND_LISTINGS).doc();
        await listingRef.set({
            userId,
            ownerId: userId,
            status: "pending_verification",
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
