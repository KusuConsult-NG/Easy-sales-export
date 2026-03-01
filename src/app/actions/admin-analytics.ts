"use server";

import { auth } from "@/lib/auth";
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

export async function getDashboardStatsAction(): Promise<AnalyticsData> {
    const session = await auth();
    if (!session?.user?.roles?.includes("admin") && !session?.user?.roles?.includes("super_admin")) {
        throw new Error("Unauthorized");
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
    totalRevenue: number;
    totalEscrowVolume: number;
    totalLoansDisbursed: number;
    recentTransactions: Array<{
        id: string;
        type: string;
        amount: number;
        timestamp: any;
    }>;
}

export async function getFinancialOverviewAction(): Promise<FinancialOverview> {
    const session = await auth();
    if (!session?.user?.roles?.includes("admin") && !session?.user?.roles?.includes("super_admin")) {
        throw new Error("Unauthorized");
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
                timestamp: data.timestamp || null,
            });
        });
    } catch {
        // Collection may not exist
    }

    return {
        totalRevenue,
        totalEscrowVolume,
        totalLoansDisbursed,
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
            safeCount(db.collection("wave_briefing_registrations")), // no COLLECTIONS key — raw string matches action files

            // Academy applicants — COLLECTIONS.ACADEMY_APPLICATIONS = "ACADEMY_APPLICATIONS" (verified)
            safeCount(db.collection(COLLECTIONS.ACADEMY_APPLICATIONS)),

            // Cooperatives: enrolled members excluding rejected
            safeCount(db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).where("status", "!=", "rejected")),

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
    const session = await auth();
    if (!session?.user?.roles?.includes("admin") && !session?.user?.roles?.includes("super_admin")) {
        throw new Error("Unauthorized");
    }
    // Auth passes — serve from cache (Firestore only hit every 5 minutes)
    return fetchModuleRegistrationStats();
}
