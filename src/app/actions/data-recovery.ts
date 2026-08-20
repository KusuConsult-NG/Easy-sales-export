"use server";

import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from "@/lib/logger";
import { requireSession } from "@/lib/session-guard";
import { hasAdminPermission } from "@/lib/admin-permissions";
import { FieldValue } from "@/lib/firestore-compat";
import { recordAdminAction } from "@/lib/audit-log";
import { registrationProgressScore } from "@/lib/registration-progress";

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

/**
 * Should the recovery overwrite this module's registration?
 *
 * IT USED TO OVERWRITE WHENEVER THE TWO MERELY DIFFERED:
 *
 *     if (!registrations.wave || registrations.wave.status !== waveData.status)
 *
 * — six times, once per module. The registration is the LIVE record and the
 * application row is the historical one, so "different" routinely means the
 * registration is AHEAD. An admin approves a WAVE application by writing
 * `serviceRegistrations.wave.status = "approved"` on the user; if the
 * application row still reads `pending`, this tool put the member back to
 * pending. A repair utility revoking approved, paid-for memberships across six
 * modules at once, for every user on the platform, from one button.
 *
 * The codebase already knows how to answer this — merges compare the two
 * statuses and keep whichever is further along. That rule now lives in
 * lib/registration-progress.ts and this uses it: a registration is only
 * rewritten when it is MISSING, or when the application is genuinely further
 * along than what the user currently has.
 */
function shouldRecover(
    current: { status?: string } | undefined,
    applicationStatus: string | undefined,
): boolean {
    if (!current) return true;
    return registrationProgressScore(applicationStatus) > registrationProgressScore(current.status);
}

/**
 * Assign only when there is something to assign.
 *
 * The `submittedAt` writes below were already guarded — the header of this file
 * explains why, at length: an undefined value written over a real one is a
 * repair tool corrupting the field it repairs. That guard was applied to
 * `submittedAt` ALONE, and the fields beside it kept the bug:
 *
 *     updates["serviceRegistrations.academy.plan"]           = academyData.plan;
 *     updates["serviceRegistrations.cooperatives.tier"]      = cData.tier;
 *     updates["serviceRegistrations.farmNation.role"]        = fData.role;
 *     updates["serviceRegistrations.marketplace.accountType"] = mData.accountType || "seller";
 *
 * An application without a `plan` erased the learner's plan; without a `tier`,
 * the member's tier; without a `role`, their Farm Nation role. The marketplace
 * one is worse than undefined — it DEFAULTS to "seller", so a buyer-only
 * account whose verification row carries no accountType was rewritten as a
 * seller.
 */
function setIfPresent(updates: Record<string, any>, key: string, value: unknown): void {
    if (value !== undefined && value !== null && value !== "") {
        updates[key] = value;
    }
}

interface RecoveryStats {
    totalUsersProcessed: number;
    corruptedFound: number;
    fixedCount: number;
    errors: string[];
    /** True when the run only reported what it WOULD change. */
    dryRun: boolean;
    /**
     * What a dry run would have written, one entry per affected user.
     *
     * THERE WAS NO WAY TO SEE THIS BEFORE PRESSING THE BUTTON. A platform-wide,
     * destructive repair across six modules and every user, with no preview —
     * which is exactly how #180 (the downgrade) would have been discovered too
     * late. Capped so a large sweep does not return a payload nobody can read.
     */
    plannedChanges: Array<{ userId: string; updates: Record<string, unknown> }>;
}

/** Beyond this many entries a dry run reports counts only. */
const MAX_PLANNED_CHANGES_REPORTED = 200;

/**
 * High-Assurance Data Recovery & Integrity Utility
 * 
 * This action performs a platform-wide audit of the 'serviceRegistrations' object
 * in the users collection. It cross-references the authoritative application 
 * collections to reconstruct any registration data lost due to destructive 
 * object-literal writes.
 */
