"use server";

import { supabaseDb as db } from "@/lib/supabase-db";
import { logger } from '@/lib/logger';
import { COLLECTIONS, type ExportWindow } from "@/lib/types/firestore";
import { Timestamp } from "@/lib/firestore-compat";
import { unstable_cache } from "next/cache";

export type ExportOpportunity = { id: string;
    commodity: string;
    destination: string;
    openDate: Date | string;
    closeDate: Date | string;
    minInvestment: number;
    projectedROI: string;
    status: string;
    /**
     * `null` where the window has no spot limit, which is every window this
     * codebase currently creates — nothing writes `totalSpots`, and the
     * investment action treats its absence as NO LIMIT: "Check Funding Limit
     * (Optional - if totalSpots defined)".
     *
     * These were `number`, produced by `data.totalSpots || 0`, which collapsed
     * "no limit" into "zero left of zero". See the mapping below.
     */
    spotsLeft: number | null;
    totalSpots: number | null;
    image: string;
    // Deep data
    description?: string;
    specifications?: string[];
    benefits?: string[];
    documents?: {
        name: string;
        url?: string;
        required: boolean;
    }[];
    timeline?: { phase: string;
        duration: string;
        description: string;
        status: string;
    }[];
};

/**
 * How many spots are left, and out of how many — or `null` twice.
 *
 * "AVAILABLE SPOTS 0/0", ON A WINDOW WITH NO SPOT LIMIT.
 *
 * Both mappings in this file read
 *
 *     spotsLeft: (data.totalSpots || 0) - (data.spotsFilled || 0),
 *     totalSpots: data.totalSpots || 0,
 *
 * and nothing in this repository writes `totalSpots`. It is read in three
 * places, and the investment action states the contract out loud — "Check
 * Funding Limit (Optional - if totalSpots defined)", with
 * `if (exportData?.totalSpots && ...)` treating an absent value as NO LIMIT and
 * accepting the money.
 *
 * The two public pages did not agree. `|| 0` turns "no limit" into "zero", so
 * /export/windows rendered "0 spots" and /export/windows/{id} rendered
 *
 *     {window.spotsLeft}/{window.totalSpots}                    ->  0/0
 *     style={{ width: `${(spotsLeft / totalSpots) * 100}%` }}   ->  width: NaN%
 *
 * `NaN%` is not a length the browser accepts, so the declaration is dropped and
 * the bar falls back to `width: auto` inside a `w-full` parent — it renders
 * COMPLETELY FULL. Every open opportunity was presented as sold out, above an
 * invest button that works.
 *
 * `null` is the honest answer for a window with no cap; the pages omit the
 * meter rather than drawing a false one. A window that HAS a limit is unchanged,
 * including a genuinely full one, which still reports 0 left of N.
 */
function capacityOf(data: { totalSpots?: number | null; spotsFilled?: number | null }): {
    spotsLeft: number | null;
    totalSpots: number | null;
} {
    const total = typeof data.totalSpots === "number" && Number.isFinite(data.totalSpots)
        ? data.totalSpots
        : null;
    if (total === null) return { spotsLeft: null, totalSpots: null };
    return { spotsLeft: Math.max(0, total - (data.spotsFilled || 0)), totalSpots: total };
}

/**
 * Get all export investment opportunities
 */



/**
 * Get all export investment opportunities
 */

// Internal cached version
const getCachedExportOpportunities = (limit: number = 12, lastId?: string) => unstable_cache(
    async () => { try {
            let query = db.collection(COLLECTIONS.EXPORT_WINDOWS)
                .where("status", "in", ["open", "active"])
                .orderBy("createdAt", "desc");

            if (lastId) {
                const lastDoc = await db.collection(COLLECTIONS.EXPORT_WINDOWS).doc(lastId).get();
                if (lastDoc.exists) {
                    query = query.startAfter(lastDoc);
                }
            }

            /**
             * One extra row, so "is there more" is OBSERVED rather than guessed.
             *
             * This fetched exactly `limit` and inferred the cursor from a full
             * page:
             *
             *     const lastDocId = snapshot.docs.length === limit ? ...id : null;
             *     meta: { cursor: lastDocId, hasMore: !!lastDocId }
             *
             * `docs.length === limit` is true on the FINAL page whenever the
             * catalogue size is an exact multiple of the page size, so the feed
             * advertised another page and the next call came back empty.
             *
             * This codebase has corrected the identical line twice already — the
             * academy catalogue (#216) and the export window list, both of which
             * now read one extra row for exactly this reason. This was the third
             * copy.
             */
            query = query.limit(limit + 1);
            const snapshot = await query.get();

            const hasMore = snapshot.docs.length > limit;
            const pageDocs = hasMore ? snapshot.docs.slice(0, limit) : snapshot.docs;

            const opportunities = pageDocs.map(doc => { const data = doc.data() as ExportWindow;
                return {
                    id: doc.id,
                    commodity: data.commodity,
                    destination: (data as ExportWindow & { destination?: string }).destination || "International",
                    openDate: (data.startDate as unknown as Timestamp)?.toDate ? (data.startDate as unknown as Timestamp).toDate().toISOString() : new Date(data.startDate || Date.now()).toISOString(),
                    closeDate: (data.endDate as unknown as Timestamp)?.toDate ? (data.endDate as unknown as Timestamp).toDate().toISOString() : new Date(data.endDate || Date.now()).toISOString(),
                    minInvestment: data.amount,
                    projectedROI: data.roi,
                    status: data.status === "active" ? "Opening Soon" : "Open",
                    ...capacityOf(data),
                    image: data.image || "/images/export-placeholder.jpg",
                    // Deep data
                    description: data.description,
                    specifications: data.specifications || [],
                    benefits: data.benefits || [],
                    documents: data.documents || [],
                    timeline: (data.timeline as unknown as Array<Record<string, string>>)?.map(t => ({ phase: t.phase || "",
                        duration: t.date || t.duration || "TBD",
                        description: t.description || "",
                        status: t.status || "pending"
                    })) || [] };
            });

            const lastDocId = hasMore && pageDocs.length > 0
                ? pageDocs[pageDocs.length - 1].id
                : null;

            return { success: true as const, data: opportunities, error: null, meta: { cursor: lastDocId, hasMore } };
        } catch (error: any) { logger.error("Error fetching export opportunities:", error);
            return { success: false as const, data: null, error: error.message, meta: null };
        }
    },
    [`export-opportunities-${limit}-${lastId || 'start'}`],
    { revalidate: 60, tags: ["export-opportunities"] }
)();

