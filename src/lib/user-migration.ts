import { getAdminDb } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from "@/lib/logger";
import { normalizeUserDoc } from "@/lib/schema-normalizer";
import { includesPrivilegedRole } from "@/lib/admin-permissions";
import { registrationProgressScore } from "@/lib/registration-progress";
import { retirementPatch } from "@/lib/record-retirement";

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

/**
 *   #490 A SOURCE THAT HAS ALREADY BEEN MIGRATED IS NOT THE RECORD TO COPY.
 *
 *   This function copies a profile forward and tombstones the original with
 *   `_migratedTo`. That is correct and it means a migrated person has two rows.
 *   The third, fourth and fifth come from being handed a source that was already
 *   migrated: a second auth account for the same address makes
 *   chooseProfileForAuthAccount fall through to best-evidence, and the login
 *   path migrates anyway.
 *
 *   Copying from the DEAD row is the part that costs the member data. The row it
 *   points at is the current record — the merge of everything — and anything
 *   gained since the first migration lives only there.
 *
 *   So the chain is followed to its end before anything is read. Hops are
 *   bounded and visited ids recorded: a cycle in this data (A -> B -> A, which a
 *   pair of re-migrations could write before this existed) must terminate rather
 *   than spin, and stopping ON a cycle is safer than picking a side.
 *
 *   Returns the source to actually copy from, and every id passed through so the
 *   caller can chain the tombstone across all of them.
 */
