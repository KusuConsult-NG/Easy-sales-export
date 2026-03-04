"use server";

import { requireSession } from "@/lib/session-guard";
import { db } from "@/lib/firebase-admin";
import { unstable_cache } from "next/cache";
import { COLLECTIONS } from "@/lib/types/firestore";

export interface AnalyticsData {
    platformOverview: {
        totalUsers: number;
        activeUsers: number;
        totalRevenue: number;
    };
    counts: {
        pendingEscrows: number;
        activeLandListings: number;
        pendingLoans: number;
    };
    recentTransactions: Array<{
        id: string;
        type: string;
        amount: number;
        date: string;
    }>;
}

export async function getDashboardStatsAction(): Promise<AnalyticsData | null> {
    const sessionResult = await requireSession();
    if (!sessionResult.session) return null;
    const { session } = sessionResult;
    if (!session?.user?.roles?.includes("admin") && !session?.user?.roles?.includes("super_admin")) {
        return null;
    }

    // Get total users
    const usersSnap = await db.collection("users").count().get();
    const totalUsers = usersSnap.data().count;

    // Get active users (users with lastLoginAt in last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    let activeUsers = 0;
    try {
        const activeSnap = await db.collection("users")
            .where("lastLoginAt", ">=", thirtyDaysAgo)
            .count().get();
        activeUsers = activeSnap.data().count;
    } catch {
        activeUsers = totalUsers; // Fallback
    }

    // Get pending escrows
    let pendingEscrows = 0;
    try {
        const escrowSnap = await db.collection("escrows")
            .where("status", "==", "pending")
            .count().get();
        pendingEscrows = escrowSnap.data().count;
    } catch {
        // Collection may not exist
    }

    // Get active land listings
    let activeLandListings = 0;
    try {
        const landSnap = await db.collection("land_listings")
            .where("status", "==", "active")
            .count().get();
        activeLandListings = landSnap.data().count;
    } catch {
        // Collection may not exist
    }

    // Get pending loans
    let pendingLoans = 0;
    try {
        const loanSnap = await db.collection("loan_applications")
            .where("status", "==", "pending")
            .count().get();
        pendingLoans = loanSnap.data().count;
    } catch {
        // Collection may not exist
    }

    // Get recent audit logs as "transactions"
    let recentTransactions: AnalyticsData["recentTransactions"] = [];
    try {
        const logsSnap = await db.collection("audit_logs")
            .orderBy("timestamp", "desc")
            .limit(10)
            .get();
        recentTransactions = logsSnap.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                type: data.action || "unknown",
                amount: data.amount || 0,
                date: data.timestamp?.toDate?.()?.toISOString() || new Date().toISOString(),
            };
        });
    } catch {
        // Collection may not exist
    }

    return {
        platformOverview: {
            totalUsers,
            activeUsers,
            totalRevenue: 0, // Will accumulate as transactions flow
        },
        counts: {
            pendingEscrows,
            activeLandListings,
            pendingLoans,
        },
        recentTransactions,
    };
}

export interface FinancialOverview {
    success: boolean;
    error?: string;
    totalRevenue: number;
    totalEscrowVolume: number;
    totalLoansDisbursed: number;
    /** Sum of all withdrawals with status='approved_pending_payout' — real money awaiting bank transfer */
    pendingPayoutAmount: number;
    recentTransactions: Array<{
        id: string;
        type: string;
        amount: number;
        status?: string;
        timestamp: string | null;
    }>;
}

