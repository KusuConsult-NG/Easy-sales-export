"use server";

import { supabaseDb as db } from "@/lib/supabase-db";
import { logger } from '@/lib/logger';
import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session-guard";
import { COLLECTIONS } from "@/lib/types/firestore";
import { readCooperativeBalance } from "@/lib/cooperative-member-balance";
import { serializeValue } from "@/lib/firestore-serialize";

/**
 * Server Actions for Dashboard Data — RETIRED, KEPT, AND REFUSED AT THE DOOR.
 *
 *   #426 A SUPERSEDED DASHBOARD, STILL REACHABLE, STILL CARRYING A WRONG COUNT.
 *
 *   NOTHING IMPORTS THIS MODULE. Checked across all of src, for the module path
 *   and for each of the three action names. The apparent callers of
 *   `getDashboardStatsAction` are a NAME COLLISION: actions/admin-analytics.ts
 *   exports a function with the same name, and that is the one every admin
 *   screen imports.
 *
 *   The member dashboard used to be six direct Supabase queries from the
 *   browser under the public anon key. When that was closed it was rebuilt on
 *   session-scoped actions — see src/app/dashboard/page.tsx, which builds its
 *   own stats from my-data.ts. This module is what it was rebuilt AWAY FROM,
 *   and it was left behind rather than retired.
 *
 *   WHY THAT IS NOT HARMLESS. These are "use server" exports, so all three are
 *   independently addressable endpoints whether or not a screen calls them —
 *   the property that made autoEnrollPaidUser a paid-content bypass. They are
 *   session-guarded and read only the caller's own rows, so this is not a
 *   security hole. The hazard is the other one, #421's shape: 360 lines that
 *   LOOK like the dashboard's data layer, waiting for somebody to wire them up.
 *
 *   AND ONE OF THE NUMBERS IS WRONG. `academyEnrollments` counts
 *   COLLECTIONS.ENROLLMENTS, which only the PAID enrolment flow writes. Free and
 *   auto enrolments go to COURSE_ENROLLMENTS (#424 has the full map: three
 *   enrolment collections, readers split across them). A learner whose courses
 *   are all free would have been shown 0. That defect is recorded here rather
 *   than repaired, because repairing a number nothing displays would leave the
 *   real problem — the module being revivable — exactly where it was.
 *
 *   AN EARLIER FIX IN THIS FILE DELIVERED NOTHING, for the same reason: the
 *   comment below records that three queries filtered EXPORT_WINDOWS by a
 *   `userId` the collection does not have, so the export stats read empty for
 *   every user. That was found and corrected. No user ever saw the difference,
 *   because no screen reads this.
 *
 *   RETIRED, NOT DELETED. The code stays, the git history stays, and the flag
 *   below revives it. Whoever sets it owns fixing the enrolment count first.
 *   This is the treatment #379 and #386 established for a subsystem that is
 *   kept but must not run.
 */

/**
 * Set LEGACY_DASHBOARD_ACTIONS=enabled to revive these three actions.
 *
 * Read at call time, not at module load, so a test can set it per case.
 */
function legacyDashboardActionsEnabled(): boolean {
    return process.env.LEGACY_DASHBOARD_ACTIONS === "enabled";
}

/** The one refusal, so all three doors answer identically. */
const RETIRED_MESSAGE =
    "This dashboard data source is retired (#426). The member dashboard reads " +
    "session-scoped actions instead. See src/app/actions/dashboard.ts.";

// Type definitions
export type DashboardStats = { totalExports: number;
    activeOrders: number;
    totalEscrow: number;
    cooperativeSavings: number;
    academyEnrollments: number;
    onboardingCompleted: boolean; };

export type RecentActivity = { id: string;
    type: "export" | "cooperative" | "academy" | "wave";
    title: string;
    description: string;
    timestamp: string; // ISO 8601 string — Date cannot cross Server→Client boundary
    status?: string; }[];

