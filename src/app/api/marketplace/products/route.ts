export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";

/**
 * GET /api/marketplace/products
 * Returns approved marketplace products with cursor-based pagination.
 *
 * Query params:
 *   category  — filter by product category
 *   search    — in-memory text search on name/description/seller
 *   minPrice  — minimum price filter
 *   maxPrice  — maximum price filter
 *   cursor    — ISO timestamp of the last item's createdAt (for pagination)
 *   limit     — number of items per page (default 20, max 50)
 *
 * Response: { success, data: { products }, meta: { cursor, hasMore } }
 */
export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const category = searchParams.get("category");
        const search = searchParams.get("search");
        const minPrice = searchParams.get("minPrice");
        const maxPrice = searchParams.get("maxPrice");
        const cursorParam = searchParams.get("cursor");
        const rawLimit = parseInt(searchParams.get("limit") || "20");
        const limit = Math.min(Math.max(rawLimit, 1), 50);

        // Base query — always filter approved + in-stock, ordered by createdAt desc
        let query: FirebaseFirestore.Query = db
            .collection(COLLECTIONS.MARKETPLACE_PRODUCTS)
            .where("status", "==", "approved")
            .where("inStock", "==", true)
            .orderBy("createdAt", "desc")
            .limit(limit + 1); // +1 to detect hasMore

        // Apply category filter at DB level (replaces the compound query)
        if (category && category !== "all") {
            query = db
                .collection(COLLECTIONS.MARKETPLACE_PRODUCTS)
                .where("status", "==", "approved")
                .where("inStock", "==", true)
                .where("category", "==", category)
                .orderBy("createdAt", "desc")
                .limit(limit + 1);
        }

        // Apply cursor (startAfter the last createdAt timestamp)
        if (cursorParam) {
            const cursorDate = new Date(cursorParam);
            if (!isNaN(cursorDate.getTime())) {
                query = query.startAfter(cursorDate);
            }
        }

        const snapshot = await query.get();

        const hasMore = snapshot.docs.length > limit;
        const docs = hasMore ? snapshot.docs.slice(0, limit) : snapshot.docs;

        let products = docs.map(doc => {
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
                createdAt: data.createdAt?.toDate?.()?.toISOString() ?? new Date().toISOString(),
            };
        });

        // In-memory filters for search and price (compound Firestore queries
        // require index creation for every combination — kept as in-memory)
        if (search) {
            const searchLower = search.toLowerCase();
            products = products.filter(
                p =>
                    p.name.toLowerCase().includes(searchLower) ||
                    p.description.toLowerCase().includes(searchLower) ||
                    p.sellerName.toLowerCase().includes(searchLower) ||
                    p.sellerLocation.toLowerCase().includes(searchLower)
            );
        }
        if (minPrice) products = products.filter(p => p.price >= parseInt(minPrice));
        if (maxPrice) products = products.filter(p => p.price <= parseInt(maxPrice));

        const nextCursor = hasMore && docs.length > 0
            ? docs[docs.length - 1].data().createdAt?.toDate?.()?.toISOString() ?? null
            : null;

        return NextResponse.json({
            success: true,
            data: { products },
            meta: { cursor: nextCursor, hasMore },
        });
    } catch (error: any) {
        logger.error("GET /api/marketplace/products error:", error);
        return NextResponse.json(
            { success: false, data: null, error: "Failed to load products", meta: { cursor: null, hasMore: false } },
            { status: 500 }
        );
    }
}