export async function getFinancialOverviewAction(): Promise<FinancialOverview> {
    const sessionResult = await requireSession();
    if (!sessionResult.session) {
        return { success: false, error: "Session expired. Please log in again.", totalRevenue: 0, totalEscrowVolume: 0, totalLoansDisbursed: 0, pendingPayoutAmount: 0, recentTransactions: [] };
    }
    const { session } = sessionResult;
    if (!session?.user?.roles?.includes("admin") && !session?.user?.roles?.includes("super_admin")) {
        return { success: false, error: "You do not have admin access to view financial data.", totalRevenue: 0, totalEscrowVolume: 0, totalLoansDisbursed: 0, pendingPayoutAmount: 0, recentTransactions: [] };
    }

    let totalRevenue = 0;
    let totalEscrowVolume = 0;
    let totalLoansDisbursed = 0;
    const recentTransactions: FinancialOverview["recentTransactions"] = [];

    // Sum escrow volumes
    try {
        const escrowSnap = await db.collection("escrows").limit(5000).get();
        escrowSnap.docs.forEach(doc => {
            const data = doc.data();
            const amount = Number(data.amount) || 0;
            totalEscrowVolume += amount;
            if (data.status === "completed") {
                totalRevenue += amount * 0.025; // 2.5% commission
            }
        });
    } catch {
        // Collection may not exist
    }

    // Sum loans disbursed
    try {
        const loanSnap = await db.collection("loan_applications")
            .where("status", "==", "disbursed")
            .limit(5000)
            .get();
        loanSnap.docs.forEach(doc => {
            totalLoansDisbursed += Number(doc.data().amount) || 0;
        });
    } catch {
        // Collection may not exist
    }

    // Get recent financial transactions from audit logs
    try {
        const logsSnap = await db.collection("audit_logs")
            .orderBy("timestamp", "desc")
            .limit(20)
            .get();
        logsSnap.docs.forEach(doc => {
            const data = doc.data();
            recentTransactions.push({
                id: doc.id,
                type: data.action || "unknown",
                amount: Number(data.amount) || 0,
                // 🐛 FIX: Convert Firestore Timestamp to ISO string here on the server.
                // Firestore Timestamp objects can't be serialized across the Server Action
                // boundary — they arrive as plain {seconds, nanoseconds} with no .toDate() method.
                timestamp: data.timestamp?.toDate?.()?.toISOString() ?? null,
            });
        });
    } catch {
        // Collection may not exist
    }

    // Sum pending payouts (approved_pending_payout withdrawals across both cooperative and wave)
    let pendingPayoutAmount = 0;
    try {
        const pendingPayoutsSnap = await db.collection("withdrawalRequests")
            .where("status", "==", "approved_pending_payout")
            .limit(1000)
            .get();
        pendingPayoutsSnap.docs.forEach(doc => {
            pendingPayoutAmount += Number(doc.data().amount) || 0;
        });
        // Also check wave_withdrawals collection
        const wavePayoutsSnap = await db.collection("wave_withdrawals")
            .where("status", "==", "approved_pending_payout")
            .limit(1000)
            .get();
        wavePayoutsSnap.docs.forEach(doc => {
            pendingPayoutAmount += Number(doc.data().amount) || 0;
        });
    } catch {
        // Collections may not exist
    }

    return {
        success: true,
        totalRevenue,
        totalEscrowVolume,
        totalLoansDisbursed,
        pendingPayoutAmount,
        recentTransactions,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Module Registration Stats (for admin pie/bar chart)
// ─────────────────────────────────────────────────────────────────────────────

export interface ModuleRegistrationStats {
    /** Total registered accounts on the platform (users collection) */
    hub: number;
    /** Full WAVE programme applicants (wave_applications) */
    wave: number;
    /** Walk-in briefing registrations (wave_briefing_registrations) */
    waveBriefing: number;
    /** Academy applicants (ACADEMY_APPLICATIONS) */
    academy: number;
    /** Cooperative enrolled members (cooperative_members) */
    cooperatives: number;
    /** Cooperative onboarding applicants still in pipeline (cooperative_onboarding_applications) */
    cooperativeOnboarding: number;
    /** Farm Nation registered sellers (farm_nation_properties) */
    farmNation: number;
    /** Export Hub investors with a slot (export_slots) */
    exportHub: number;
    /** Export onboarding applicants still in pipeline (export_onboarding_applications) */
    exportOnboarding: number;
    /** Marketplace seller verification requests (seller_verifications) */
    marketplace: number;
}

async function safeCount(query: FirebaseFirestore.Query | FirebaseFirestore.CollectionReference): Promise<number> {
    try {
        const snap = await query.count().get();
        return snap.data().count;
    } catch {
        return 0;
    }
}

// ─── Cached inner fetcher (5-min TTL, admin-only route) ─────────────────────
const fetchModuleRegistrationStats = unstable_cache(
    async (): Promise<ModuleRegistrationStats> => {
        const [
            hub,
            wave,
            waveBriefing,
            academy,
            cooperatives,
            cooperativeOnboarding,
            farmNation,
            exportHub,
            exportOnboarding,
            marketplace,
        ] = await Promise.all([
            // Hub: all registered platform accounts
            safeCount(db.collection(COLLECTIONS.USERS)),

            // WAVE: submitted applications (exclude drafts by requiring a status field)
            safeCount(db.collection(COLLECTIONS.WAVE_APPLICATIONS).where("status", "in", ["pending", "submitted", "under_review", "approved", "rejected"])),

            // WAVE Briefings: all walk-in event registrations
            safeCount(db.collection(COLLECTIONS.WAVE_BRIEFING_REGISTRATIONS)),

            // Academy applicants — COLLECTIONS.ACADEMY_APPLICATIONS = "ACADEMY_APPLICATIONS" (verified)
            safeCount(db.collection(COLLECTIONS.ACADEMY_APPLICATIONS)),

            // Cooperatives: paid & enrolled members only (exclude pending payment and rejected)
            safeCount(db.collection(COLLECTIONS.COOPERATIVE_MEMBERS)
                .where("paymentStatus", "==", "completed")
                .where("membershipStatus", "!=", "rejected")),

            // Cooperative onboarding pipeline (pending only)
            safeCount(db.collection(COLLECTIONS.COOPERATIVE_ONBOARDING).where("status", "==", "pending")),

            // Farm Nation: unique registered sellers via user profile
            safeCount(db.collection(COLLECTIONS.USERS).where("serviceRegistrations.farmNation.status", "in", ["pending", "approved"])),

            // Export Hub: unique investors via user profile (not slots — 1:many)
            safeCount(db.collection(COLLECTIONS.USERS).where("serviceRegistrations.export.status", "in", ["pending", "approved"])),

            // Export onboarding pipeline (pending_review only)
            safeCount(db.collection(COLLECTIONS.EXPORT_APPLICATIONS).where("status", "==", "pending_review")),

            // Marketplace: seller verifications excluding rejected
            safeCount(db.collection(COLLECTIONS.SELLER_VERIFICATIONS).where("status", "!=", "rejected")),
        ]);
        return { hub, wave, waveBriefing, academy, cooperatives, cooperativeOnboarding, farmNation, exportHub, exportOnboarding, marketplace };
    },
    ["module-registration-stats"],
    { revalidate: 300, tags: ["module-registration-stats"] } // 5-minute cache
);

export async function getModuleRegistrationStatsAction(): Promise<ModuleRegistrationStats> {
    const sessionResult = await requireSession();
    if (!sessionResult.session) return null as any;
    const { session } = sessionResult;
    if (!session?.user?.roles?.includes("admin") && !session?.user?.roles?.includes("super_admin")) {
        throw new Error("Unauthorized");
    }
    // Auth passes — serve from cache (Firestore only hit every 5 minutes)
    return fetchModuleRegistrationStats();
}
