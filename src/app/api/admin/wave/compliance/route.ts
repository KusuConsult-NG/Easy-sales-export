export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { hasAdminPermission } from "@/lib/admin-permissions";
import { AggregateField } from "@/lib/firestore-compat";
import { countModuleApplicants, registerIsUsable } from "@/lib/module-applicant-count";

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

        // #438: this was isAdmin(...) — true for ANY of the ten admin roles.
        // Named permission because the WAVE compliance review queue.
        if (!hasAdminPermission(session.user.roles, "wave:approve_applications")) {
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

        /**
         * --- THE REAL APPLICANT POPULATION ---
         *
         *   #835 THE COMPLIANCE SCREEN UNDER-REPORTED WAVE BY 95%.
         *
         *   The owner, looking at this page: "the numbers are more than this and
         *   the application is far more than 15k" — beside a card reading 716.
         *
         *   And then, decisively, when a first pass at this described the gap as
         *   members lacking an application: "14k+ without application is a false
         *   statement … all the users had applications submitted."
         *
         *   THE OWNER IS RIGHT AND THE FIRST DIAGNOSIS WAS WRONG. It is recorded
         *   here because the mistake is the more instructive half.
         *
         * ── WHAT THE FIRST PASS DID ────────────────────────────────────────────
         *
         *   _wv_admin_applications.ts carries a note reading "the 14,654 without
         *   an application may well be real members". That sentence was taken as
         *   a measurement, hardened into `membersWithoutApprovedApplication`, and
         *   PRINTED ON THE SCREEN as a statement about fourteen thousand real
         *   women. Nothing had checked whether their applications existed; a
         *   comment's framing had simply been believed.
         *
         *   That is the same shape as the invented funding ledger #829 removed —
         *   a figure presented as measured that was inferred — committed while
         *   fixing an instance of it.
         *
         * ── WHERE THE APPLICATIONS ACTUALLY ARE ────────────────────────────────
         *
         *   WAVE_APPLICATIONS is not the register of who applied. It holds the
         *   detailed form payload, and only for the route that writes one.
         *
         *   `serviceRegistrations.wave.status` on the USER is the field BOTH
         *   enrolment paths maintain:
         *
         *     _wv_applications.ts  writes it "pending" on submit, and the admin
         *                          actions move it to "approved" / "rejected"
         *     _legacy.ts           writes it "approved" on import
         *
         *   So it is complete where the applications collection is partial, and
         *   it is the authoritative status for every applicant however she
         *   reached the programme. It is what this screen counts now.
         *
         *   WAVE_APPLICATIONS is still read, for the demographic breakdowns —
         *   that is where age, state and occupation live — and the basis is
         *   declared so nobody reads a 716-row breakdown as the whole programme.
         *
         *   NO CLAIM IS MADE ABOUT WHAT ANY MEMBER LACKS. The difference between
         *   the two collections is reported, where it is reported at all, as a
         *   fact about RECORDS — detailed form data on file — and never as a
         *   fact about people.
         */
        const applicants = await countModuleApplicants("wave", dateFilter);
        /*
         *   The register is used only when it is at least as complete as the
         *   applications table — see registerIsUsable. An unpopulated register
         *   otherwise turns a real total into a confident zero, which is the
         *   defect this whole finding is about, pointing the other way.
         */
        const useRegister = registerIsUsable(applicants, totalApplications);
        const applicantsTotal = useRegister ? applicants.total : totalApplications;
        const applicantsApproved = useRegister ? applicants.approved : approved;
        const applicantsPending = useRegister ? applicants.pending : pending;
        const applicantsRejected = useRegister ? applicants.rejected : rejected;
        const applicantCountFailed = !useRegister && !applicants.counted;

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

        /**
         * `.all()`, not `.get()`.
         *
         *   #835 `.get()` without a `.limit()` stops at DEFAULT_QUERY_LIMIT —
         *   5,000 rows. At today's 716 applications that changes nothing, which
         *   is exactly why it would not have been noticed: the breakdowns would
         *   simply start describing the first 5,000 applications as the whole
         *   programme on the day the 5,001st arrived, on the screen whose figures
         *   are reported outward.
         *
         *   The sibling export route already made this call correctly and says
         *   why — "this is an EXPORT, so a silent cap hands the admin a file that
         *   looks complete and is not". A compliance dashboard has the same
         *   property and had the other implementation.
         */
        const demographicsSnap = await demographicsQuery.all().get();
        if (demographicsSnap.truncated) {
            logger.error(
                "[WAVE Compliance] Demographics sweep hit the unbounded ceiling — the breakdowns below are incomplete."
            );
        }

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
            activeMembers: applicantsApproved ?? approved,
            approvedApplications: applicantsApproved ?? approved,
            /**
             *   #835 THE HEADLINE FIGURES, counted over every applicant.
             *
             *   `totalApplications` above counts rows in WAVE_APPLICATIONS, which
             *   is the detailed-form collection and not the applicant register.
             *   These are the programme's real numbers. null means the count
             *   failed — never 0.
             */
            applicantsTotal,
            applicantsApproved,
            applicantsPending,
            applicantsRejected,
            //   Kept, and named for exactly what it is: how many applicants have
            //   the long form on file. A RECORD-COMPLETENESS figure, never a
            //   claim that anybody did not apply.
            detailedApplicationRecords: totalApplications,
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
            /**
             * #835 WHAT THE DEMOGRAPHIC BREAKDOWNS ARE ACTUALLY COMPUTED OVER.
             *
             * The age, state and occupation panels are built from the
             * WAVE_APPLICATIONS rows and nothing else, because those are the only
             * records carrying the fields. With 716 applications against 15,130
             * enrolled members, "Top States" describes under 5% of the programme
             * while being read as the programme's geography — on a compliance
             * report.
             *
             * The breakdowns are NOT extended to cover role-only members: their
             * accounts do not hold an age or a state of residence, so including
             * them would add 14,414 rows of "Unknown" and make the panels worse,
             * not broader. What is fixed is that the basis is now stated, so a
             * reader knows the denominator they are looking at.
             */
            demographicsBasis: {
                rowsCounted: demographicsSnap.docs.length,
                truncated: Boolean(demographicsSnap.truncated),
                population: "detailed_application_records",
                ofApplicants: applicantsTotal,
                note: applicantsTotal !== null && applicantsTotal > demographicsSnap.docs.length
                    ? `Breakdowns are computed from the ${demographicsSnap.docs.length.toLocaleString()} applicants whose detailed form data is held in the applications table, out of ${applicantsTotal.toLocaleString()} applicants in total. Age, state and occupation are only recorded on that long form, so applicants enrolled through another route are not represented in the charts below.`
                    : null,
            },
            applicantsCounted: !applicantCountFailed,
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
