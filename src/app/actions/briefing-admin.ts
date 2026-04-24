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
        totalCount?: number;
    };
}

/**
 * Options for fetching briefing registrations with server-side filters.
 */
export interface BriefingRegistrationOpts {
    lastDocId?: string | null;
    limit?: number;
    /** Filter by Nigerian state */
    state?: string;
    /** Filter by role (e.g. "investor", "farm_owner") */
    role?: string;
    /** Filter by status ("registered", "attended", "cancelled") */
    status?: string;
    /** Free-text search — applied client-side (Firestore has no LIKE) */
    search?: string;
}

/**
 * Fetch WAVE Briefing Registrations with cursor-based pagination & server-side filters (Admin Only)
 *
 * Supports filtering by state, role, and status via Firestore .where() clauses.
 * Free-text search is applied client-side after fetch.
 *
 * @param opts - pagination + filter options
 */
export async function getBriefingRegistrationsAction(
    opts: BriefingRegistrationOpts | string | null = {},
    limitArg?: number
): Promise<BriefingRegistrationsResult> {
    try {
        // --- Normalise arguments: support old (cursor, limit) and new (opts) signatures ---
        let cursor: string | null | undefined;
        let limit = 25;
        let filterState: string | undefined;
        let filterRole: string | undefined;
        let filterStatus: string | undefined;
        let searchQuery: string | undefined;

        if (typeof opts === "string" || opts === null) {
            // Legacy call: getBriefingRegistrationsAction(cursor, limit)
            cursor = opts;
            limit = limitArg ?? 25;
        } else if (opts && typeof opts === "object") {
            cursor = opts.lastDocId;
            limit = opts.limit ?? limitArg ?? 25;
            filterState = opts.state && opts.state !== "all" ? opts.state : undefined;
            filterRole = opts.role && opts.role !== "all" ? opts.role : undefined;
            filterStatus = opts.status && opts.status !== "all" ? opts.status : undefined;
            searchQuery = opts.search?.trim().toLowerCase() || undefined;
        }

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

        const pageSize = Math.min(Math.max(limit, 1), 5000);

        // --- Build Firestore query with server-side filters ---
        let query: FirebaseFirestore.Query = db
            .collection(COLLECTIONS.WAVE_BRIEFING_REGISTRATIONS);

        if (filterState) {
            query = query.where("state", "==", filterState);
        }
        if (filterRole) {
            query = query.where("role", "==", filterRole);
        }
        if (filterStatus) {
            query = query.where("status", "==", filterStatus);
        }

        query = query.orderBy("createdAt", "desc").limit(pageSize + 1); // +1 to detect hasMore

        if (cursor) {
            const cursorDate = new Date(cursor);
            if (!isNaN(cursorDate.getTime())) {
                query = query.startAfter(cursorDate);
            }
        }

        // Build count query with same filters
        let countQuery: FirebaseFirestore.Query = db
            .collection(COLLECTIONS.WAVE_BRIEFING_REGISTRATIONS);
        if (filterState) countQuery = countQuery.where("state", "==", filterState);
        if (filterRole) countQuery = countQuery.where("role", "==", filterRole);
        if (filterStatus) countQuery = countQuery.where("status", "==", filterStatus);

        const [snapshot, countSnap] = await Promise.all([
            query.get(),
            countQuery.count().get()
        ]);
        
        const hasMore = snapshot.docs.length > pageSize;
        const docs = hasMore ? snapshot.docs.slice(0, pageSize) : snapshot.docs;
        const totalCount = countSnap.data().count;

        let data: BriefingRegistration[] = docs.map(doc => {
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

        // --- Client-side free-text search (Firestore has no full-text search) ---
        if (searchQuery) {
            data = data.filter(r =>
                r.fullName?.toLowerCase().includes(searchQuery!) ||
                r.email?.toLowerCase().includes(searchQuery!) ||
                r.phoneNumber?.toLowerCase().includes(searchQuery!)
            );
        }

        const nextCursor = hasMore && docs.length > 0
            ? docs[docs.length - 1].data().createdAt?.toDate?.()?.toISOString() ?? null
            : null;

        return { success: true, data,
            meta: { cursor: nextCursor, hasMore, totalCount } };
    } catch (error) {
        logger.error("getBriefingRegistrationsAction error:", error);
        return { success: false, error: "Failed to fetch registrations", meta: { cursor: null, hasMore: false, totalCount: 0 } };
    }
}
