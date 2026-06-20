"use server";

import { requireSession } from "@/lib/session-guard";
import { db, getAdminDb } from "@/lib/firebase-admin";
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

            // 3. Stale JWT Session Risk (Proxy check)
            // If the user's document was updated recently, but no active login within the last 2 hours.
            const untypedData = data as any;
            if (untypedData.updatedAt && untypedData.lastLoginAt) { const lastLogin = (untypedData.lastLoginAt)?.toDate ? (untypedData.lastLoginAt).toDate().getTime() : new Date(untypedData.lastLoginAt).getTime();
                 const lastUpdated = (untypedData.updatedAt)?.toDate ? (untypedData.updatedAt).toDate().getTime() : new Date(untypedData.updatedAt).getTime();
                 // If document was mutated after their last login, their current JWT might be stale.
                 // This isn't inherently corruption, but raises a flag in health checks.
                 if (lastUpdated > (lastLogin + 86400000)) { // 24 hours drift
                      issues.push({
                          id: uid,
                          email: data.email,
                          issueType: "High Stale JWT Risk",
                          expectedState: "System state in sync with Client Auth",
                          actualState: "Firestore Profile > Last Auth Token issue time",
                          description: "User's data was modified significantly after their last known login, meaning active JWTs may lack new roles/permissions."
                      });
                 }
            }
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
        logger.error("Failed to fetch feature toggles:", e);
        // Fallback to defaults on error
        return { success: true as const, data: DEFAULT_TOGGLES, error: null };
    }
}