export type EscrowStatus = { totalLocked: number;
    pendingRelease: number;
    nextReleaseDate: string | null; // ISO 8601 string — Date cannot cross Server→Client boundary
    upcomingReleases: {
        amount: number;
        releaseDate: string; // ISO 8601 string
        orderId: string;
    }[];
};

type DashboardActionState = { error: string | null;
    success: boolean;
    data?: DashboardStats | null; };

type ActivityActionState = { error: string | null;
    success: boolean;
    data?: RecentActivity | null; };

type EscrowActionState = { error: string | null;
    success: boolean;
    data?: EscrowStatus | null; };

// ============================================
// Dashboard Stats Action
// ============================================

import { withFlexibleSafeAction } from "@/lib/safe-action";

async function _getDashboardStatsAction(): Promise<DashboardActionState> {
    if (!legacyDashboardActionsEnabled()) {
        return { success: false as const, error: RETIRED_MESSAGE, data: null };
    }
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;

        const userId = session.user.id;

        // A user has no relationship to an EXPORT WINDOW.
        //
        // These three queries filtered EXPORT_WINDOWS by `userId`, and a window
        // has no such field. export-aggregation.ts is the only thing that
        // creates one, and its document is
        // { title, commodity, targetVolume, currentVolume, slotPrice, startDate,
        //   endDate, destination, status, createdAt, createdBy } —
        // createdBy being the ADMIN who opened it.
        //
        // So totalExports, activeOrders and the export half of totalEscrow read
        // empty for every user, always. Nobody reports it, because a dashboard
        // of zeros looks exactly like a user who has not started yet. The same
        // shape as the vendor dashboard in #132, in the screen every user sees
        // first.
        //
        // A user's participation is their SLOTS and BOOKINGS — the two doors
        // onto a window that export-booking.ts's own comment describes:
        //   EXPORT_SLOTS     { windowId, userId, volume, totalCost, status }
        //   EXPORT_BOOKINGS  { userId, exportWindowId, quantity, totalPrice, status }
        // Both are queried, because both are written and neither is a superset.
        const exportSlotsPromise = db.collection(COLLECTIONS.EXPORT_SLOTS)
            .where("userId", "==", userId)
            .get();

        const exportBookingsPromise = db.collection(COLLECTIONS.EXPORT_BOOKINGS)
            .where("userId", "==", userId)
            .get();

        // 3. Academy Enrollments (Use Count)
        const enrollmentsPromise = db.collection(COLLECTIONS.ENROLLMENTS)
            .where("userId", "==", userId)
            .count()
            .get();

        // 4. Cooperative Savings (Direct Doc Fetch)
        const userDocPromise = db.collection(COLLECTIONS.USERS).doc(userId).get();

        // 5b. Marketplace Escrow (Queried by participants only to avoid composite index requirement)
        const marketplaceEscrowPromise = db.collection(COLLECTIONS.ESCROW_TRANSACTIONS)
            .where("participants", "array-contains", userId)
            .get();

        // EXECUTE PARALLEL
        const [
            totalExportsSnap,
            activeOrdersSnap,
            enrollmentsSnap,
            userDoc,
            marketplaceEscrowSnap
        ] = await Promise.all([
            exportSlotsPromise,
            exportBookingsPromise,
            enrollmentsPromise,
            userDocPromise,
            marketplaceEscrowPromise
        ]);

        // Process Results
        const exportRecords = [
            ...totalExportsSnap.docs.map((d) => ({ ...d.data(), value: Number(d.data().totalCost ?? 0) })),
            ...activeOrdersSnap.docs.map((d) => ({ ...d.data(), value: Number(d.data().totalPrice ?? 0) })),
        ];

        const totalExports = exportRecords.length;
        const activeOrders = exportRecords.filter(
            (r: any) => r.status === "pending" || r.status === "in_transit"
        ).length;
        const academyEnrollments = enrollmentsSnap.data().count;

        // Money still held against a slot or booking that has not settled.
        const exportEscrow = exportRecords
            .filter((r: any) => r.status === "in_transit" || r.status === "delivered" || r.status === "pending")
            .reduce((sum: number, r: any) => sum + (Number.isFinite(r.value) ? r.value : 0), 0);

        const marketplaceEscrow = marketplaceEscrowSnap.docs
            .reduce((sum, doc) => {
                const data = doc.data();
                const activeStatuses = ["funded", "in_transit", "delivered", "disputed"];
                if (activeStatuses.includes(data.status)) {
                    return sum + (data.amount || data.grossAmount || 0);
                }
                return sum;
            }, 0);

        const totalEscrow = exportEscrow + marketplaceEscrow;

        let cooperativeSavings = 0;
        const userData = userDoc.data();

        // The gate on `userData.cooperativeId` never opened.
        //
        // Nothing in the codebase writes cooperativeId onto a USER document —
        // it lives on the membership record and on withdrawal rows. So this
        // whole block was skipped and cooperativeSavings was reported as 0 to
        // every member, including one with savings.
        //
        // The membership record is keyed BY the user id — platform.ts and
        // admin.ts both write COOPERATIVE_MEMBERS.doc(userId) — so it can be
        // read directly, and the gate was never needed to find it.
        const rootMemberDoc = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(userId).get();

        if (rootMemberDoc.exists) {
            cooperativeSavings = readCooperativeBalance(rootMemberDoc.data());
        } else if (userData?.cooperativeId) {
            // Legacy nested collection, kept for members whose record predates
            // the root collection. Reachable only when the user document does
            // carry a cooperativeId, which is why it stays behind that check.
            const nestedMemberDoc = await db
                .collection(COLLECTIONS.COOPERATIVES)
                .doc(userData.cooperativeId)
                .collection("members")
                .doc(userId)
                .get();

            if (nestedMemberDoc.exists) {
                // Read `balance` ONLY, while the root branch four lines above
                // read `savingsBalance ?? balance` — and cron/release-escrow
                // credits a legacy member's export ROI to `savingsBalance`. So
                // a legacy member's export returns were paid in and then never
                // appeared on their dashboard. Same helper both branches now:
                // see lib/cooperative-member-balance.ts.
                cooperativeSavings = readCooperativeBalance(nestedMemberDoc.data());
            }
        }

                const stats: DashboardStats = {
            totalExports,
            activeOrders,
            totalEscrow,
            cooperativeSavings,
            academyEnrollments,
            onboardingCompleted: userData?.onboardingCompleted || false
        };

        return { error: null, success: true as const, data: stats };

    } catch (error: any) { logger.error("Dashboard stats error:", error);
        return { error: "Failed to fetch dashboard stats", success: false as const, data: null };
    }
}

