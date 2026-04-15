export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase-admin";
import { FEATURE_METADATA } from "@/lib/feature-toggles";
import { COLLECTIONS } from "@/lib/types/firestore";

export async function POST() {
    try {
        const session = await auth();
        if (!session?.user?.roles?.includes("super_admin")) {
            return NextResponse.json({ success: false, message: "Super Admin access required" }, { status: 403 });
        }

        const batch = db.batch();
        const collectionRef = db.collection(COLLECTIONS.FEATURE_TOGGLES);

        for (const toggleId in FEATURE_METADATA) {
            const meta = FEATURE_METADATA[toggleId];
            const docRef = collectionRef.doc(toggleId);
            batch.set(docRef, {
                enabled: meta.defaultEnabled || false,
                name: meta.name,
                description: meta.description,
                category: meta.category,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                updatedBy: session.user.id
            }, { merge: true });
        }

        await batch.commit();

        return NextResponse.json({ success: true, message: "Default features seeded" });
    } catch (error) {
        logger.error("Failed to seed toggles:", error);
        return NextResponse.json({ success: false, message: "Internal error" }, { status: 500 });
    }
}
