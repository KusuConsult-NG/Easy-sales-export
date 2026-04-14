export const dynamic = 'force-dynamic';

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAdminDb } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from "@/lib/logger";

// Default catalog (used when Firestore collection is empty)
const DEFAULT_CATALOG = [
    { id: "cashew-nuts", name: "Cashew Nuts", icon: "🥜", origin: "Ogbomoso, Oyo State", season: "Feb - May", category: "nuts", grades: ["W320", "W240", "W210"], certifications: ["NAFDAC", "SON"], pricePerMT: 2850, minOrderMT: 20 },
    { id: "sesame-seeds", name: "Sesame Seeds", icon: "🌰", origin: "Jigawa & Nassarawa", season: "Oct - Jan", category: "nuts", grades: ["White (99%)", "Brown (98%)"], certifications: ["NAFDAC", "SGS"], pricePerMT: 1750, minOrderMT: 25 },
    { id: "dried-hibiscus", name: "Dried Hibiscus (Zobo)", icon: "🌺", origin: "Kano & Jigawa", season: "Nov - Mar", category: "spices", grades: ["Dark Red", "Light Red"], certifications: ["NAFDAC", "EU Compliant"], pricePerMT: 2200, minOrderMT: 15 },
    { id: "cocoa-beans", name: "Cocoa Beans", icon: "🫘", origin: "Ondo & Cross River", season: "Sep - Feb", category: "nuts", grades: ["Grade A", "Grade B"], certifications: ["NAFDAC", "ICO"], pricePerMT: 3400, minOrderMT: 10 },
    { id: "shea-butter", name: "Shea Butter", icon: "🧴", origin: "Niger & Kwara", season: "Year-round", category: "oils", grades: ["Unrefined Grade A", "Refined"], certifications: ["NAFDAC", "Organic Certified"], pricePerMT: 1900, minOrderMT: 5 },
    { id: "ginger", name: "Ginger", icon: "🫚", origin: "Kaduna & Nasarawa", season: "Nov - Mar", category: "spices", grades: ["Split Dried", "Powder"], certifications: ["NAFDAC", "EU Compliant"], pricePerMT: 2600, minOrderMT: 15 },
    { id: "moringa-leaves", name: "Moringa Leaves (Dried)", icon: "🍃", origin: "Kebbi & Sokoto", season: "Year-round", category: "spices", grades: ["Grade A Powder", "Whole Dried"], certifications: ["Organic Certified", "EU Compliant"], pricePerMT: 3200, minOrderMT: 5 },
    { id: "charcoal", name: "Hardwood Charcoal", icon: "🪵", origin: "Benue & Nassarawa", season: "Year-round", category: "other", grades: ["Lump (80mm+)", "BBQ Grade"], certifications: ["SON", "FSC Compliant"], pricePerMT: 450, minOrderMT: 28 },
];

export async function GET() {
    try {
        const db = getAdminDb();
        const snap = await db.collection(COLLECTIONS.EXPORT_CATALOG)
            .where("isActive", "==", true)
            .orderBy("sortOrder", "asc")
            .get();

        if (!snap.empty) {
            const products = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            return NextResponse.json({ success: true, data: { products }, meta: null });
        }

        // Firestore catalog empty — seed from defaults and return them
        return NextResponse.json({ success: true, data: { products: DEFAULT_CATALOG, source: "default" }, meta: null });
    } catch (error) {
        logger.error("GET /api/export/catalog error:", error);
        return NextResponse.json({ success: true, data: { products: DEFAULT_CATALOG, source: "default" }, meta: null });
    }
}

export async function POST(req: Request) {
    try {
        const session = await auth();
        const isAdmin = session?.user?.roles?.includes("admin") || session?.user?.roles?.includes("super_admin");
        if (!isAdmin) {
            return NextResponse.json({ success: false, data: null, error: "Unauthorized", meta: null }, { status: 403 });
        }

        const body = await req.json();
        const db = getAdminDb();

        if (body.id) {
            // Update existing
            await db.collection(COLLECTIONS.EXPORT_CATALOG).doc(body.id).set({
                ...body,
                updatedAt: new Date(),
                updatedBy: session!.user.id,
            }, { merge: true });
            return NextResponse.json({ success: true, data: { id: body.id }, meta: null });
        } else {
            // Create new
            const ref = await db.collection(COLLECTIONS.EXPORT_CATALOG).add({
                ...body,
                isActive: true,
                sortOrder: Date.now(),
                createdAt: new Date(),
                createdBy: session!.user.id,
            });
            return NextResponse.json({ success: true, data: { id: ref.id }, meta: null });
        }
    } catch (error) {
        logger.error("POST /api/export/catalog error:", error);
        return NextResponse.json({ success: false, data: null, error: "Failed to save catalog item", meta: null }, { status: 500 });
    }
}

export async function DELETE(req: Request) {
    try {
        const session = await auth();
        const isAdmin = session?.user?.roles?.includes("admin") || session?.user?.roles?.includes("super_admin");
        if (!isAdmin) {
            return NextResponse.json({ success: false, data: null, error: "Unauthorized", meta: null }, { status: 403 });
        }

        const { searchParams } = new URL(req.url);
        const id = searchParams.get("id");
        if (!id) return NextResponse.json({ success: false, data: null, error: "Missing id", meta: null }, { status: 400 });

        const db = getAdminDb();
        await db.collection(COLLECTIONS.EXPORT_CATALOG).doc(id).update({ isActive: false, deletedAt: new Date() });

        return NextResponse.json({ success: true, data: null, meta: null });
    } catch (error) {
        logger.error("DELETE /api/export/catalog error:", error);
        return NextResponse.json({ success: false, data: null, error: "Failed to delete item", meta: null }, { status: 500 });
    }
}
