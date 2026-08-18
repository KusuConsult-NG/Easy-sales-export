"use server";

import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from "@/lib/logger";
import { requireSession } from "@/lib/session-guard";
import { hasAdminPermission } from "@/lib/admin-permissions";
import { FieldValue } from "@/lib/firestore-compat";

/**
 * The most recent application in a collection, and the date it was submitted.
 *
 * SIX COPIES OF ONE SORT, ON A FIELD FIVE OF THEM NEVER WROTE
 * -----------------------------------------------------------
 * Each module block below ordered its collection by `submittedAt` and then copied
 * `data.submittedAt` into the user's registration as the recovered submission
 * date. Counting the write sites across the codebase:
 *
 *   wave_applications          14 write sites,  0 set submittedAt
 *   export_applications         7 write sites,  0
 *   seller_verifications       12 write sites,  0
 *   cooperative_onboarding                      0
 *   academy_applications       14 write sites,  5
 *   farm_nation_applications   14 write sites,  5
 *
 * These collections live in the JSONB table, so the sort key becomes
 * `raw_data->>'submittedAt'`. A column that is NULL for every row is not an
 * error and produces no warning — the rows come back in whatever order the plan
 * gives, so `.limit(1)` took an ARBITRARY application rather than the newest one.
 * For the two collections where some rows do carry the field, rows without it
 * sort together and the choice among them is still arbitrary.
 *
 * Then the arbitrary row's `submittedAt` — usually undefined — was written over
 * the registration's real date. A repair tool corrupting the field it was
 * repairing, across all six modules.
 *
 * `createdAt` is set by every write path in all six collections, so it is the
 * sort. The date is taken from whichever field the module actually records, and a
 * missing one is left alone rather than written as undefined.
 */
