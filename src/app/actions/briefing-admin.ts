"use server";

import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { requireSession } from "@/lib/session-guard";
import { hasAdminPermission } from "@/lib/admin-permissions";
import { logger } from "@/lib/logger";
import { BriefingRegistrationData, BriefingStatus } from "./briefing";
import { serializeValue, toMillis } from "@/lib/firestore-serialize";

export interface BriefingRegistration extends BriefingRegistrationData { id: string;
    createdAt: string; // ISO string — safe for server→client boundary
    updatedAt: string; // ISO string
    status: BriefingStatus;
    attended: boolean;
    confirmationSent: boolean; }

export interface BriefingRegistrationsResult {
    error: string | null;
    success: boolean;
    data?: BriefingRegistration[];
    meta: {
        cursor: string | null;
        hasMore: boolean;
        totalCount?: number;
    };
}

/**
 * Rows the index fallback can read in one pass. Mirrors the adapter's
 * SUPABASE_DEFAULT_QUERY_LIMIT, which is what actually caps that query — this
 * constant exists so reaching the cap can be reported rather than guessed at.
 */
const FALLBACK_SAMPLE_LIMIT = Math.max(1, Number(process.env.SUPABASE_DEFAULT_QUERY_LIMIT) || 5000);

/**
 * A timestamp as an ISO string, or "" when there is no timestamp to report.
 *
 * Never invents one. See the createdAt note in the mapper below.
 */
function isoOrEmpty(value: unknown): string {
    const ms = toMillis(value);
    return ms > 0 ? new Date(ms).toISOString() : "";
}

/**
 * Options for fetching briefing registrations with server-side filters.
 */
