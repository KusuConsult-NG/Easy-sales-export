import { NextRequest, NextResponse } from "next/server";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from "@/lib/logger";
import { toMillis } from "@/lib/firestore-serialize";

export const dynamic = "force-dynamic";

/**
 * GET /api/marketplace/sellers/[sellerId]
 * Returns public seller profile: verification doc + active products + review score.
 */
export async function GET(
    _req: NextRequest,
    { params }: { params: Promise<{ sellerId: string }> }
) {
    const { sellerId } = await params;

    if (!sellerId) {
        return NextResponse.json({ error: "sellerId is required" }, { status: 400 });
    }

    try {
        // Seller verification doc (contains businessName, bio, badge, etc.)
        const verSnap = await db
            .collection(COLLECTIONS.SELLER_VERIFICATIONS)
            .where("userId", "==", sellerId)
            .where("status", "==", "approved")
            .get();

        if (!verSnap.empty) {
            verSnap.docs.sort((a, b) => {
                const aTime = toMillis(a.data().createdAt);
                const bTime = toMillis(b.data().createdAt);
                return bTime - aTime;
            });
        }

        if (verSnap.empty) {
            return NextResponse.json(
                { error: "Seller not found or not yet approved" },
                { status: 404 }
            );
        }

        const verDoc = verSnap.docs[0];
        const verData = verDoc.data();

        // Active product listings
        let products: any[] = [];
        try {
            const prodSnap = await db
                .collection(COLLECTIONS.PRODUCTS)
                .where("sellerId", "==", sellerId)
                .where("status", "==", "active")
                .orderBy("createdAt", "desc")
                .limit(20)
                .get();

            products = prodSnap.docs.map((d) => ({
                id: d.id,
                title: d.data().title ?? d.data().name ?? "Unnamed",
                price: d.data().price ?? 0,
                unit: d.data().unit ?? "",
                category: d.data().category ?? "",
                images: d.data().images ?? [],
                stock: d.data().stock ?? d.data().quantity ?? null,
            }));
        } catch {
            products = [];
        }

        // Seller reviews aggregate
        let avgRating = 0;
        let reviewCount = 0;
        try {
            const reviewSnap = await db
                .collection(COLLECTIONS.SELLER_REVIEWS)
                .where("sellerId", "==", sellerId)
                .get();

            reviewCount = reviewSnap.size;
            if (reviewCount > 0) {
                const totalRating = reviewSnap.docs.reduce(
                    (sum, d) => sum + (Number(d.data().rating) || 0),
                    0
                );
                avgRating = Math.round((totalRating / reviewCount) * 10) / 10;
            }
        } catch {
            // reviews collection may not exist yet
        }

        return NextResponse.json({
            seller: {
                id: verDoc.id,
                userId: sellerId,
                businessName: verData.businessName ?? "",
                businessDescription: verData.businessDescription ?? verData.bio ?? "",
                businessType: verData.businessType ?? "",
                state: verData.state ?? verData.location ?? "",
                isVerifiedBadge: verData.isVerifiedBadge ?? false,
                logoUrl: verData.logoUrl ?? verData.businessLogo ?? null,
                approvedAt: verData.approvedAt?.toDate?.()?.toISOString() ?? null,
            },
            products,
            reviews: { avgRating, reviewCount },
        });
    } catch (err: unknown) {
        logger.error("[GET /api/marketplace/sellers/:id]", err);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
