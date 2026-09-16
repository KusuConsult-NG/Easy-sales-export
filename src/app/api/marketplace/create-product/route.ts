export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue } from "@/lib/firestore-compat";
import { uploadFileToStorage } from "@/lib/storage-admin";

import { parseCurrencyStringToFloat } from "@/lib/utils";
import { PRODUCT_INITIAL_STATUS } from "@/lib/product-status";
import { checkProductPricing } from "@/lib/product-pricing-guard";

/**
 * API Route: Create Product Listing
 * Used by /marketplace/products/add page
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

        const userId = session.user.id;

        // Check if user is an approved seller — same check as createProductAction server action
        // Admin approval sets sellerVerificationStatus: "approved" on the user doc
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
        const userData = userDoc.data();
        if (!userData || userData.sellerVerificationStatus !== "approved") {
            return NextResponse.json(
                { success: false, message: "You must be an approved seller to list products" },
                { status: 403 }
            );
        }

        const formData = await request.formData();

        const name = formData.get("name") as string;
        const category = formData.get("category") as string;
        const description = formData.get("description") as string;
        const specifications = formData.get("specifications") as string || "";
        const unit = formData.get("unit") as string;
        const minOrder = Number(formData.get("minOrder"));
        const stockQuantity = Number(formData.get("stockQuantity"));
        const retailPrice = parseCurrencyStringToFloat(formData.get("retailPrice") as string);
        const bulkPrice = parseCurrencyStringToFloat(formData.get("bulkPrice") as string) || 0;
        const exportPrice = parseCurrencyStringToFloat(formData.get("exportPrice") as string) || 0;

        let certifications: string[] = [];
        try {
            const certificationsStr = formData.get("certifications") as string;
            certifications = certificationsStr ? JSON.parse(certificationsStr) : [];
        } catch (e) {
            logger.warn("Failed to parse certifications, using empty array");
        }

        const escrowAvailable = formData.get("escrowAvailable") === "true";
        const locationState = (formData.get("state") || formData.get("locationState") || userData?.stateOfOrigin || userData?.state || "Lagos") as string;
        const locationLga = (formData.get("lga") || formData.get("locationLga") || userData?.lga || "Unknown") as string;
        const locationNearestMarket = (formData.get("nearestMarket") || formData.get("locationNearestMarket") || "Unknown") as string;

        /*
         *   #798 "MISSING REQUIRED FIELDS" WAS THE WRONG THING TO SAY.
         *
         *   Found by the end-to-end spec added with this finding, which types a
         *   retail price of 0 and expected the pricing guard's sentence. The
         *   write IS refused — nothing reaches the database, which was the
         *   property that mattered and it holds — but the seller is told she
         *   left a field blank when she filled every one of them.
         *
         *   `!retailPrice` is the same truthiness-is-not-a-range-check mistake
         *   the note below this block describes, caught one step earlier: it
         *   rejects exactly 0 and NaN, so a price of 0 never reaches
         *   checkProductPricing and never gets named. She retypes 0, gets the
         *   same message, and has no way to learn what is actually wrong.
         *
         *   PRESENCE here, RANGE below. Only the two fields whose zero is
         *   unambiguously an error are moved:
         *
         *     retailPrice  0 is a listing nobody can buy — checkout refuses a
         *                  non-positive stored price (#794).
         *     minOrder     0 is multiplied by 5 and 10 to derive the bulk and
         *                  export thresholds, so it propagates into three tiers.
         *
         *   stockQuantity is DELIBERATELY LEFT ON THE TRUTHINESS CHECK. The
         *   guard passes it `zeroMeansAbsent: true`, so moving it here would
         *   newly ADMIT a product with zero stock — an unbuyable listing, the
         *   exact thing #794 exists to stop. Fixing a message is not a reason to
         *   widen what the door accepts, and its message stays imperfect rather
         *   than trading that for a behaviour change nobody asked for.
         *
         *   THE ACCEPT/REJECT SET IS UNCHANGED. Every input refused before is
         *   still refused; two of them now say why.
         */
        const missingNumber = (raw: FormDataEntryValue | null, parsed: number) =>
            raw === null || String(raw).trim() === "" || Number.isNaN(parsed);

        if (
            !name || !category || !description || !unit || !stockQuantity
            || missingNumber(formData.get("minOrder"), minOrder)
            || missingNumber(formData.get("retailPrice"), retailPrice)
        ) {
            return NextResponse.json(
                { success: false, message: "Missing required fields" },
                { status: 400 }
            );
        }

        // Numbers must be positive and finite — truthiness is not a range check.
        //
        // The block above was the only validation these had, and `!value`
        // rejects exactly two things: 0 and NaN. It accepts -100. A seller could
        // list a product at a NEGATIVE retail price, which goes straight into
        // pricingTiers and from there into order totals; and a negative
        // stockQuantity becomes availableQuantity, which the checkout path
        // decrements against.
        //
        // Infinity passes too. parseCurrencyStringToFloat is parseFloat
        // underneath, so "1e400" yields Infinity, which is truthy. Every total
        // computed from it is Infinity, and JSON.stringify writes it as null.
        //
        // minOrder is multiplied by 5 and by 10 below to derive the bulk and
        // export tier thresholds, so a nonsense minOrder propagates into three
        // tiers rather than one.
        //   #794 The same rule all four product doors now apply, in one place.
        //   This route was the ONLY one that had it; the server action had none
        //   and neither update door had any. ProductSchema's own comments record
        //   the two creators drifting twice before, which is why it is shared
        //   rather than copied a fourth time.
        const pricing = checkProductPricing([
            { label: "retail price", value: retailPrice },
            { label: "bulk price", value: bulkPrice, zeroMeansAbsent: true },
            { label: "export price", value: exportPrice, zeroMeansAbsent: true },
            { label: "minimum order", value: minOrder },
            { label: "stock quantity", value: stockQuantity, zeroMeansAbsent: true },
        ]);
        if (!pricing.ok) {
            return NextResponse.json(
                { success: false, message: pricing.message },
                { status: 400 }
            );
        }

        // ✅ FIXED: Upload images to Firebase Storage (was placeholder stub, now supports pre-uploaded URLs)
        const productId = `product_${userId}_${Date.now()}`;
        const images: string[] = [];
        let videoUrl = "";

        for (let i = 0; i < 5; i++) {
            const image = formData.get(`image${i}`);
            if (image) {
                if (typeof image === "string" && image.startsWith("http")) {
                    images.push(image);
                } else if (image instanceof File && image.size > 0) {
                    try {
                        const ext = image.name.split(".").pop() || "jpg";
                        const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${ext}`;
                        const destination = `products/${userId}/${productId}/${fileName}`;
                        // isPublic = true so buyers can see images
                        const url = await uploadFileToStorage(image, destination);
                        images.push(url);
                    } catch (uploadErr) {
                        logger.error("Image upload failed:", uploadErr);
                        // Continue — skip failed image rather than blocking entire product
                    }
                }
            }
        }

        const video = formData.get("video");
        if (video) {
            if (typeof video === "string" && video.startsWith("http")) {
                videoUrl = video;
            } else if (video instanceof File && video.size > 0) {
                try {
                    const ext = video.name.split(".").pop() || "mp4";
                    const fileName = `${Date.now()}_video.${ext}`;
                    const destination = `products/${userId}/${productId}/${fileName}`;
                    videoUrl = await uploadFileToStorage(video, destination);
                } catch (uploadErr) {
                    logger.error("Video upload failed:", uploadErr);
                }
            }
        }

        // Create product (Admin SDK)
        const productRef = db.collection(COLLECTIONS.PRODUCTS).doc(productId);
        const sellerBusinessName = userData?.verificationProfile?.business?.name
            || userData?.businessName
            || session.user.name;
        await productRef.set({
            id: productId,
            sellerId: userId,
            sellerName: sellerBusinessName,
            location: {
                state: locationState,
                lga: locationLga,
                nearestMarket: locationNearestMarket
            },
            name,
            // Also save as 'title' so getSellerProductsAction (which uses 'title') can find it
            title: name,
            category,
            description,
            specifications,
            unit,
            minOrder,
            stockQuantity,
            availableQuantity: stockQuantity,
            minimumOrderQuantity: minOrder,
            pricingTiers: [
                { type: "retail", price: retailPrice, minQuantity: minOrder || 1 },
                ...(bulkPrice ? [{ type: "bulk", price: bulkPrice, minQuantity: minOrder * 5 || 50 }] : []),
                ...(exportPrice ? [{ type: "export", price: exportPrice, minQuantity: minOrder * 10 || 100 }] : []),
            ] as any,
            bulkAvailable: bulkPrice > 0,
            exportReady: exportPrice > 0,
            certifications,
            images,
            videoUrl,
            escrowAvailable,
            rating: 0,
            totalOrders: 0,
            views: 0,
            orders: 0,
            reviewCount: 0,
            // ONE answer for both creators, from lib/product-status.ts. This
            // wrote "active" while createProductAction wrote "pending", so which
            // of the two seller forms was used decided whether the listing was
            // ever visible. Its value is unchanged today; the point is that it is
            // now the same value in both places, changeable in one.
            status: PRODUCT_INITIAL_STATUS,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });

        return NextResponse.json({
            success: true,
            message: "Product listed successfully",
            productId: productRef.id
        });
    } catch (error) {
        logger.error("Failed to create product:", error);
        return NextResponse.json(
            { success: false, message: "Internal server error" },
            { status: 500 }
        );
    }
}
