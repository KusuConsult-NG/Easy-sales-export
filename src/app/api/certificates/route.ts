export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { isRetired } from "@/lib/record-retirement";

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

        // #303 A certificate the member removed leaves this list. The row and
        // the stored file both survive — see the DELETE route — so the filter
        // here is what makes "removed" mean removed to the person who asked.
        const certificates = snapshot.docs.filter(doc => !isRetired(doc.data())).map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                ...data,
                uploadedAt: data.uploadedAt?.toDate?.()?.toISOString?.() ?? data.uploadedAt ?? null,
                createdAt: data.createdAt?.toDate?.()?.toISOString?.() ?? data.createdAt ?? null,
            };
        });

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