export async function runServiceRegistrationRecoveryAction(
    options: { dryRun?: boolean; pageSize?: number; maxUsers?: number } = {},
): Promise<{ success: boolean; stats: RecoveryStats }> {
    const stats: RecoveryStats = {
        totalUsersProcessed: 0,
        corruptedFound: 0,
        fixedCount: 0,
        errors: [],
        dryRun: options.dryRun === true,
        plannedChanges: [],
    };

    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session || !hasAdminPermission(sessionResult.session.user.roles, "users:update")) {
            throw new Error("Unauthorized: Admin access required.");
        }

        logger.info("[DataRecovery] Starting serviceRegistrations recovery audit...");

        /**
         * PAGINATED, because this reads every user on the platform.
         *
         * It was `.all().get()` — the whole users table into memory in one go,
         * with the note "For very large databases, this should be paginated"
         * sitting above it. Each user then costs six more queries, so the run is
         * 6N+1 round trips and grows without bound. At any real membership it
         * times out PART-WAY THROUGH, having already written some users and not
         * others, and reports nothing about where it stopped.
         *
         * A page at a time now, with an optional ceiling so an operator can try
         * it on a slice before committing to the whole platform.
         */
        const pageSize = Math.max(1, Math.min(options.pageSize ?? 200, 1000));
        const maxUsers = options.maxUsers && options.maxUsers > 0 ? options.maxUsers : Infinity;

        const userDocs: Array<{ id: string; data: () => any }> = [];
        for (let offset = 0; userDocs.length < maxUsers; offset += pageSize) {
            const page = await db.collection(COLLECTIONS.USERS)
                .orderBy("createdAt", "asc")
                .limit(pageSize)
                .offset(offset)
                .get();
            if (page.empty) break;
            userDocs.push(...page.docs);
            if (page.docs.length < pageSize) break;
        }

        const scope = userDocs.slice(0, maxUsers === Infinity ? undefined : maxUsers);
        stats.totalUsersProcessed = scope.length;

        for (const userDoc of scope) {
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
                if (shouldRecover(registrations.wave, waveData.status)) {
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
                if (shouldRecover(registrations.academy, academyData.status)) {
                    updates["serviceRegistrations.academy.status"] = academyData.status;
                    setIfPresent(updates, "serviceRegistrations.academy.plan", academyData.plan);
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
                if (shouldRecover(registrations.export, status)) {
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
                if (shouldRecover(registrations.marketplace, mData.status)) {
                    updates["serviceRegistrations.marketplace.status"] = mData.status;
                    setIfPresent(updates, "serviceRegistrations.marketplace.accountType", mData.accountType);
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
                if (shouldRecover(registrations.cooperatives, cData.status)) {
                    updates["serviceRegistrations.cooperatives.status"] = cData.status;
                    setIfPresent(updates, "serviceRegistrations.cooperatives.tier", cData.tier);
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
                if (shouldRecover(registrations.farmNation, fData.status)) {
                    updates["serviceRegistrations.farmNation.status"] = fData.status;
                    setIfPresent(updates, "serviceRegistrations.farmNation.role", fData.role);
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

                // A DRY RUN REPORTS AND WRITES NOTHING. See RecoveryStats.
                if (options.dryRun) {
                    if (stats.plannedChanges.length < MAX_PLANNED_CHANGES_REPORTED) {
                        stats.plannedChanges.push({ userId, updates: { ...updates } });
                    }
                    continue;
                }

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
        await recordAdminAction({
            action: 'data_recovery_run',
            userId: sessionResult.session.user.id,
            targetType: 'service_registrations',
            // stats already carries dryRun, so the log distinguishes a run that
            // wrote from one that only reported — they were indistinguishable
            // before, and only one of them changes anybody's account.
            metadata: { stats },
        });
        return { success: true, stats };

    } catch (error: any) {
        logger.error("[DataRecovery] Systemic failure in recovery action:", error);
        return { success: false, stats: { ...stats, errors: [...stats.errors, error.message] } };
    }
}
