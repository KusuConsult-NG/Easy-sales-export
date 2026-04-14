"use server";

import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { requireSession } from "@/lib/session-guard";
import { logger } from "@/lib/logger";
import { BriefingRegistrationData, BriefingStatus } from "./briefing";

export interface BriefingRegistration extends BriefingRegistrationData {
    id: string;
    createdAt: string; // ISO string — safe for server→client boundary
    updatedAt: string; // ISO string
    status: BriefingStatus;
    attended: boolean;
    confirmationSent: boolean;
}

export interface BriefingRegistrationsResult {
    success: boolean;
    data?: BriefingRegistration[];
    error?: string;
    meta: {
        cursor: string | null;
        hasMore: boolean;
    };
}

/**
 * Fetch WAVE Briefing Registrations with cursor-based pagination (Admin Only)
 *
 * @param cursor - ISO timestamp of the last item's createdAt from previous page
 * @param limit  - number of records per page (default 25, max 50)
 */
export async function getBriefingRegistrationsAction(
    cursor?: string | null,
    limit = 25
): Promise<BriefingRegistrationsResult> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) {
            return { success: false, error: "Your session has expired. Please log in again.", meta: { cursor: null, hasMore: false } };
        }
        const { session } = sessionResult;

        const hasAdminRole =
            session.user.roles?.includes("admin") ||
            session.user.roles?.includes("super_admin");

        if (!hasAdminRole) {
            return { success: false, error: "Unauthorized: Admin access required", meta: { cursor: null, hasMore: false } };
        }

        const pageSize = Math.min(Math.max(limit, 1), 50);

        let query: FirebaseFirestore.Query = db
            .collection(COLLECTIONS.WAVE_BRIEFING_REGISTRATIONS)
            .orderBy("createdAt", "desc")
            .limit(pageSize + 1); // +1 to detect hasMore

        if (cursor) {
            const cursorDate = new Date(cursor);
            if (!isNaN(cursorDate.getTime())) {
                query = query.startAfter(cursorDate);
            }
        }

        const snapshot = await query.get();
        const hasMore = snapshot.docs.length > pageSize;
        const docs = hasMore ? snapshot.docs.slice(0, pageSize) : snapshot.docs;

        const data: BriefingRegistration[] = docs.map(doc => {
            const d = doc.data();
            return {
                id: doc.id,
                ...d,
                createdAt: d.createdAt?.toDate?.()?.toISOString() ?? new Date().toISOString(),
                updatedAt: d.updatedAt?.toDate?.()?.toISOString() ?? new Date().toISOString(),
                status: d.status || "registered",
                attended: d.attended ?? false,
                confirmationSent: d.confirmationSent ?? false,
            } as BriefingRegistration;
        });

        const nextCursor = hasMore && docs.length > 0
            ? docs[docs.length - 1].data().createdAt?.toDate?.()?.toISOString() ?? null
            : null;

        return {
            success: true,
            data,
            meta: { cursor: nextCursor, hasMore },
        };
    } catch (error) {
        logger.error("getBriefingRegistrationsAction error:", error);
        return { success: false, error: "Failed to fetch registrations", meta: { cursor: null, hasMore: false } };
    }
}