async function followMigrationChain(
    db: any,
    startUid: string,
    targetUid: string,
): Promise<{ sourceUid: string; visited: string[] }> {
    const visited: string[] = [startUid];
    let current = startUid;

    for (let hop = 0; hop < 8; hop++) {
        const snap = await db.collection(COLLECTIONS.USERS).doc(current).get();
        if (!snap.exists) break;

        const pointer = snap.data()?._migratedTo;
        if (typeof pointer !== 'string' || pointer === '' || pointer === current) break;
        //   Already ours: the chain ends at the account we are migrating TO,
        //   and there is nothing to move.
        if (pointer === targetUid) break;
        if (visited.includes(pointer)) {
            logger.warn(
                `[UserMigration] migration chain loops at ${pointer} — stopping here rather than `
                + `picking a side. Chain: ${visited.join(' -> ')}`,
            );
            break;
        }

        visited.push(pointer);
        current = pointer;
    }

    if (current !== startUid) {
        logger.info(
            `[UserMigration] source ${startUid} was already migrated; copying from the current `
            + `record ${current} instead. Chain: ${visited.join(' -> ')}`,
        );
    }

    return { sourceUid: current, visited };
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
        //   #490 — the current record, not whichever row the caller happened to
        //   pick out of a set of duplicates.
        const { sourceUid, visited } = await followMigrationChain(db, firebaseUid, supabaseUid);
        //   #490 — every id the chain passed through holds rows that belong to
        //   this person. Steps 2-10 below sweep all of them, not just the one
        //   the caller named.
        const sourceIds = visited.filter((uid) => uid !== supabaseUid);
        if (sourceUid === supabaseUid) {
            //   The chain already ends here. Nothing to move, and re-running the
            //   copy would merge the row into itself.
            return { success: true };
        }

        // ── 1. MIGRATE USER PROFILE ──────────────────────────────────────────
        const legacyUserDocRef = db.collection(COLLECTIONS.USERS).doc(sourceUid);
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

            /**
             *   #490 EVERY ROW IN THE CHAIN IS TOMBSTONED, NOT JUST THE LAST.
             *
             *        Marking only the row copied from leaves the middle of a
             *        three-hop history pointing at an account that is itself
             *        superseded. chooseProfileForAuthAccount reads exactly this
             *        field to decide which row is live, so an unchained middle
             *        makes it unable to tell — and the supersession rule that
             *        depends on it silently stops working past the second hop.
             */
            for (const uid of visited) {
                if (uid === supabaseUid) continue;
                await db.collection(COLLECTIONS.USERS).doc(uid).update({
                    _migratedTo: supabaseUid,
                    _migratedAt: new Date().toISOString(),
                    supabaseAuthId: supabaseUid
                }).catch((e: unknown) =>
                    logger.warn(`[UserMigration] Non-fatal: failed to flag user doc ${uid}:`, e));
            }
        }

        /**
         *   #490 THE ROWS MAY BE UNDER AN INTERMEDIATE ID, NOT THE ONE THE
         *        CALLER NAMED.
         *
         *        Steps 2-10 moved rows keyed on `firebaseUid` alone. After a
         *        first migration L -> A those rows are under A, so a second
         *        migration A -> B that was handed L found nothing to move and
         *        left the member's savings, loans, withdrawals and payments
         *        stranded on A — while their profile went to B. Unreachable,
         *        silently, for exactly the people who have several profiles.
         *
         *        Every id in the chain is swept. Safe to do so on the strength
         *        of what the note at the end of this function already
         *        establishes: 'each step moves rows by id and finds nothing
         *        left to move on a second pass'. A single-hop migration passes
         *        through this loop exactly once and behaves as it always did.
         */
        for (const legacySourceUid of sourceIds) {
            // ── 2. MIGRATE COOPERATIVE MEMBERSHIP ────────────────────────────────
            const legacyMemberDocRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(legacySourceUid);
            const legacyMemberDoc = await legacyMemberDocRef.get();
            let memberDataToCopy: any = null;
            let memberSourceRef: any = null;

            if (legacyMemberDoc.exists) {
                memberDataToCopy = legacyMemberDoc.data();
                memberSourceRef = legacyMemberDocRef;
            } else {
                // Fallback: look up by userId field in case doc ID was generated
                const memberQuery = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS)
                    .where("userId", "==", legacySourceUid)
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
                    _legacyFirebaseUid: legacySourceUid,
                    _migratedAt: new Date().toISOString()
                }, { merge: true });

                logger.info(`[UserMigration] Migrated cooperative member document successfully.`);

                /**
                 *   #303 THE MIGRATION DESTROYED ITS OWN SOURCE ROW.
                 *
                 *        `memberSourceRef.delete()`, immediately after copying the
                 *        member into the new key — and the copy is a `set(..., {
                 *        merge: true })` whose success this code does not verify.
                 *        If the copy went to the wrong key, or merged onto an
                 *        existing row and lost a field, the original was already
                 *        gone. This runs on LOGIN, per user, unattended.
                 *
                 *        The comment called it "Safely delete". Nothing about it
                 *        was safe: the delete was fire-and-forget with a .catch()
                 *        that logged a warning, so a failure was invisible and a
                 *        success was irreversible.
                 *
                 *        The legacy row is marked migrated instead — pointing at
                 *        the new key, so the two are linked in both directions and
                 *        a bad migration can be reconstructed. The `else` branch
                 *        below was ALREADY doing exactly this for query-matched
                 *        rows; the two branches simply disagreed about whether the
                 *        source was worth keeping.
                 */
                if (memberSourceRef && memberSourceRef.id === legacySourceUid) {
                    await memberSourceRef.update({
                        _migratedTo: supabaseUid,
                        _migratedAt: new Date().toISOString(),
                        _legacyFirebaseUid: legacySourceUid,
                        ...retirementPatch("system:user-migration", null),
                    }).catch((e: unknown) => logger.warn(`[UserMigration] Non-fatal: failed to mark old member doc migrated:`, e));
                } else if (memberSourceRef) {
                    // If it was query-based (generated ID), just update its userId field to supabaseUid
                    await memberSourceRef.update({
                        userId: supabaseUid,
                        _legacyFirebaseUid: legacySourceUid,
                        _migratedAt: new Date().toISOString()
                    }).catch((e: unknown) => logger.warn(`[UserMigration] Non-fatal: failed to update old member doc userId:`, e));
                }
            }

            // ── 3. MIGRATE LOANS ────────────────────────────────────────────────
            const loansQuery = await db.collection(COLLECTIONS.COOPERATIVE_LOANS)
                .where("memberId", "==", legacySourceUid)
                .get();
            if (!loansQuery.empty) {
                for (const doc of loansQuery.docs) {
                    await doc.ref.update({
                        memberId: supabaseUid,
                        userId: supabaseUid,
                        _legacyMemberId: legacySourceUid
                    });
                }
                logger.info(`[UserMigration] Migrated ${loansQuery.size} loans.`);
            }

            // ── 4. MIGRATE TRANSACTIONS ──────────────────────────────────────────
            const txQuery = await db.collection(COLLECTIONS.COOPERATIVE_TRANSACTIONS)
                .where("userId", "==", legacySourceUid)
                .get();
            if (!txQuery.empty) {
                for (const doc of txQuery.docs) {
                    await doc.ref.update({
                        userId: supabaseUid,
                        memberId: supabaseUid,
                        _legacyUserId: legacySourceUid
                    });
                }
                logger.info(`[UserMigration] Migrated ${txQuery.size} transactions.`);
            }

            // ── 5. MIGRATE FIXED SAVINGS ─────────────────────────────────────────
            const fsQuery = await db.collection("cooperative_fixed_savings")
                .where("memberId", "==", legacySourceUid)
                .get();
            if (!fsQuery.empty) {
                for (const doc of fsQuery.docs) {
                    await doc.ref.update({
                        memberId: supabaseUid,
                        userId: supabaseUid,
                        _legacyMemberId: legacySourceUid
                    });
                }
                logger.info(`[UserMigration] Migrated ${fsQuery.size} fixed savings.`);
            }

            // ── 6. MIGRATE WITHDRAWALS ───────────────────────────────────────────
            const wdQuery = await db.collection("cooperative_withdrawals")
                .where("memberId", "==", legacySourceUid)
                .get();
            if (!wdQuery.empty) {
                for (const doc of wdQuery.docs) {
                    await doc.ref.update({
                        memberId: supabaseUid,
                        userId: supabaseUid,
                        _legacyMemberId: legacySourceUid
                    });
                }
                logger.info(`[UserMigration] Migrated ${wdQuery.size} withdrawals.`);
            }

            // ── 7. MIGRATE PAYMENTS ──────────────────────────────────────────────
            const pmQuery = await db.collection(COLLECTIONS.PROCESSED_PAYMENTS)
                .where("userId", "==", legacySourceUid)
                .get();
            if (!pmQuery.empty) {
                for (const doc of pmQuery.docs) {
                    await doc.ref.update({
                        userId: supabaseUid,
                        _legacyUserId: legacySourceUid
                    });
                }
                logger.info(`[UserMigration] Migrated ${pmQuery.size} payments.`);
            }

            // ── 8. ACADEMY APPLICATIONS ──────────────────────────────────────────
            const academyQuery = await db.collection(COLLECTIONS.ACADEMY_APPLICATIONS)
                .where("userId", "==", legacySourceUid)
                .get();
            if (!academyQuery.empty) {
                for (const doc of academyQuery.docs) {
                    await doc.ref.update({
                        userId: supabaseUid,
                        _legacyUserId: legacySourceUid
                    });
                }
                logger.info(`[UserMigration] Migrated ${academyQuery.size} academy applications.`);
            }

            // ── 9. FARM NATION APPLICATIONS ──────────────────────────────────────
            const farmQuery = await db.collection(COLLECTIONS.FARM_NATION_APPLICATIONS)
                .where("userId", "==", legacySourceUid)
                .get();
            if (!farmQuery.empty) {
                for (const doc of farmQuery.docs) {
                    await doc.ref.update({
                        userId: supabaseUid,
                        _legacyUserId: legacySourceUid
                    });
                }
                logger.info(`[UserMigration] Migrated ${farmQuery.size} farm nation applications.`);
            }

            // ── 10. WAVE APPLICATIONS ────────────────────────────────────────────
            const waveQuery = await db.collection("wave_applications")
                .where("userId", "==", legacySourceUid)
                .get();
            if (!waveQuery.empty) {
                for (const doc of waveQuery.docs) {
                    await doc.ref.update({
                        userId: supabaseUid,
                        _legacyUserId: legacySourceUid
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
        }

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