async function latestApplicationFor(
    collection: string,
    userId: string
): Promise<{ data: Record<string, any>; submittedAt: any } | null> {
    const snap = await db.collection(collection)
        .where("userId", "==", userId)
        .orderBy("createdAt", "desc")
        .limit(1)
        .get();

    if (snap.empty) return null;

    const data = snap.docs[0].data() ?? {};
    return {
        data,
        submittedAt: data.submittedAt ?? data.applicationDate ?? data.createdAt ?? null,
    };
}

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
        if (!sessionResult.session || !hasAdminPermission(sessionResult.session.user.roles, "users:update")) {
            throw new Error("Unauthorized: Admin access required.");
        }

        logger.info("[DataRecovery] Starting serviceRegistrations recovery audit...");

        // 1. Get all users
        // Note: For very large databases, this should be paginated. 
        // For current scale, we'll process in chunks if possible, but start with a full sweep.
        const usersSnap = await db.collection(COLLECTIONS.USERS).all().get();
        stats.totalUsersProcessed = usersSnap.size;

        for (const userDoc of usersSnap.docs) {
            const userData = userDoc.data();
            const userId = userDoc.id;
            const registrations = userData.serviceRegistrations || {};
            
            const updates: Record<string, any> = {};
            let needsFix = false;

            // --- Cross-Reference Modules ---

            // 1. WAVE Recovery
            const waveApps = await latestApplicationFor(COLLECTIONS.WAVE_APPLICATIONS, userId);

            if (waveApps) {
                const waveData = waveApps.data;
                if (!registrations.wave || registrations.wave.status !== waveData.status) {
                    updates["serviceRegistrations.wave.status"] = waveData.status;
                    if (waveApps.submittedAt) {
                        updates["serviceRegistrations.wave.submittedAt"] = waveApps.submittedAt;
                    }
                    updates["serviceRegistrations.wave.recoveredAt"] = FieldValue.serverTimestamp();
                    needsFix = true;
                }
            }

            // 2. Academy Recovery
            const academyApps = await latestApplicationFor(COLLECTIONS.ACADEMY_APPLICATIONS, userId);

            if (academyApps) {
                const academyData = academyApps.data;
                if (!registrations.academy || registrations.academy.status !== academyData.status) {
                    updates["serviceRegistrations.academy.status"] = academyData.status;
                    updates["serviceRegistrations.academy.plan"] = academyData.plan;
                    if (academyApps.submittedAt) {
                        updates["serviceRegistrations.academy.submittedAt"] = academyApps.submittedAt;
                    }
                    updates["serviceRegistrations.academy.recoveredAt"] = FieldValue.serverTimestamp();
                    needsFix = true;
                }
            }

            // 3. Export Recovery
            const exportApps = await latestApplicationFor(COLLECTIONS.EXPORT_APPLICATIONS, userId);

            if (exportApps) {
                const exportData = exportApps.data;
                const status = exportData.status === "pending_review" ? "pending" : exportData.status;
                if (!registrations.export || registrations.export.status !== status) {
                    updates["serviceRegistrations.export.status"] = status;
                    if (exportApps.submittedAt) {
                        updates["serviceRegistrations.export.submittedAt"] = exportApps.submittedAt;
                    }
                    updates["serviceRegistrations.export.recoveredAt"] = FieldValue.serverTimestamp();
                    needsFix = true;
                }
            }

            // 4. Marketplace Recovery
            const marketplaceApps = await latestApplicationFor(COLLECTIONS.SELLER_VERIFICATIONS, userId);

            if (marketplaceApps) {
                const mData = marketplaceApps.data;
                if (!registrations.marketplace || registrations.marketplace.status !== mData.status) {
                    updates["serviceRegistrations.marketplace.status"] = mData.status;
                    updates["serviceRegistrations.marketplace.accountType"] = mData.accountType || "seller";
                    if (marketplaceApps.submittedAt) {
                        updates["serviceRegistrations.marketplace.submittedAt"] = marketplaceApps.submittedAt;
                    }
                    updates["serviceRegistrations.marketplace.recoveredAt"] = FieldValue.serverTimestamp();
                    needsFix = true;
                }
            }

            // 5. Cooperative Recovery
            const coopApps = await latestApplicationFor(COLLECTIONS.COOPERATIVE_ONBOARDING, userId);

            if (coopApps) {
                const cData = coopApps.data;
                if (!registrations.cooperatives || registrations.cooperatives.status !== cData.status) {
                    updates["serviceRegistrations.cooperatives.status"] = cData.status;
                    updates["serviceRegistrations.cooperatives.tier"] = cData.tier;
                    if (coopApps.submittedAt) {
                        updates["serviceRegistrations.cooperatives.submittedAt"] = coopApps.submittedAt;
                    }
                    updates["serviceRegistrations.cooperatives.recoveredAt"] = FieldValue.serverTimestamp();
                    needsFix = true;
                }
            }

            // 6. Farm Nation Recovery
            const farmApps = await latestApplicationFor(COLLECTIONS.FARM_NATION_APPLICATIONS, userId);

            if (farmApps) {
                const fData = farmApps.data;
                if (!registrations.farmNation || registrations.farmNation.status !== fData.status) {
                    updates["serviceRegistrations.farmNation.status"] = fData.status;
                    updates["serviceRegistrations.farmNation.role"] = fData.role;
                    if (farmApps.submittedAt) {
                        updates["serviceRegistrations.farmNation.submittedAt"] = farmApps.submittedAt;
                    }
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
                /**
                 * The first source that HAS a name, not the first that exists.
                 *
                 * This was an `||` chain over four application records, which
                 * stops at the first truthy value — and every one of those values
                 * is an object. So if the applicant had a WAVE application at all,
                 * the chain ended there whether or not it carried a name, and the
                 * academy, cooperative and Farm Nation records were never
                 * consulted. A name that was sitting in the next record along went
                 * unrecovered, by a tool whose whole purpose is to recover it.
                 */
                const nameSources = [
                    waveApps?.data,
                    academyApps?.data,
                    coopApps?.data?.personalInfo,
                    farmApps?.data?.profile,
                ].filter(Boolean) as Record<string, any>[];

                const firstNameFound = nameSources
                    .map((s) => s.firstName || s.first_name)
                    .find(Boolean);
                const lastNameFound = nameSources
                    .map((s) => s.lastName || s.last_name || s.surname)
                    .find(Boolean);

                if (firstNameFound && !userData.firstName) {
                    updates.firstName = firstNameFound;
                    needsFix = true;
                }
                if (lastNameFound && !userData.lastName) {
                    updates.lastName = lastNameFound;
                    needsFix = true;
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
