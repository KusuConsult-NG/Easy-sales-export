import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";

export const dynamic = 'force-dynamic';

/**
 * The fields a buyer's browser is given.
 *
 * This endpoint has no authentication — correctly, it is a public product list
 * — and it returned `{ id, ...doc.data() }`, the whole stored document.
 *
 * Two things came with that. Every listing carries `userId`, the internal id of
 * the seller who submitted it, so the public catalogue published one for each.
 * And the submit action stores its input wholesale — its own comment says
 * "productData arrives as `any` and is stored wholesale — no schema, no checks"
 * — so any field a seller chose to include was published the moment an admin
 * set isActive.
 *
 * An allow-list rather than a deny-list: a field added to the document later is
 * then private by default, which is the way round that survives someone
 * else's change.
 *
 * These are exactly the fields ExportProduct declares and the buyer page reads.
 */
const PUBLIC_CATALOG_FIELDS = [
    "name",
    "icon",
    "origin",
    "season",
    "category",
    "grades",
    "certifications",
    "pricePerMT",
    "minOrderMT",
] as const;

export async function GET() {
    try {
        const db = getAdminDb();
        const snapshot = await db.collection(COLLECTIONS.EXPORT_CATALOG)
            .where("isActive", "==", true)
            .get();

        const products = snapshot.docs.map((doc: any) => {
            const data = doc.data() ?? {};
            const product: Record<string, unknown> = { id: doc.id };
            for (const field of PUBLIC_CATALOG_FIELDS) {
                if (data[field] !== undefined) product[field] = data[field];
            }
            return product;
        });

        return NextResponse.json({
            success: true,
            products
        });
    } catch (error) {
        console.error("Export catalog fetch error:", error);
        return NextResponse.json({
            success: false,
            error: "Failed to fetch export catalog"
        }, { status: 500 });
    }
}
