import { getAdminDb } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from "@/lib/logger";
import { normalizeUserDoc } from "@/lib/schema-normalizer";

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
            const activeData = activeUserDocSnap.exists ? activeUserDocSnap.data() : {};

            // Merge legacy data with active data, prioritizing legacy data for profile configurations,
            // but keeping current active IDs.
            const mergedUser = normalizeUserDoc({
                ...activeData,
                ...legacyData,
                uid: supabaseUid,
                supabaseAuthId: supabaseUid,
                updatedAt: new Date().toISOString(),
                // Keep tracks of legacy ID origin
                _legacyFirebaseUid: firebaseUid,
                _migratedAt: new Date().toISOString()
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
                    .catch(e => logger.warn(`[UserMigration] Non-fatal: failed to delete old member doc:`, e));
            } else if (memberSourceRef) {
                // If it was query-based (generated ID), just update its userId field to supabaseUid
                await memberSourceRef.update({
                    userId: supabaseUid,
                    _legacyFirebaseUid: firebaseUid,
                    _migratedAt: new Date().toISOString()
                }).catch(e => logger.warn(`[UserMigration] Non-fatal: failed to update old member doc userId:`, e));
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

        logger.info(`[UserMigration] Completed migration for ${firebaseUid} → ${supabaseUid}`);
        return { success: true };
    } catch (err: any) {
        logger.error(`[UserMigration] Error migrating legacy user ${firebaseUid}:`, err);
        return { success: false, error: err.message };
    }
}
