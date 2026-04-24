export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";

/**
 * GET - List user's certificates
 */
export async function GET(request: NextRequest) {
    try {
        const session = (await requireSession()).session;

        if (!session?.user) {
            return NextResponse.json(
                { success: false, error: "Unauthorized" },
                { status: 401 }
            );
        }

        // List certificates (Admin SDK)
        const snapshot = await db.collection(COLLECTIONS.USER_CERTIFICATES)
            .where("userId", "==", session.user.id)
            .get();

        const certificates = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            uploadedAt: doc.data().uploadedAt?.toDate(),
        }));

        return NextResponse.json({
            success: true,
            certificates,
        });
    } catch (error: any) {
        logger.error("Cert fetch error:", error);
        return NextResponse.json(
            { success: false, error: "Failed to fetch certificates" },
            { status: 500 }
        );
    }
}
