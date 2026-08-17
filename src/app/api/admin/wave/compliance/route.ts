export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { isAdmin } from "@/lib/admin-permissions";
import { AggregateField } from "@/lib/firestore-compat";

/**
 * API Route: Get WAVE Compliance Data (Admin)
 *
 * Stats (approved, rejected, pending, total) use Firestore COUNT queries
 * for accuracy. Demographics (age groups, states, business types) still
 * require fetching docs because Firestore cannot GROUP BY arbitrary fields.
 *
 * IMPORTANT: A document with no "status" field is NOT defaulted to "pending"
 * in any count — if it has no status it belongs in neither bucket.
 */
export async function GET(request: NextRequest) {
    try {
        const session = (await requireSession()).session;
        if (!session?.user) {
            return NextResponse.json(
                { success: false, message: "Unauthorized" },
                { status: 401 }
            );
        }

        if (!isAdmin(session.user.roles)) {
            return NextResponse.json(
                { success: false, message: "Admin access required" },
                { status: 403 }
            );
        }

        const { searchParams } = new URL(request.url);
        const timeframe = searchParams.get("timeframe") || "all";

        // Calculate date filter
        let dateFilter: Date | null = null;
        const now = new Date();

        switch (timeframe) {
            case "month":
                dateFilter = new Date(now.getFullYear(), now.getMonth(), 1);
                break;
            case "quarter": {
                const quarter = Math.floor(now.getMonth() / 3);
                dateFilter = new Date(now.getFullYear(), quarter * 3, 1);
                break;
            }
            case "year":
                dateFilter = new Date(now.getFullYear(), 0, 1);
                break;
        }

        let baseQuery: import("@/lib/supabase-db").SupabaseQuery = db.collection(COLLECTIONS.WAVE_APPLICATIONS);
        if (dateFilter) {
            baseQuery = baseQuery.where("createdAt", ">=", dateFilter);
        }

        // --- Accurate counts via Firestore COUNT (no JS-side filtering) ---
        const [totalSnap, approvedSnap, rejectedSnap, pendingSnap] = await Promise.all([
            baseQuery.count().get(),
            baseQuery.where("status", "==", "approved").count().get(),
            baseQuery.where("status", "==", "rejected").count().get(),
            baseQuery.where("status", "==", "pending").count().get(),
        ]);

        const totalApplications = totalSnap.data().count ?? 0;
        const approved = approvedSnap.data().count ?? 0;
        const rejected = rejectedSnap.data().count ?? 0;
        const pending = pendingSnap.data().count ?? 0;

        // --- Disbursed amount: aggregate sum on approved docs ---
        let totalDisbursed = 0;
        try {
            const disbursedQuery = dateFilter
                ? db.collection(COLLECTIONS.WAVE_APPLICATIONS)
                    .where("createdAt", ">=", dateFilter)
                    .where("status", "==", "approved")
                    .where("amountDisbursed", ">", 0)
                : db.collection(COLLECTIONS.WAVE_APPLICATIONS)
                    .where("status", "==", "approved")
                    .where("amountDisbursed", ">", 0);

            const disbursedSnap = await disbursedQuery
                .aggregate({ total: AggregateField.sum("amountDisbursed") })
                .get();
            totalDisbursed = Number(disbursedSnap.data().total) || 0;
        } catch {
            // Firestore aggregate may fail if index is missing — fall back to 0
            totalDisbursed = 0;
        }

        const averageLoanSize = approved > 0 ? totalDisbursed / approved : 0;

        /**
         * --- Repayment rate: COUNT queries on LOANS collection ---
         *
         * NO DEFAULT. This was `let repaymentRate = 85; // reasonable default when
         * no data`, and 85 was returned whenever the LOANS collection was empty or
         * either count threw — reported to a COMPLIANCE screen as the programme's
         * repayment rate, in a field the page renders as `{stats.repaymentRate}%`.
         *
         * A made-up compliance figure is worse than a missing one. It is
         * indistinguishable from a measurement, and it is the number somebody would
         * quote.
         *
         * null means "not measured", which the response now states separately so a
         * reader cannot mistake it for zero either.
         */
        let repaymentRate: number | null = null;
        let repaymentBasis: { totalLoans: number; repaidLoans: number } | null = null;
        try {
            const [totalLoansSnap, repaidLoansSnap] = await Promise.all([
                db.collection(COLLECTIONS.LOANS).count().get(),
                db.collection(COLLECTIONS.LOANS)
                    .where("status", "in", ["repaid", "completed"])
                    .count()
                    .get(),
            ]);
            const totalLoans = totalLoansSnap.data().count ?? 0;
            const repaidLoans = repaidLoansSnap.data().count ?? 0;
            repaymentBasis = { totalLoans, repaidLoans };
            if (totalLoans > 0) {
                repaymentRate = Math.round((repaidLoans / totalLoans) * 100);
            }
        } catch (e) {
            logger.error("[WAVE Compliance] Repayment rate could not be computed", e);
        }

        // --- Demographics: still needs full doc fetch (no GROUP BY in Firestore) ---
        // Only fetch the fields we need via .select() to minimise payload size.
        /**
         * The fields selected here have to be fields the collection HAS.
         *
         * It selected `state` and `businessType`. A WAVE application carries
         * neither — the schema has `stateOfResidence`, `stateOfOrigin` and
         * `currentOccupation`; `businessType` is an EXPORT field the legacy import
         * writes. So every row fell to the `|| "Unknown"` and `|| "Other"`
         * fallbacks, and the compliance screen's state breakdown read
         * "Unknown: 480" while its business-type breakdown read "Other: 480".
         *
         * Two of the three demographic breakdowns on a compliance report were
         * measuring nothing, and the fallbacks made that look like data.
         */
        const DEMOGRAPHIC_FIELDS = [
            "age",
            "stateOfResidence",
            "stateOfOrigin",
            "currentOccupation",
        ] as const;

        const demographicsQuery = dateFilter
            ? db.collection(COLLECTIONS.WAVE_APPLICATIONS)
                .where("createdAt", ">=", dateFilter)
                .select(...DEMOGRAPHIC_FIELDS)
            : db.collection(COLLECTIONS.WAVE_APPLICATIONS)
                .select(...DEMOGRAPHIC_FIELDS);

        const demographicsSnap = await demographicsQuery.get();

        const ageGroups: Record<string, number> = {
            "18-25": 0,
            "26-35": 0,
            "36-45": 0,
            "46-55": 0,
            "56+": 0,
        };
        const states: Record<string, number> = {};
        const businessTypes: Record<string, number> = {};

        demographicsSnap.docs.forEach(doc => {
            const data = doc.data();
            const age = data.age || 0;
            if (age >= 18 && age <= 25) ageGroups["18-25"]++;
            else if (age >= 26 && age <= 35) ageGroups["26-35"]++;
            else if (age >= 36 && age <= 45) ageGroups["36-45"]++;
            else if (age >= 46 && age <= 55) ageGroups["46-55"]++;
            else if (age >= 56) ageGroups["56+"]++;

            // Residence first, origin as the fallback: the programme is delivered
            // where a participant lives.
            const state = data.stateOfResidence || data.stateOfOrigin || "Unknown";
            states[state] = (states[state] || 0) + 1;

            // `currentOccupation` is what the application actually asks for. The
            // page labels this panel "Business Types", which is close enough to the
            // question on the form to be honest, and infinitely closer than the
            // all-"Other" it displayed before.
            const businessType = data.currentOccupation || "Unspecified";
            businessTypes[businessType] = (businessTypes[businessType] || 0) + 1;
        });

        const stats = {
            totalApplications,
            approved,
            rejected,
            pending,
            totalDisbursed,
            averageLoanSize,
            repaymentRate,
            // The count of APPROVED APPLICATIONS, which is not the same as the
            // number of accounts holding the WAVE role — see
            // _wv_admin_applications.ts for the two populations and why they differ
            // by an order of magnitude. Named for what it counts.
            activeMembers: approved,
            approvedApplications: approved,
        };

        /**
         * What the numbers above are actually based on.
         *
         * Three of them cannot be measured from this collection and were being
         * returned as 0 or as a default, indistinguishable from a real reading:
         *
         *   totalDisbursed / averageLoanSize  `amountDisbursed` is not a field on a
         *                                     WAVE application, and no writer sets
         *                                     it, so the `> 0` filter matched
         *                                     nothing and both were always 0.
         *   repaymentRate                     defaulted to 85 with no loans at all.
         *
         * Reported rather than silently zeroed, so a reader can tell "nil" from
         * "not tracked".
         */
        const dataAvailability = {
            disbursementTracked: totalDisbursed > 0,
            disbursementNote: totalDisbursed > 0
                ? null
                : "WAVE applications do not record a disbursed amount; this figure is not tracked, not nil.",
            repaymentMeasured: repaymentRate !== null,
            repaymentBasis,
        };

        if (totalDisbursed === 0) {
            logger.info(
                "[WAVE Compliance] No disbursement data — `amountDisbursed` is not written on WAVE applications."
            );
        }

        const demographics = {
            ageGroups,
            states,
            businessTypes,
        };

        return NextResponse.json({
            success: true,
            stats,
            demographics,
            dataAvailability,
        });
    } catch (error) {
        logger.error("Failed to fetch compliance data:", error);
        return NextResponse.json(
            { success: false, message: "Internal server error" },
            { status: 500 }
        );
    }
}
