export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue } from "firebase-admin/firestore";

/**
 * API Route: Create Product Listing
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

        // Check if user is an approved seller (Admin SDK)
        const sellerDoc = await db.collection(COLLECTIONS.MARKETPLACE_SELLERS).doc(userId).get();
        if (!sellerDoc.exists || sellerDoc.data()?.verificationStatus !== "approved") {
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
        const retailPrice = Number(formData.get("retailPrice"));
        const bulkPrice = Number(formData.get("bulkPrice")) || 0;
        const exportPrice = Number(formData.get("exportPrice")) || 0;
        const certificationsStr = formData.get("certifications") as string;
        const certifications = certificationsStr ? JSON.parse(certificationsStr) : [];
        const escrowAvailable = formData.get("escrowAvailable") === "true";

        if (!name || !category || !description || !unit || !minOrder || !stockQuantity || !retailPrice) {
            return NextResponse.json(
                { success: false, message: "Missing required fields" },
                { status: 400 }
            );
        }

        const images: string[] = [];
        let videoUrl = "";

        for (let i = 0; i < 5; i++) {
            const image = formData.get(`image${i}`) as File;
            if (image) {
                images.push(`placeholder_${image.name}`);
            }
        }

        const video = formData.get("video") as File;
        if (video) {
            videoUrl = `placeholder_${video.name}`;
        }

        const sellerData = sellerDoc.data()!;

        // Create product (Admin SDK)
        const productRef = db.collection(COLLECTIONS.PRODUCTS).doc();
        await productRef.set({
            sellerId: userId,
            sellerName: sellerData.businessName || session.user.name,
            name,
            category,
            description,
            specifications,
            unit,
            minOrder,
            stockQuantity,
            pricingTiers: {
                retail: retailPrice,
                bulk: bulkPrice || retailPrice,
                export: exportPrice || retailPrice,
            },
            certifications,
            images,
            videoUrl,
            escrowAvailable,
            rating: 0,
            totalOrders: 0,
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
