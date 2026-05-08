"use server";

import { requireSession } from "@/lib/session-guard";
import { getAdminDb } from "@/lib/firebase-admin";
import { COLLECTIONS, User } from "@/lib/types/firestore";
import { hasAdminPermission, isAdmin } from "@/lib/admin-permissions";

export interface HealthIssue {
    id: string; // userId
    email: string;
    issueType: string;
    expectedState: string;
    actualState: string;
    description: string;
}

export interface HealthReport {
    totalScanned: number;
    anomaliesFound: number;
    issues: HealthIssue[];
}

export async function runSystemHealthDiagnostic(limit: number = 2000): Promise<{ error: null, success: true | false, data?: HealthReport, error?: string }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;

        if (!session?.user || !isAdmin(session.user.roles)) {
            return { success: false as const, error: "Unauthorized access" };
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
            if (untypedData.updatedAt && untypedData.lastLoginAt) {
                 const lastLogin = (untypedData.lastLoginAt)?.toDate ? (untypedData.lastLoginAt).toDate().getTime() : new Date(untypedData.lastLoginAt).getTime();
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

        return {
             error: null, success: true as const,
             data: {
                 totalScanned: usersSnap.size,
                 anomaliesFound: issues.length,
                 issues
             }
        };

    } catch (e: any) {
        return { success: false as const, error: e.message };
    }
}
