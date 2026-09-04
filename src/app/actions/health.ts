"use server";

import { requireSession } from "@/lib/session-guard";
import { supabaseDb as db, getAdminDb } from "@/lib/supabase-db";
import { COLLECTIONS, User } from "@/lib/types/firestore";
import { isAdmin } from "@/lib/admin-permissions";
import { getRedisClientStatus } from "@/lib/redis";
import { logger } from "@/lib/logger";
import { DEFAULT_TOGGLES } from "@/lib/feature-toggles";

export interface HealthIssue { id: string; // userId
    email: string;
    issueType: string;
    expectedState: string;
    actualState: string;
    description: string; }

export interface HealthReport {
    totalScanned: number;
    anomaliesFound: number;
    issues: HealthIssue[];
    services: {
        redis: boolean;
        firestore: boolean;
        paystack: boolean;
        resend: boolean;
    };
    featureToggles: Record<string, boolean>;
    stats: {
        corruptedUsers: number;
        orphanedApplications: number;
        desyncedRegistrations: number;
    };
    timestamp: string;
}

export async function runSystemHealthDiagnostic(limit: number = 2000): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> { try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;

        if (!session?.user || !isAdmin(session.user.roles)) { return { success: false as const, error: "Unauthorized access", data: null };
        }

        const db = getAdminDb();
        const usersSnap = await db.collection(COLLECTIONS.USERS)
            .orderBy('createdAt', 'desc')
            .limit(limit)
            .get();

        const issues: HealthIssue[] = [];

        usersSnap.forEach(doc => {
            const data = doc.data() as User;
            const uid = doc.id;
            // 1. Unverified Seller Role
            if (data.roles?.includes("seller") && (!data.isVerified || data.sellerVerificationStatus !== "approved")) {
                issues.push({
                    id: uid,
                    email: data.email,
                    issueType: "Data Corruption (Seller without Verification)",
                    expectedState: "sellerVerificationStatus = approved AND isVerified = true",
                    actualState: `isVerified: ${data.isVerified}, status: ${data.sellerVerificationStatus}`,
                    description: "User possesses 'seller' role but lacks mandatory seller or global verification markers."
                });
            }

            // 2. Export Participant without approved module status
            if (data.roles?.includes("export_participant")) {
                 const exportStatus = data.serviceRegistrations?.export?.status;
                 if (exportStatus !== "approved") {
                    issues.push({
                        id: uid,
                        email: data.email,
                        issueType: "Data Corruption (Export State Drift)",
                        expectedState: "serviceRegistrations.export.status = approved",
                        actualState: `export.status = ${exportStatus || 'undefined'}`,
                        description: "User is an 'export_participant' but is missing an active module registration."
                    });
                 }
            }

            /**
             * 3. STALE JWT SESSION RISK — REMOVED. #273 (from #335).
             *
             *    It read:
             *
             *      if (untypedData.updatedAt && untypedData.lastLoginAt) {
             *          ... if (lastUpdated > lastLogin + 86400000) {
             *              issues.push({ issueType: "High Stale JWT Risk", ...
             *                  "active JWTs may lack new roles/permissions" })
             *
             *    #335 established that it had NEVER RUN — nothing in src/ writes
             *    `lastLoginAt`, not the login path, not the JIT migration, not
             *    any profile write — and left "stamp it at sign-in, or drop the
             *    consumers" as an owner decision.
             *
             *    DROPPED, on three measurements rather than on taste:
             *
             *    1. STAMPING IT WOULD NOT MAKE THE CHECK CORRECT, ONLY LOUD.
             *       The session is `maxAge: 8 * 60 * 60` (lib/auth.ts). The
             *       condition is "the profile changed more than 24 HOURS after
             *       the last login", which selects accounts whose session
             *       expired at least sixteen hours before the change. It cannot
             *       describe a live JWT; it can only describe an absent one.
             *
             *    2. ITS PREMISE IS FALSE ANYWAY. A JWT does not carry stale
             *       roles: the jwt callback re-reads the profile every
             *       SYNC_INTERVAL — two minutes — and rewrites roles, ban state
             *       and the revocation flag from it. The window this check
             *       imagines is 24 hours; the real one is two minutes.
             *
             *    3. THE RISK IT NAMES IS ALREADY CONTROLLED, PROPERLY. Sessions
             *       minted before `sessionsValidFrom` are revoked server-side
             *       (#306/#343). That is an enforcement, not a report, and it is
             *       the thing this check was gesturing at.
             *
             *    So the field is NOT stamped. Adding a write to every login for
             *    a consumer that would emit false alarms is a cost with a
             *    negative return, and a report full of false alarms is one
             *    nobody reads — the inverse of #331 and just as useless.
             *
             *    The other two readers of `lastLoginAt` were `||` fallbacks in
             *    broadcast-logic.ts and sms-broadcast.ts; the dead middle term
             *    is gone from both, so no code in this repository now reads a
             *    field nothing writes.
             */
        });

        // 4. Service Health
        const redisStatus = await getRedisClientStatus();
        const firestoreStatus = !!db;

        // 5. Orphaned Apps Check (Sample)
        let orphanedApps = 0;
        const desyncedRegs = 0;
        const waveSnap = await db.collection(COLLECTIONS.WAVE_APPLICATIONS).limit(50).get();
        const userChecks = await Promise.all(waveSnap.docs.map(async (doc) => {
            const userId = doc.data().userId;
            if (!userId) {
                return true;
            }
            const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
            return !userDoc.exists;
        }));
        orphanedApps = userChecks.filter(Boolean).length;

        // 6. Feature Toggles
        const featureToggles: Record<string, boolean> = { ...DEFAULT_TOGGLES };
        try {
            const togglesSnapshot = await db.collection(COLLECTIONS.FEATURE_TOGGLES).get();
            togglesSnapshot.docs.forEach(doc => {
                const data = doc.data();
                if (data && typeof data.enabled === 'boolean') {
                    featureToggles[doc.id] = data.enabled;
                }
            });
        } catch (err) {
            logger.error("Failed to fetch toggles in health diagnostic:", err);
        }

        const report: HealthReport = {
            totalScanned: usersSnap.size,
            anomaliesFound: issues.length,
            issues: issues,
            services: {
                redis: redisStatus,
                firestore: firestoreStatus,
                paystack: !!process.env.PAYSTACK_SECRET_KEY,
                resend: !!process.env.RESEND_API_KEY,
            },
            featureToggles,
            stats: {
                corruptedUsers: issues.filter(i => i.issueType.includes("Corruption")).length,
                orphanedApplications: orphanedApps,
                desyncedRegistrations: desyncedRegs
            },
            timestamp: new Date().toISOString()
        };

        return { error: null, success: true as const, data: report };

    } catch (e: any) {
        logger.error("System health diagnostic failed:", e);
        return { success: false as const, error: e.message, data: null };
    }
}

