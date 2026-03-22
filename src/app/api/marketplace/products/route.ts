export const dynamic = 'force-dynamic';

import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";

/**
 * Marketplace Products API
 * Returns real agricultural products from Firestore (sellers collection)
 */

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const category = searchParams.get("category");
        const search = searchParams.get("search");
        const minPrice = searchParams.get("minPrice");
        const maxPrice = searchParams.get("maxPrice");

        // Query real products from Firestore
        let query: FirebaseFirestore.Query = db
            .collection(COLLECTIONS.MARKETPLACE_PRODUCTS)
            .where("status", "==", "approved")
            .where("inStock", "==", true)
            .orderBy("createdAt", "desc")
            .limit(100);

        // Apply category filter at DB level
        if (category && category !== "all") {
            query = db
                .collection(COLLECTIONS.MARKETPLACE_PRODUCTS)
                .where("status", "==", "approved")
                .where("category", "==", category)
                .orderBy("createdAt", "desc")
                .limit(100);
        }

        const snapshot = await query.get();

        let products = snapshot.docs.map((doc) => {
            const data = doc.data();
            return {
                id: doc.id,
                name: data.name || "",
                description: data.description || "",
                category: data.category || "other",
                price: data.price || 0,
                unit: data.unit || "kg",
                inStock: data.inStock !== false,
                quantity: data.quantity || 0,
                images: data.images || [],
                sellerId: data.sellerId || "",
                sellerName: data.sellerName || data.storeName || "Verified Seller",
                sellerLocation: data.sellerLocation || data.location || "",
                rating: data.rating || 0,
                reviews: data.reviewCount || 0,
                verified: data.verified !== false,
                createdAt: data.createdAt?.toDate?.()?.toISOString() || new Date().toISOString(),
            };
        });

        // Apply in-memory filters for search and price (can't cost-effectively do compound Firestore queries)
        if (search) {
            const searchLower = search.toLowerCase();
            products = products.filter(
                (p) =>
                    p.name.toLowerCase().includes(searchLower) ||
                    p.description.toLowerCase().includes(searchLower) ||
                    p.sellerName.toLowerCase().includes(searchLower) ||
                    p.sellerLocation.toLowerCase().includes(searchLower)
            );
        }

        if (minPrice) {
            products = products.filter((p) => p.price >= parseInt(minPrice));
        }

        if (maxPrice) {
            products = products.filter((p) => p.price <= parseInt(maxPrice));
        }

        return NextResponse.json({
            success: true,
            products,
            total: products.length,
            source: "firestore",
        });
    } catch (error: any) {
        logger.error("Marketplace products API error:", error);
        return NextResponse.json(
            { success: false, error: error.message },
            { status: 500 }
        );
    }
}
