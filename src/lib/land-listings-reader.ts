import "server-only";

import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { PUBLIC_LAND_STATUSES, stripInternalLandFields } from "@/lib/land-visibility";

/**
 * The publicly visible land listings, read once and defined once.
 *
 *   #562 TWO SCREENS ASKED THEIR OWN SERVER FOR THIS OVER HTTP.
 *
 *   /land and /farm-nation/map are both "use client" pages whose first act on
 *   mount was `fetch("/api/farm-nation/listings")`. That is the hydration
 *   waterfall of #545 with an extra hop in it: the HTML arrives, the bundle
 *   downloads, React hydrates, and only THEN does the browser open a second
 *   HTTP request back to the same server that just rendered the page — through
 *   the proxy, through middleware, through route matching — to fetch data that
 *   server could have put in the response it had already written.
 *
 * ── WHY A SHARED READER AND NOT A DIRECT DATABASE CALL IN EACH PAGE ─────────
 *
 *   Because the route handler was not only a query. It carries two decisions
 *   that were each a defect once:
 *
 *     WHICH STATUSES ARE PUBLIC. The handler queried "verified" alone while
 *     land-actions.ts treated "verified" and "approved" as public, so a listing
 *     an admin approved was visible to one half of the platform and invisible
 *     to the other. PUBLIC_LAND_STATUSES is the shared answer.
 *
 *     WHAT A STRANGER MAY SEE. The handler spread the stored document, so the
 *     reviewing admin's user id, the internal rejectionReason and
 *     verificationNotes and the owner's email went to an endpoint that has no
 *     authentication at all. stripInternalLandFields is the shared answer.
 *
 *   Copying the query into two server pages would have made three copies of
 *   both decisions, which is the defect class this audit keeps finding — the
 *   same contract, restated, until the restatements disagree. So the handler's
 *   body moves here, and the route now calls this too. One reader, three
 *   callers, and the route keeps working for anything else that calls it.
 *
 * ── AND IT IS STILL PUBLIC ──────────────────────────────────────────────────
 *
 *   No session is read here, and none was read by the route. This function
 *   returns exactly what an unauthenticated GET of that route returned, which
 *   is the point: moving a read to the server must not quietly widen it.
 */
export async function readPublicLandListings(): Promise<Record<string, any>[]> {
    const snapshot = await db.collection(COLLECTIONS.LAND_LISTINGS)
        .where("status", "in", [...PUBLIC_LAND_STATUSES])
        .orderBy("createdAt", "desc")
        .get();

    return snapshot.docs.map((doc: any) => {
        const data = stripInternalLandFields(doc.data() ?? {});
        return {
            id: doc.id,
            ...data,
            totalPrice: data.totalPrice ?? data.price ?? 0,
            price: data.price ?? data.totalPrice ?? 0,
            verificationStatus: data.status || "pending",
            createdAt: data.createdAt?.toDate?.() || new Date(),
            updatedAt: data.updatedAt?.toDate?.() || new Date(),
        };
    });
}