/**
 * Get all export investment opportunities
 */
export async function getExportOpportunities(limit: number = 12, lastId?: string) { return getCachedExportOpportunities(limit, lastId); }

import { requireSession } from "@/lib/session-guard";

/**
 * Seed initial export opportunities (Temporary helper) - Admin Only
 */
export async function seedExportOpportunities() {
    const { session } = await requireSession();
    if (!session?.user) {
        return { success: false as const, error: "Authentication required", meta: null };
    }
    return { success: false as const, error: "Seeding is deprecated. Please create Export Windows from Admin Panel.", meta: null };
}

/**
 * Get single export opportunity by ID
 */

// Internal cached version
const getCachedExportOpportunityById = (id: string) => unstable_cache(
    async () => { try {
            const docRef = db.collection(COLLECTIONS.EXPORT_WINDOWS).doc(id);
            const snapshot = await docRef.get();

            if (!snapshot.exists) {
                return { success: false as const, error: "Opportunity not found", meta: null };
            }

            const data = snapshot.data() as ExportWindow;

            // Only a window that is actually open for investment.
            //
            // The LIST above filters `status in ["open", "active"]`. This
            // by-id sibling filtered nothing, so it served ANY export window to
            // an unauthenticated caller who knew its id — including the windows
            // createExportWindowAction writes for an exporter at
            // `status: "pending"`, which are that exporter's private trade
            // record: commodity, quantity, contract value (mapped below as
            // `minInvestment: data.amount`), destination and delivery date.
            //
            // It also mapped every status other than "active" to the label
            // "Open", so a pending or completed window was presented as
            // investable.
            //
            // Saying it is no longer open, rather than "not found", because a
            // bookmarked opportunity that has since closed is a real and
            // ordinary case and the visitor should be told which it is.
            const investable = data.status === "open" || data.status === "active";
            if (!investable) {
                return { success: false as const, error: "This export opportunity is no longer open", meta: null };
            }

            const opportunity: ExportOpportunity = { id: snapshot.id,
                commodity: data.commodity,
                destination: (data as ExportWindow & { destination?: string }).destination || "International",
                openDate: (data.startDate as unknown as Timestamp)?.toDate ? (data.startDate as unknown as Timestamp).toDate().toISOString() : new Date(data.startDate || Date.now()).toISOString(),
                closeDate: (data.endDate as unknown as Timestamp)?.toDate ? (data.endDate as unknown as Timestamp).toDate().toISOString() : new Date(data.endDate || Date.now()).toISOString(),
                minInvestment: data.amount,
                projectedROI: data.roi,
                status: data.status === "active" ? "Opening Soon" : "Open",
                ...capacityOf(data),
                image: data.image || "/images/export-placeholder.jpg",
                // Deep data
                description: data.description,
                specifications: data.specifications || [],
                benefits: data.benefits || [],
                documents: data.documents || [],
                timeline: (data.timeline as unknown as Array<Record<string, string>>)?.map(t => ({ phase: t.phase || "",
                    duration: t.date || t.duration || "TBD",
                    description: t.description || "",
                    status: t.status || "pending"
                })) || [] };

            return { error: null,  success: true as const, data: opportunity, meta: null };
        } catch (error: any) { logger.error("Error fetching export opportunity:", error);
            return { success: false as const, error: error.message, meta: null };
        }
    },
    [`export-opportunity-${id}`],
    { revalidate: 3600, tags: [`export-opportunity-${id}`] }
)();

/**
 * Get single export opportunity by ID
 */
export async function getExportOpportunityById(id: string) { return getCachedExportOpportunityById(id); }
