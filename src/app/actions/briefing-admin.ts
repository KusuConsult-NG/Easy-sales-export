"use server";

import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { requireSession } from "@/lib/session-guard";
import { logger } from "@/lib/logger";
import { BriefingRegistrationData, BriefingStatus } from "./briefing";
import { serializeValue } from "@/lib/firestore-serialize";

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
            cursor = opts;
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

        const hasAdminRole =
            session.user.roles?.includes("admin") ||
            session.user.roles?.includes("super_admin");

        if (!hasAdminRole) { return { success: false as const, error: "Unauthorized: Admin access required", meta: { cursor: null, hasMore: false } };
        }

        const pageSize = searchQuery ? 5000 : Math.min(Math.max(limit, 1), 5000);

        // --- Build Firestore query with server-side filters ---
        let query: FirebaseFirestore.Query = db
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
        let countQuery: FirebaseFirestore.Query = db
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
                    const fallbackQuery: FirebaseFirestore.Query = db.collection(COLLECTIONS.WAVE_BRIEFING_REGISTRATIONS);
                    
                    const allDocsSnap = await fallbackQuery.get();
                    let allDocs = allDocsSnap.docs;
                    
                    // Filter in memory
                    if (filterState) {
                        allDocs = allDocs.filter(doc => doc.data().state === filterState);
                    }
                    if (filterRole) { allDocs = allDocs.filter(doc => doc.data().role === filterRole);
                    }
                    if (filterStatus) { allDocs = allDocs.filter(doc => doc.data().status === filterStatus);
                    }
                    
                    // Sort chronologically in memory to mimic orderBy("createdAt", "desc")
                    allDocs.sort((a, b) => { const timeA = a.data().createdAt?.toMillis?.() ?? 0;
                        const timeB = b.data().createdAt?.toMillis?.() ?? 0;
                        return timeB - timeA;
                    });
                    
                    let startIndex = 0;
                    if (cursor) { const cursorTime = new Date(cursor).getTime();
                        if (!isNaN(cursorTime)) {
                            while (startIndex < allDocs.length && (allDocs[startIndex].data().createdAt?.toMillis?.() ?? 0) >= cursorTime) {
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
                createdAt: d.createdAt?.toDate?.()?.toISOString() ?? new Date().toISOString(),
                updatedAt: d.updatedAt?.toDate?.()?.toISOString() ?? new Date().toISOString(),
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

        const nextCursor = hasMore && docs.length > 0
            ? docs[docs.length - 1].data().createdAt?.toDate?.()?.toISOString() ?? null
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
