export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { uploadFileToStorage } from "@/lib/storage-admin";

import { parseCurrencyStringToFloat } from "@/lib/utils";

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

        if (!name || !category || !description || !unit || !minOrder || !stockQuantity || !retailPrice) {
            return NextResponse.json(
                { success: false, message: "Missing required fields" },
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
                        const url = await uploadFileToStorage(image, destination, true);
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
                    videoUrl = await uploadFileToStorage(video, destination, true);
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
            status: "active",
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