export const getDashboardStatsAction = withFlexibleSafeAction("getDashboardStatsAction", _getDashboardStatsAction);

// ============================================
// Recent Activity Action
// ============================================

async function _getRecentActivityAction(): Promise<ActivityActionState> {
    if (!legacyDashboardActionsEnabled()) {
        return { success: false as const, error: RETIRED_MESSAGE, data: null };
    }
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;

        const userId = session.user.id;
        const activities: RecentActivity = [];

        // Fetch recent export windows
        const exportsSnapshot = await db
            .collection(COLLECTIONS.EXPORT_WINDOWS)
            .where("userId", "==", userId)
            .orderBy("createdAt", "desc")
            .limit(3)
            .get();

        exportsSnapshot.forEach(doc => {
            const data = doc.data();
            const ts = data.createdAt?.toDate?.() || new Date();
            activities.push({
                id: doc.id,
                type: "export",
                title: `Export Order ${data.orderId}`,
                description: `${data.commodity} - ${data.quantity}`,
                timestamp: ts.toISOString(),
                status: data.status });
        });

        // Fetch recent notifications
        const notificationsSnapshot = await db
            .collection(COLLECTIONS.NOTIFICATIONS)
            .where("userId", "==", userId)
            .orderBy("createdAt", "desc")
            .limit(2)
            .get();

        notificationsSnapshot.forEach(doc => { const data = doc.data();
            const ts = data.createdAt?.toDate?.() || new Date();
            activities.push({
                id: doc.id,
                type: data.type || "export",
                title: data.title,
                description: data.message,
                timestamp: ts.toISOString() });
        });

        // Sort all activities by timestamp (ISO strings sort correctly lexicographically)
        activities.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

        return { error: null, success: true as const, data: serializeValue(activities.slice(0, 5)) };
    } catch (error: any) { logger.error("Recent activity error:", error);
        return { error: "Failed to fetch recent activity", success: false as const, data: null };
    }
}

