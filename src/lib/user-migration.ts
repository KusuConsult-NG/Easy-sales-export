import { getAdminDb } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from "@/lib/logger";
import { normalizeUserDoc } from "@/lib/schema-normalizer";
import { includesPrivilegedRole } from "@/lib/admin-permissions";
import { registrationProgressScore } from "@/lib/registration-progress";

/**
 * Migration utility for moving legacy user data (linked under legacy Firebase UID)
 * to their new Supabase Auth UUID key.
 * 
 * Migrates:
 * 1. User document in USERS collection
 * 2. Cooperative member document in COOPERATIVE_MEMBERS collection
 * 3. Associated cooperative loans, transactions, savings, and withdrawals
 * 4. Processed payment records
 * 5. Academy and Farm Nation applications
 */
/**
 * Fields where the ACTIVE document wins if it defines them at all.
 *
 * Money and the counters derived from it. A legacy record is by definition the
 * older of the two, and a member who has been using the new account has a live
 * balance on it; letting a stale figure overwrite that is how #84 zeroed
 * people's savings from the legacy-onboarding screen.
 */
const ACTIVE_WINS_FIELDS = [
    'walletBalance',
    'savingsBalance',
    'loanBalance',
    'totalContributions',
    'totalSavings',
    'lockedBalance',
    'availableBalance',
] as const;

function preserveActiveValues(
    activeData: Record<string, any>,
    legacyData: Record<string, any>,
): Record<string, any> {
    const kept: Record<string, any> = {};
    for (const field of ACTIVE_WINS_FIELDS) {
        if (activeData[field] !== undefined && activeData[field] !== null) {
            if (legacyData[field] !== undefined && legacyData[field] !== activeData[field]) {
                logger.warn(
                    `[UserMigration] Kept the live ${field} (${activeData[field]}) rather than the ` +
                    `legacy value (${legacyData[field]}).`
                );
            }
            kept[field] = activeData[field];
        }
    }
    return kept;
}