export interface BriefingRegistrationOpts { lastDocId?: string | null;
    limit?: number;
    /** Filter by Nigerian state */
    state?: string;
    /** Filter by role (e.g. "investor", "farm_owner") */
    role?: string;
    /** Filter by status ("registered", "attended", "cancelled") */
    status?: string;
    /** Free-text search — applied client-side (Firestore has no LIKE) */
    search?: string; }

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
): Promise<BriefingRegistrationsResult> { try {
        // --- Normalise arguments: support old (cursor, limit) and new (opts) signatures ---
        let cursor: string | null | undefined;
        let limit = 25;
        let filterState: string | undefined;
        let filterRole: string | undefined;
        let filterStatus: string | undefined;
        let searchQuery: string | undefined;

        if (typeof opts === "string" || opts === null) {
            // Legacy call: getBriefingRegistrationsAction(cursor, limit)
            cursor = opts as string | null;
            limit = limitArg ?? 25;
        } else if (opts && typeof opts === "object") { cursor = opts.lastDocId;
            limit = opts.limit ?? limitArg ?? 25;
            filterState = opts.state && opts.state !== "all" ? opts.state : undefined;
            filterRole = opts.role && opts.role !== "all" ? opts.role : undefined;
            filterStatus = opts.status && opts.status !== "all" ? opts.status : undefined;
            searchQuery = opts.search?.trim().toLowerCase() || undefined;
        }

        const sessionResult = await requireSession();
        if (!sessionResult.session) { return { success: false as const, error: "Your session has expired. Please log in again.", meta: { cursor: null, hasMore: false } };
        }
        const { session } = sessionResult;

        /**
         * The WAVE admin could not open the WAVE guest list.
         *
         * This was a hand-written pair — `roles.includes("admin") ||
         * roles.includes("super_admin")` — and `wave_admin` is in neither. That
         * role runs every other screen under /admin/wave: the application
         * queue, training events, certificates, live sessions, withdrawals.
         * The registrations page for the briefing it administers was the one
         * door closed to it, and only because this file asked the role list
         * directly instead of the matrix.
         *
         * "wave:approve_applications" is what the sibling application queue
         * uses, and a briefing registration is the same kind of record: a
         * person who has applied to attend. Same correction as #115, #122
         * and #158.
         */
        if (!hasAdminPermission(session.user.roles, "wave:approve_applications")) {
            return { success: false as const, error: "Unauthorized: WAVE admin permission required", meta: { cursor: null, hasMore: false } };
        }

        const pageSize = searchQuery ? 5000 : Math.min(Math.max(limit, 1), 5000);

        // --- Build Firestore query with server-side filters ---
        let query: import("@/lib/supabase-db").SupabaseQuery = db
            .collection(COLLECTIONS.WAVE_BRIEFING_REGISTRATIONS);

        if (filterState) { query = query.where("state", "==", filterState);
        }
        if (filterRole) { query = query.where("role", "==", filterRole);
        }
        if (filterStatus) { query = query.where("status", "==", filterStatus);
        }

        query = query.orderBy("createdAt", "desc").limit(pageSize + 1); // +1 to detect hasMore

        if (cursor) { const cursorDate = new Date(cursor);
            if (!isNaN(cursorDate.getTime())) {
                query = query.startAfter(cursorDate);
            }
        }

        // Build count query with same filters
        let countQuery: import("@/lib/supabase-db").SupabaseQuery = db
            .collection(COLLECTIONS.WAVE_BRIEFING_REGISTRATIONS);
        if (filterState) countQuery = countQuery.where("state", "==", filterState);
        if (filterRole) countQuery = countQuery.where("role", "==", filterRole);
        if (filterStatus) countQuery = countQuery.where("status", "==", filterStatus);

        let snapshot: any;
        let countSnap: any;

        try { const results = await Promise.all([
                query.get(),
                countQuery.count().get()
            ]);
            snapshot = results[0];
            countSnap = results[1];
        } catch (e: any) { // Fallback for when composite indexes are missing on production
            if (e.message && String(e.message).toLowerCase().includes("index")) {
                logger.warn("Missing composite index, falling back to in-memory filter...");
                try {
                    /**
                     * ORDERED, so the sample is the newest rows and not an
                     * arbitrary slab.
                     *
                     * This query had no orderBy and no limit. A query with
                     * neither is capped at SUPABASE_DEFAULT_QUERY_LIMIT (5,000)
                     * and, with no ordering of its own, the adapter falls back
                     * to `.order('id')` — so past 5,000 registrations this read
                     * the first 5,000 BY ID, sorted those in memory, and
                     * presented the top as "the most recent registrations".
                     * The newest registrant could be absent from a list sorted
                     * by recency, and totalCount froze at 5,000 for ever.
                     *
                     * Sorting on one column needs no composite index, which is
                     * the entire premise of this fallback — the filters are
                     * still applied in memory below.
                     */
                    const fallbackQuery: import("@/lib/supabase-db").SupabaseQuery = db
                        .collection(COLLECTIONS.WAVE_BRIEFING_REGISTRATIONS)
                        .orderBy("createdAt", "desc");

                    const allDocsSnap = await fallbackQuery.get();
                    let allDocs = allDocsSnap.docs;

                    // Truncation must be visible. A short result that looks
                    // complete is how "the report is missing rows" reaches
                    // production — the adapter says the same about its own cap.
                    if (allDocs.length >= FALLBACK_SAMPLE_LIMIT) {
                        logger.warn(
                            `[briefing-admin] Index fallback read the ${FALLBACK_SAMPLE_LIMIT}-row cap. ` +
                            `Counts and later pages cover only the newest ${FALLBACK_SAMPLE_LIMIT} registrations.`
                        );
                    }

                    // Filter in memory
                    if (filterState) {
                        allDocs = allDocs.filter(doc => doc.data().state === filterState);
                    }
                    if (filterRole) { allDocs = allDocs.filter(doc => doc.data().role === filterRole);
                    }
                    if (filterStatus) { allDocs = allDocs.filter(doc => doc.data().status === filterStatus);
                    }
                    
                    // Sort chronologically in memory to mimic orderBy("createdAt", "desc").
                    //
                    // Through toMillis, the shared helper, rather than
                    // `createdAt?.toMillis?.()` — which scores 0 for a Date, a
                    // number and a raw {_seconds} object, putting those rows at
                    // the BOTTOM of a newest-first list. That is #49.
                    allDocs.sort((a, b) => toMillis(b.data().createdAt) - toMillis(a.data().createdAt));

                    let startIndex = 0;
                    if (cursor) { const cursorTime = new Date(cursor).getTime();
                        if (!isNaN(cursorTime)) {
                            while (startIndex < allDocs.length && toMillis(allDocs[startIndex].data().createdAt) >= cursorTime) {
                                startIndex++;
                            }
                        }
                    }
                    
                    const slicedDocs = allDocs.slice(startIndex, startIndex + pageSize + 1);
                    snapshot = { docs: slicedDocs };
                    countSnap = { data: () => ({ count: allDocs.length }) };
                } catch (fallbackError: any) { logger.error("Fallback query also failed:", fallbackError);
                    throw fallbackError;
                }
            } else { logger.error("Primary query failed with non-index error:", e);
                throw e; // rethrow other errors
            }
        }
        
        const hasMore = snapshot.docs && snapshot.docs.length > pageSize;
        const docs = hasMore ? snapshot.docs.slice(0, pageSize) : snapshot.docs;
        const totalCount = countSnap.data().count;

        let data: BriefingRegistration[] = docs.map((doc: any) => { const d = doc.data();
            return {
                ...serializeValue(d),
                id: doc.id,
                phoneNumber: d.phoneNumber || d.phone || d.kyc?.phoneNumber || d.kyc?.phone || "",
                /**
                 * A registration with no timestamp is DATELESS, not registered
                 * today.
                 *
                 * `?? new Date().toISOString()` invented the current instant
                 * for any row whose createdAt did not answer toDate(). The
                 * adapter hydrates ISO strings into Timestamps on read, so
                 * those are fine; the shapes that are not are a MISSING
                 * createdAt and a legacy `{_seconds, _nanoseconds}` object,
                 * which convertStringsToTimestamps leaves as a plain object
                 * with no toDate. Both came out as today, in the table's
                 * Registered Date column and in the CSV of the same name — a
                 * fabricated date is worse than a blank one, because nothing
                 * about it looks wrong.
                 *
                 * isoOrEmpty reads every shape through the shared helper and
                 * returns "" when there genuinely is nothing. The table renders
                 * an em dash for an empty value and the CSV a blank cell.
                 */
                createdAt: isoOrEmpty(d.createdAt),
                updatedAt: isoOrEmpty(d.updatedAt),
                status: d.status || "registered",
                attended: d.attended ?? false,
                confirmationSent: d.confirmationSent ?? false } as BriefingRegistration;
        });

        // --- Client-side free-text search (Firestore has no full-text search) ---
        if (searchQuery) { 
            const q = searchQuery.toLowerCase().trim();
            data = data.filter((r: any) => {
                const searchString = [r.fullName, r.email, r.phoneNumber].filter(Boolean).map(String).join(" ").toLowerCase();
                return searchString.includes(q);
            });
        }

        // Same shape as the mapper above: `?.toDate?.()` answers for one of the
        // several timestamp shapes this codebase writes. A cursor that came out
        // null on a page that HAS more stops pagination dead, so this reads
        // through the shared helper too.
        const nextCursor = hasMore && docs.length > 0
            ? (isoOrEmpty(docs[docs.length - 1].data().createdAt) || null)
            : null;

        return { error: null, success: true as const, data, meta: { cursor: nextCursor, hasMore, totalCount } };
    } catch (error: any) { logger.error("getBriefingRegistrationsAction error:", error);
        
        // Next.js Server Actions strip standard Error objects, so we extract the message manually
        let errorMessage = "Failed to fetch registrations";
        if (error?.message) {
            errorMessage = error.message;
        } else if (typeof error === "string") { errorMessage = error;
        } else if (error?.details) { errorMessage = String(error.details);
        } else if (error) { errorMessage = String(error);
        }
        
        return { success: false as const, error: errorMessage, meta: { cursor: null, hasMore: false, totalCount: 0 } 
        };
    }
}