export const getRecentActivityAction = withFlexibleSafeAction("getRecentActivityAction", _getRecentActivityAction);

// ============================================
// Escrow Status Action
// ============================================

async function _getEscrowStatusAction(): Promise<EscrowActionState> {
    if (!legacyDashboardActionsEnabled()) {
        return { success: false as const, error: RETIRED_MESSAGE, data: null };
    }
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;

        const userId = session.user.id;

        // Fetch both export windows and marketplace escrows in parallel
        const [exportsSnapshot, marketplaceSnapshot] = await Promise.all([
            db.collection(COLLECTIONS.EXPORT_WINDOWS)
                .where("userId", "==", userId)
                .where("status", "in", ["in_transit", "delivered"])
                .get(),
            db.collection(COLLECTIONS.ESCROW_TRANSACTIONS)
                .where("participants", "array-contains", userId)
                .get()
        ]);

        let totalLocked = 0;
        let pendingRelease = 0;
        const upcomingReleases: EscrowStatus["upcomingReleases"] = [];
        let nextReleaseDateMs: number | null = null;

        const now = new Date();

        // 1. Process Export Escrows
        exportsSnapshot.forEach(docSnapshot => { const data = docSnapshot.data();
            const amount = data.amount || 0;
            const escrowReleaseDate: Date | undefined = data.escrowReleaseDate?.toDate?.();

            totalLocked += amount;

            if (escrowReleaseDate) {
                if (escrowReleaseDate <= now) {
                    // Ready for release
                    pendingRelease += amount;
                } else { // Future release
                    upcomingReleases.push({
                        amount,
                        releaseDate: escrowReleaseDate.toISOString(),
                        orderId: data.orderId });

                    // Track next release date
                    if (!nextReleaseDateMs || escrowReleaseDate.getTime() < nextReleaseDateMs) {
                        nextReleaseDateMs = escrowReleaseDate.getTime();
                    }
                }
            }
        });

        // 2. Process Marketplace Escrows
        marketplaceSnapshot.forEach(docSnapshot => {
            const data = docSnapshot.data();
            const activeStatuses = ["funded", "in_transit", "delivered", "disputed"];
            if (!activeStatuses.includes(data.status)) return;

            const amount = data.amount || data.grossAmount || 0;
            totalLocked += amount;

            // If buyer has confirmed receipt (escrow status "delivered"),
            // the funds are pending release by admin payout.
            if (data.status === "delivered") {
                pendingRelease += amount;
            }
        });

        // Sort upcoming releases by date (ISO strings sort correctly lexicographically)
        upcomingReleases.sort((a, b) => a.releaseDate.localeCompare(b.releaseDate));

        const escrow: EscrowStatus = {
            totalLocked,
            pendingRelease,
            nextReleaseDate: nextReleaseDateMs ? new Date(nextReleaseDateMs).toISOString() : null,
            upcomingReleases
        };

        return { error: null, success: true as const, data: serializeValue(escrow) };

    } catch (error: any) { logger.error("Escrow status error:", error);
        return { error: "Failed to fetch escrow status", success: false as const, data: null };
    }
}

export const getEscrowStatusAction = withFlexibleSafeAction("getEscrowStatusAction", _getEscrowStatusAction);