import { ActionResponse } from "@/lib/safe-action";

/**
 * Fetches the current state of feature toggles, merging defaults with database overrides.
 */
export async function getFeatureTogglesAction(): Promise<ActionResponse<Record<string, boolean>>> {
    try {
        const db = getAdminDb();
        const featureToggles: Record<string, boolean> = { ...DEFAULT_TOGGLES };

        const togglesSnapshot = await db.collection(COLLECTIONS.FEATURE_TOGGLES).get();
        togglesSnapshot.docs.forEach(doc => {
            const data = doc.data();
            if (data && typeof data.enabled === 'boolean') {
                featureToggles[doc.id] = data.enabled;
            }
        });

        return { success: true as const, data: featureToggles, error: null };
    } catch (e: any) {
        // A READ FAILURE IS NOT A SET OF TOGGLES (#245).
        //
        // This returned `success: true` with DEFAULT_TOGGLES, so the caller
        // could not tell "these are the real toggles" from "the database is
        // down". Seven of those defaults are true, so a transient error
        // presented features an admin had DISABLED as enabled — and said it
        // had succeeded.
        //
        // Both consumers (the wallet page and the seller dashboard) already
        // guard with `if (res.success && res.data)` and start from `{}`, so an
        // honest failure leaves every toggle falsy — closed, which is the safe
        // direction for a kill switch. See resolveToggle in
        // lib/feature-toggles.ts for the rule the single-toggle readers share.
        logger.error("Failed to fetch feature toggles — reporting failure rather than defaults:", e);
        return { success: false as const, error: e?.message || "Failed to fetch feature toggles", data: null };
    }
}
