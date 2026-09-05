export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue } from "@/lib/firestore-compat";

import { parseCurrencyStringToFloat } from "@/lib/utils";

/**
 * API Route: Create Land Listing — RETIRED. It could not store a title deed.
 *
 * #432. This is the second of three writers of LAND_LISTINGS, and the only one
 * that RECEIVES the files. It demanded a land title and a survey plan:
 *
 *     if (!documents.landTitle || !documents.surveyPlan) -> 400
 *
 * and then stored, for all eight images, the video, and all three legal
 * documents:
 *
 *     `placeholder_${file.name}`
 *
 * Nothing was ever uploaded — the comment above the block said so outright
 * ("placeholder for cloud storage upload"). The bytes arrived in the request
 * and were dropped, and the listing went to `pending_verification` for an
 * admin to review. /admin/farm-nation/land-verification renders those values
 * as links, so the reviewer approving a LAND SALE saw `placeholder_title.pdf`
 * pointing at nothing. This is #431's shape — a KYC document demanded,
 * discarded, and reviewed as a filename — on land title deeds.
 *
 * THE LIVE PATH IS COMPLETE AND CORRECT. /farm-nation/list-land uploads every
 * image and document to storage itself and calls submitLandListingAction, which
 * stores the returned URLs. Nothing in this repository calls this route.
 *
 * RETIRED RATHER THAN COMPLETED, and that is the point. Making it work means
 * building a SECOND upload path beside the one the form already has — a second
 * copy of the rule, which is the root defect this audit keeps finding (#425,
 * #426, #429, #430, #431). One door.
 *
 * It is retired rather than left alone because an API route is reachable by URL
 * whether or not a screen calls it: unlike a dead module, this one answers.
 *
 * Set LEGACY_LAND_LISTING_API=enabled to revive it. The placeholder writes are
 * corrected below regardless, so reviving it does not revive the defect — it
 * refuses a listing whose files it cannot store, rather than recording one it
 * cannot evidence.
 */

const LEGACY_FLAG = "LEGACY_LAND_LISTING_API";
const ENABLED_VALUE = "enabled";

/** Read at call time, not module load, so reviving it needs no redeploy. */
export function legacyLandListingApiEnabled(): boolean {
    return process.env[LEGACY_FLAG] === ENABLED_VALUE;
}

export const RETIRED_MESSAGE =
    "This endpoint is retired: it could not store the land title or survey plan "
    + "it required. Submit through /farm-nation/list-land, which uploads them.";

export async function POST(request: NextRequest) {
    try {
        const session = (await requireSession()).session;
        if (!session?.user) {
            return NextResponse.json(
                { success: false, data: null, meta: null, error: "Unauthorized" },
                { status: 401 }
            );
        }

        // After the session check, so the refusal does not tell an
        // unauthenticated caller anything about this endpoint.
        if (!legacyLandListingApiEnabled()) {
            return NextResponse.json(
                { success: false, data: null, meta: null, error: RETIRED_MESSAGE },
                { status: 410 }
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
         * #432 — THE FILES ARE STORED, OR THE LISTING IS REFUSED.
         *
         * This block read every file out of the form and wrote
         * `placeholder_<filename>` for each. Nothing was uploaded. A land title
         * deed recorded as the string "placeholder_title.pdf" is not a record of
         * a title deed, and the admin verification screen turned it into a link.
         *
         * Corrected even though the route is retired above: a retirement is one
         * environment variable from being live, and reviving this must not
         * revive the defect.
         */
        const timestamp = Date.now();
        const store = (file: File, label: string) => {
            const extension = file.name.split(".").pop() || "bin";
            return import("@/lib/storage-admin").then(({ uploadFileToStorage }) =>
                uploadFileToStorage(file, `farm-nation/${userId}/${timestamp}_${label}.${extension}`));
        };

        const images: string[] = [];
        let videoUrl = "";
        const documents: any = {};
        const landTitle = formData.get("landTitle") as File;
        const surveyPlan = formData.get("surveyPlan") as File;
        const taxClearance = formData.get("taxClearance") as File;

        try {
            for (let i = 0; i < 8; i++) {
                const image = formData.get(`image${i}`) as File;
                if (image) images.push(await store(image, `image${i}`));
            }

            const video = formData.get("video") as File;
            if (video) videoUrl = await store(video, "video");

            if (landTitle) documents.landTitle = await store(landTitle, "title");
            if (surveyPlan) documents.surveyPlan = await store(surveyPlan, "survey");
            if (taxClearance) documents.taxClearance = await store(taxClearance, "tax");
        } catch (uploadError) {
            // A listing whose evidence could not be stored is not a listing.
            // Recording it anyway is how the placeholder version looked like
            // working software.
            logger.error("[create-listing] could not store the files", {
                userId, error: uploadError instanceof Error ? uploadError.message : String(uploadError),
            });
            return NextResponse.json(
                { success: false, data: null, meta: null, error: "Your files could not be uploaded. Please try again." },
                { status: 502 }
            );
        }

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
