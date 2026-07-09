"use server";

import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from "@/lib/logger";
import { requireSession } from "@/lib/session-guard";
import { isAdmin } from "@/lib/admin-permissions";
import { FieldValue } from "@/lib/firestore-compat";

interface RecoveryStats {
    totalUsersProcessed: number;
    corruptedFound: number;
    fixedCount: number;
    errors: string[];
}

/**
 * High-Assurance Data Recovery & Integrity Utility
 * 
 * This action performs a platform-wide audit of the 'serviceRegistrations' object
 * in the users collection. It cross-references the authoritative application 
 * collections to reconstruct any registration data lost due to destructive 
 * object-literal writes.
 */
export async function runServiceRegistrationRecoveryAction(): Promise<{ success: boolean; stats: RecoveryStats }> {
    const stats: RecoveryStats = {
        totalUsersProcessed: 0,
        corruptedFound: 0,
        fixedCount: 0,
        errors: []
    };

    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session || !isAdmin(sessionResult.session.user.roles)) {
            throw new Error("Unauthorized: Admin access required.");
        }

        logger.info("[DataRecovery] Starting serviceRegistrations recovery audit...");

        // 1. Get all users
        // Note: For very large databases, this should be paginated. 
        // For current scale, we'll process in chunks if possible, but start with a full sweep.
        const usersSnap = await db.collection(COLLECTIONS.USERS).get();
        stats.totalUsersProcessed = usersSnap.size;

        for (const userDoc of usersSnap.docs) {
            const userData = userDoc.data();
            const userId = userDoc.id;
            const registrations = userData.serviceRegistrations || {};
            
            const updates: Record<string, any> = {};
            let needsFix = false;

            // --- Cross-Reference Modules ---

            // 1. WAVE Recovery
            const waveApps = await db.collection(COLLECTIONS.WAVE_APPLICATIONS)
                .where("userId", "==", userId)
                .orderBy("submittedAt", "desc")
                .limit(1)
                .get();
            
            if (!waveApps.empty) {
                const waveData = waveApps.docs[0].data();
                if (!registrations.wave || registrations.wave.status !== waveData.status) {
                    updates["serviceRegistrations.wave.status"] = waveData.status;
                    updates["serviceRegistrations.wave.submittedAt"] = waveData.submittedAt;
                    updates["serviceRegistrations.wave.recoveredAt"] = FieldValue.serverTimestamp();
                    needsFix = true;
                }
            }

            // 2. Academy Recovery
            const academyApps = await db.collection(COLLECTIONS.ACADEMY_APPLICATIONS)
                .where("userId", "==", userId)
                .orderBy("submittedAt", "desc")
                .limit(1)
                .get();

            if (!academyApps.empty) {
                const academyData = academyApps.docs[0].data();
                if (!registrations.academy || registrations.academy.status !== academyData.status) {
                    updates["serviceRegistrations.academy.status"] = academyData.status;
                    updates["serviceRegistrations.academy.plan"] = academyData.plan;
                    updates["serviceRegistrations.academy.submittedAt"] = academyData.submittedAt;
                    updates["serviceRegistrations.academy.recoveredAt"] = FieldValue.serverTimestamp();
                    needsFix = true;
                }
            }

            // 3. Export Recovery
            const exportApps = await db.collection(COLLECTIONS.EXPORT_APPLICATIONS)
                .where("userId", "==", userId)
                .orderBy("submittedAt", "desc")
                .limit(1)
                .get();

            if (!exportApps.empty) {
                const exportData = exportApps.docs[0].data();
                const status = exportData.status === "pending_review" ? "pending" : exportData.status;
                if (!registrations.export || registrations.export.status !== status) {
                    updates["serviceRegistrations.export.status"] = status;
                    updates["serviceRegistrations.export.submittedAt"] = exportData.submittedAt;
                    updates["serviceRegistrations.export.recoveredAt"] = FieldValue.serverTimestamp();
                    needsFix = true;
                }
            }

            // 4. Marketplace Recovery
            const marketplaceApps = await db.collection(COLLECTIONS.SELLER_VERIFICATIONS)
                .where("userId", "==", userId)
                .orderBy("submittedAt", "desc")
                .limit(1)
                .get();

            if (!marketplaceApps.empty) {
                const mData = marketplaceApps.docs[0].data();
                if (!registrations.marketplace || registrations.marketplace.status !== mData.status) {
                    updates["serviceRegistrations.marketplace.status"] = mData.status;
                    updates["serviceRegistrations.marketplace.accountType"] = mData.accountType || "seller";
                    updates["serviceRegistrations.marketplace.submittedAt"] = mData.submittedAt;
                    updates["serviceRegistrations.marketplace.recoveredAt"] = FieldValue.serverTimestamp();
                    needsFix = true;
                }
            }

            // 5. Cooperative Recovery
            const coopApps = await db.collection(COLLECTIONS.COOPERATIVE_ONBOARDING)
                .where("userId", "==", userId)
                .orderBy("submittedAt", "desc")
                .limit(1)
                .get();

            if (!coopApps.empty) {
                const cData = coopApps.docs[0].data();
                if (!registrations.cooperatives || registrations.cooperatives.status !== cData.status) {
                    updates["serviceRegistrations.cooperatives.status"] = cData.status;
                    updates["serviceRegistrations.cooperatives.tier"] = cData.tier;
                    updates["serviceRegistrations.cooperatives.submittedAt"] = cData.submittedAt;
                    updates["serviceRegistrations.cooperatives.recoveredAt"] = FieldValue.serverTimestamp();
                    needsFix = true;
                }
            }

            // 6. Farm Nation Recovery
            const farmApps = await db.collection(COLLECTIONS.FARM_NATION_APPLICATIONS)
                .where("userId", "==", userId)
                .orderBy("submittedAt", "desc")
                .limit(1)
                .get();

            if (!farmApps.empty) {
                const fData = farmApps.docs[0].data();
                if (!registrations.farmNation || registrations.farmNation.status !== fData.status) {
                    updates["serviceRegistrations.farmNation.status"] = fData.status;
                    updates["serviceRegistrations.farmNation.role"] = fData.role;
                    updates["serviceRegistrations.farmNation.submittedAt"] = fData.submittedAt;
                    updates["serviceRegistrations.farmNation.recoveredAt"] = FieldValue.serverTimestamp();
                    needsFix = true;
                }
            }

            // --- Schema Standardization ---

            // 7. Unify Verification Fields
            // If verified is true but isVerified is missing or false, sync them.
            if (userData.verified === true && userData.isVerified !== true) {
                updates.isVerified = true;
                needsFix = true;
            } else if (userData.isVerified === true && userData.verified !== true) {
                updates.verified = true;
                needsFix = true;
            }

            // 8. Structured Name Backfilling
            // If firstName/lastName are missing, attempt to extract from applications
            if (!userData.firstName || !userData.lastName) {
                // Try to find any app with names
                const nameSource = waveApps.docs[0]?.data() || 
                                   academyApps.docs[0]?.data() || 
                                   coopApps.docs[0]?.data()?.personalInfo ||
                                   farmApps.docs[0]?.data()?.profile;
                
                if (nameSource) {
                    const fName = nameSource.firstName || nameSource.first_name;
                    const lName = nameSource.lastName || nameSource.last_name || nameSource.surname;
                    
                    if (fName && !userData.firstName) {
                        updates.firstName = fName;
                        needsFix = true;
                    }
                    if (lName && !userData.lastName) {
                        updates.lastName = lName;
                        needsFix = true;
                    }
                }
            }

            // --- Apply Fixes ---
            if (needsFix) {
                stats.corruptedFound++;
                try {
                    await db.collection(COLLECTIONS.USERS).doc(userId).update({
                        ...updates,
                        _dataIntegrityRemediated: true,
                        _lastIntegrityAuditAt: FieldValue.serverTimestamp()
                    });
                    stats.fixedCount++;
                } catch (e: any) {
                    logger.error(`[DataRecovery] Failed to fix user ${userId}:`, e);
                    stats.errors.push(`User ${userId}: ${e.message}`);
                }
            }
        }

        logger.info(`[DataRecovery] Audit complete. Processed: ${stats.totalUsersProcessed}, Fixed: ${stats.fixedCount}`);
        return { success: true, stats };

    } catch (error: any) {
        logger.error("[DataRecovery] Systemic failure in recovery action:", error);
        return { success: false, stats: { ...stats, errors: [error.message] } };
    }
}