export async function migrateLegacyUserData(
    firebaseUid: string,
    supabaseUid: string,
    email?: string
): Promise<{ success: boolean; error?: string }> {
    if (!firebaseUid || !supabaseUid || firebaseUid === supabaseUid) {
        return { success: true };
    }

    const db = getAdminDb();
    logger.info(`[UserMigration] Starting migration from legacy ID: ${firebaseUid} to Supabase ID: ${supabaseUid} (${email || "no email"})`);

    try {
        // ── 1. MIGRATE USER PROFILE ──────────────────────────────────────────
        const legacyUserDocRef = db.collection(COLLECTIONS.USERS).doc(firebaseUid);
        const legacyUserDoc = await legacyUserDocRef.get();
        
        if (legacyUserDoc.exists) {
            const legacyData = legacyUserDoc.data()!;
            
            // Fetch existing Supabase-keyed user document if any
            const activeUserDocRef = db.collection(COLLECTIONS.USERS).doc(supabaseUid);
            const activeUserDocSnap = await activeUserDocRef.get();
            // data() returns undefined for a missing document, and `exists`
            // does not narrow that. `?? {}` says the same thing as the
            // ternary did and is honest about the type.
            const activeData = activeUserDocSnap.data() ?? {};

            // Merge serviceRegistrations safely, keeping whichever registration is further along
            const mergedServiceRegistrations = {
                ...(legacyData.serviceRegistrations || {}),
                ...(activeData.serviceRegistrations || {})
            };


            for (const key of Object.keys(mergedServiceRegistrations)) {
                const legacyVal = legacyData.serviceRegistrations?.[key];
                const activeVal = activeData.serviceRegistrations?.[key];
                if (legacyVal && activeVal) {
                    const scoreLegacy = registrationProgressScore(legacyVal.status || '');
                    const scoreActive = registrationProgressScore(activeVal.status || '');
                    mergedServiceRegistrations[key] = scoreActive > scoreLegacy ? activeVal : legacyVal;
                }
            }

            /**
             * THE LEGACY DOCUMENT USED TO WIN ON EVERY FIELD.
             *
             * `{ ...activeData, ...legacyData }` spreads legacy LAST, so every
             * key on the legacy record overwrote the live one. This function is
             * called from the LOGIN path (auth.ts preValidateLoginAction) for
             * any user whose email matches a legacy record, so that overwrite is
             * automatic and unattended. Two things must not travel that way,
             * and this audit has already closed both of them elsewhere:
             *
             *   ROLES (#87's defect, in a second place). If the legacy document
             *   carries `roles: ['admin']`, signing in merged those roles onto
             *   the live account. admin/_legacy.ts was closed on exactly this —
             *   "any resulting role set containing a privileged role needs a
             *   super_admin to write it" — and this path had no guard at all.
             *   Non-privileged roles still carry forward, which is the point of
             *   a migration; a privileged one is logged for a super_admin to
             *   grant deliberately, and never granted by a login.
             *
             *   BALANCES (#84's defect, in a second place). Legacy onboarding
             *   was zeroing an existing member's savings, loans and
             *   contributions on every re-run. The same shape is here: a stale
             *   legacy balance overwriting the live one. The active value wins
             *   wherever the active document actually defines it.
             *
             * Everything else keeps the previous precedence — legacy first for
             * profile configuration, which is what the migration is for.
             */
            const legacyRoles: string[] = Array.isArray(legacyData.roles) ? legacyData.roles : [];
            const activeRoles: string[] = Array.isArray(activeData.roles) ? activeData.roles : [];

            const escalating = legacyRoles.filter(
                (r) => includesPrivilegedRole([r]) && !activeRoles.includes(r),
            );
            if (escalating.length) {
                logger.error(
                    `[UserMigration] REFUSED to grant privileged role(s) [${escalating.join(', ')}] to ` +
                    `${supabaseUid} through an automatic migration from ${firebaseUid}. A super_admin ` +
                    `must assign them deliberately if they are still warranted.`
                );
            }

            const safeRoles = Array.from(new Set([
                ...activeRoles,
                ...legacyRoles.filter((r) => !escalating.includes(r)),
            ]));

            const mergedUser = normalizeUserDoc({
                ...activeData,
                ...legacyData,
                // Re-applied AFTER the legacy spread, so the legacy record cannot
                // reintroduce what the two rules above removed.
                ...preserveActiveValues(activeData, legacyData),
                roles: safeRoles.length ? safeRoles : undefined,
                serviceRegistrations: mergedServiceRegistrations,
                uid: supabaseUid,
                supabaseAuthId: supabaseUid,
                updatedAt: new Date().toISOString(),
            });

            await activeUserDocRef.set(mergedUser, { merge: true });
            logger.info(`[UserMigration] Migrated user document successfully.`);

            // Mark legacy document as migrated
            await legacyUserDocRef.update({
                _migratedTo: supabaseUid,
                _migratedAt: new Date().toISOString(),
                supabaseAuthId: supabaseUid
            }).catch(e => logger.warn(`[UserMigration] Non-fatal: failed to flag legacy user doc:`, e));
        }

        // ── 2. MIGRATE COOPERATIVE MEMBERSHIP ────────────────────────────────
        const legacyMemberDocRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(firebaseUid);
        const legacyMemberDoc = await legacyMemberDocRef.get();
        let memberDataToCopy: any = null;
        let memberSourceRef: any = null;

        if (legacyMemberDoc.exists) {
            memberDataToCopy = legacyMemberDoc.data();
            memberSourceRef = legacyMemberDocRef;
        } else {
            // Fallback: look up by userId field in case doc ID was generated
            const memberQuery = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS)
                .where("userId", "==", firebaseUid)
                .limit(1)
                .get();
            if (!memberQuery.empty) {
                memberDataToCopy = memberQuery.docs[0].data();
                memberSourceRef = memberQuery.docs[0].ref;
            }
        }

        if (memberDataToCopy) {
            // Write the member record to the new Supabase UUID key
            const activeMemberDocRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(supabaseUid);
            await activeMemberDocRef.set({
                ...memberDataToCopy,
                id: supabaseUid, // ensure ID matches doc ID
                userId: supabaseUid,
                updatedAt: new Date().toISOString(),
                _legacyFirebaseUid: firebaseUid,
                _migratedAt: new Date().toISOString()
            }, { merge: true });

            logger.info(`[UserMigration] Migrated cooperative member document successfully.`);

            // Safely delete old member document if it is keyed by firebaseUid
            if (memberSourceRef && memberSourceRef.id === firebaseUid) {
                await memberSourceRef.delete()
                    .catch((e: unknown) => logger.warn(`[UserMigration] Non-fatal: failed to delete old member doc:`, e));
            } else if (memberSourceRef) {
                // If it was query-based (generated ID), just update its userId field to supabaseUid
                await memberSourceRef.update({
                    userId: supabaseUid,
                    _legacyFirebaseUid: firebaseUid,
                    _migratedAt: new Date().toISOString()
                }).catch((e: unknown) => logger.warn(`[UserMigration] Non-fatal: failed to update old member doc userId:`, e));
            }
        }

        // ── 3. MIGRATE LOANS ────────────────────────────────────────────────
        const loansQuery = await db.collection(COLLECTIONS.COOPERATIVE_LOANS)
            .where("memberId", "==", firebaseUid)
            .get();
        if (!loansQuery.empty) {
            for (const doc of loansQuery.docs) {
                await doc.ref.update({
                    memberId: supabaseUid,
                    userId: supabaseUid,
                    _legacyMemberId: firebaseUid
                });
            }
            logger.info(`[UserMigration] Migrated ${loansQuery.size} loans.`);
        }

        // ── 4. MIGRATE TRANSACTIONS ──────────────────────────────────────────
        const txQuery = await db.collection(COLLECTIONS.COOPERATIVE_TRANSACTIONS)
            .where("userId", "==", firebaseUid)
            .get();
        if (!txQuery.empty) {
            for (const doc of txQuery.docs) {
                await doc.ref.update({
                    userId: supabaseUid,
                    memberId: supabaseUid,
                    _legacyUserId: firebaseUid
                });
            }
            logger.info(`[UserMigration] Migrated ${txQuery.size} transactions.`);
        }

        // ── 5. MIGRATE FIXED SAVINGS ─────────────────────────────────────────
        const fsQuery = await db.collection("cooperative_fixed_savings")
            .where("memberId", "==", firebaseUid)
            .get();
        if (!fsQuery.empty) {
            for (const doc of fsQuery.docs) {
                await doc.ref.update({
                    memberId: supabaseUid,
                    userId: supabaseUid,
                    _legacyMemberId: firebaseUid
                });
            }
            logger.info(`[UserMigration] Migrated ${fsQuery.size} fixed savings.`);
        }

        // ── 6. MIGRATE WITHDRAWALS ───────────────────────────────────────────
        const wdQuery = await db.collection("cooperative_withdrawals")
            .where("memberId", "==", firebaseUid)
            .get();
        if (!wdQuery.empty) {
            for (const doc of wdQuery.docs) {
                await doc.ref.update({
                    memberId: supabaseUid,
                    userId: supabaseUid,
                    _legacyMemberId: firebaseUid
                });
            }
            logger.info(`[UserMigration] Migrated ${wdQuery.size} withdrawals.`);
        }

        // ── 7. MIGRATE PAYMENTS ──────────────────────────────────────────────
        const pmQuery = await db.collection(COLLECTIONS.PROCESSED_PAYMENTS)
            .where("userId", "==", firebaseUid)
            .get();
        if (!pmQuery.empty) {
            for (const doc of pmQuery.docs) {
                await doc.ref.update({
                    userId: supabaseUid,
                    _legacyUserId: firebaseUid
                });
            }
            logger.info(`[UserMigration] Migrated ${pmQuery.size} payments.`);
        }

        // ── 8. ACADEMY APPLICATIONS ──────────────────────────────────────────
        const academyQuery = await db.collection(COLLECTIONS.ACADEMY_APPLICATIONS)
            .where("userId", "==", firebaseUid)
            .get();
        if (!academyQuery.empty) {
            for (const doc of academyQuery.docs) {
                await doc.ref.update({
                    userId: supabaseUid,
                    _legacyUserId: firebaseUid
                });
            }
            logger.info(`[UserMigration] Migrated ${academyQuery.size} academy applications.`);
        }

        // ── 9. FARM NATION APPLICATIONS ──────────────────────────────────────
        const farmQuery = await db.collection(COLLECTIONS.FARM_NATION_APPLICATIONS)
            .where("userId", "==", firebaseUid)
            .get();
        if (!farmQuery.empty) {
            for (const doc of farmQuery.docs) {
                await doc.ref.update({
                    userId: supabaseUid,
                    _legacyUserId: firebaseUid
                });
            }
            logger.info(`[UserMigration] Migrated ${farmQuery.size} farm nation applications.`);
        }

        // ── 10. WAVE APPLICATIONS ────────────────────────────────────────────
        const waveQuery = await db.collection("wave_applications")
            .where("userId", "==", firebaseUid)
            .get();
        if (!waveQuery.empty) {
            for (const doc of waveQuery.docs) {
                await doc.ref.update({
                    userId: supabaseUid,
                    _legacyUserId: firebaseUid
                });
            }
            logger.info(`[UserMigration] Migrated ${waveQuery.size} wave applications.`);
        }

        /**
         * THE COMPLETION MARKER IS WRITTEN LAST, AND IT WAS WRITTEN FIRST.
         *
         * `_migratedAt` and `_legacyFirebaseUid` used to go onto the user
         * document in step 1, before the ten collections below had moved. The
         * caller decides whether to migrate with
         *
         *     !userDoc.data()?._migratedAt && !userDoc.data()?._legacyFirebaseUid
         *
         * so any throw between step 1 and here — one bad row in the loans query,
         * a timeout on transactions — left the marker set and the remaining
         * collections behind. The next login sees a migrated user and never
         * retries, so the member's loans, savings, withdrawals and payments stay
         * keyed to an id nothing reads. Permanently, and silently.
         *
         * Written here instead: reaching this line means every step above
         * returned. A failure now leaves the marker unset and the next login
         * runs the whole thing again — which is safe, because each step moves
         * rows by id and finds nothing left to move on a second pass.
         */
        await db.collection(COLLECTIONS.USERS).doc(supabaseUid).set({
            _legacyFirebaseUid: firebaseUid,
            _migratedAt: new Date().toISOString(),
        }, { merge: true });

        logger.info(`[UserMigration] Completed migration for ${firebaseUid} → ${supabaseUid}`);
        return { success: true };
    } catch (err: any) {
        logger.error(`[UserMigration] Error migrating legacy user ${firebaseUid}:`, err);
        return { success: false, error: err.message };
    }
}
