"use server";

import { adminAuth } from "@/lib/firebase-admin";
import { supabaseDb as db } from "@/lib/supabase-db";
import { FieldPath } from "@/lib/firestore-compat";
import { logger } from "@/lib/logger";
import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session-guard";
import { COLLECTIONS } from "@/lib/types/firestore";

interface ScanResult { module: string;
    check: string;
    status: "pass" | "fail" | "warning";
    details: string;
    affectedIds: string[]; }

export async function runForensicScanAction(): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> { try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: "Authentication required", data: null as any };
    const { session } = sessionResult;
        // Strict Admin Check
        if (!session?.user?.roles?.includes("super_admin") && (!session?.user?.roles?.includes("admin") && !session?.user?.roles?.includes("super_admin"))) { return { success: false as const, results: [], error: "Unauthorized: Admin access required", data: null };
        }

        const results: ScanResult[] = [];
        logger.info("Starting Forensic Data Integrity Scan...");

        // ============================================================================
        // 1. AUTH & IAM INTEGRITY
        // ============================================================================

        // CHECK: Ghost Users (Auth users without Firestore profile)
        // Note: Listing all auth users is expensive, limit to 100 for this check or iterate if needed.
        // For safety, we'll scan the top 100 most recent users.
        try { const listUsersResult = await adminAuth.listUsers(100);
            const authUsers = listUsersResult.users;
            const ghostUserIds: string[] = [];

            // Batched, not one read per user.
            //
            // This was a serial `.doc(uid).get()` inside the loop: 100 round
            // trips, each waiting for the last. The same chunked
            // FieldPath.documentId() `in` query that admin.ts uses for hydration
            // does it in 4 concurrent queries.
            const authUserIds = authUsers.map((u: any) => u.uid);
            const existingIds = new Set<string>();
            const idChunks: string[][] = [];
            for (let i = 0; i < authUserIds.length; i += 30) {
                idChunks.push(authUserIds.slice(i, i + 30));
            }
            const snaps = await Promise.all(
                idChunks.map(chunk =>
                    db.collection(COLLECTIONS.USERS).where(FieldPath.documentId(), "in", chunk).get()
                )
            );
            snaps.forEach(snap => snap.docs.forEach((d: any) => existingIds.add(d.id)));

            for (const uid of authUserIds) {
                if (!existingIds.has(uid)) ghostUserIds.push(uid);
            }

            results.push({
                module: "Auth",
                check: "Ghost Users (Auth exists, No Profile)",
                status: ghostUserIds.length > 0 ? "fail" : "pass",
                details: `Scanned recent 100 Auth users. Found ${ghostUserIds.length} ghosts.`,
                affectedIds: ghostUserIds
            });
        } catch (e: any) { results.push({ module: "Auth", check: "Ghost User Scan", status: "fail", details: e.message, affectedIds: [] });
        }

        // ============================================================================
        // 2. MARKETPLACE INTEGRITY
        // ============================================================================

        // CHECK: Orphaned Products (Seller does not exist)
        try { const productsSnapshot = await db.collection(COLLECTIONS.PRODUCTS).limit(200).get(); // Sample check
            const orphanedProductIds: string[] = [];

            // Batched, and de-duplicated: the serial version re-read the same
            // seller once per product, so a seller with 40 listings cost 40
            // identical round trips.
            const sellerIds = [...new Set(
                productsSnapshot.docs.map((d: any) => d.data().sellerId).filter(Boolean)
            )] as string[];
            const liveSellers = new Set<string>();
            const sellerChunks: string[][] = [];
            for (let i = 0; i < sellerIds.length; i += 30) {
                sellerChunks.push(sellerIds.slice(i, i + 30));
            }
            const sellerSnaps = await Promise.all(
                sellerChunks.map(chunk =>
                    db.collection(COLLECTIONS.USERS).where(FieldPath.documentId(), "in", chunk).get()
                )
            );
            sellerSnaps.forEach(snap => snap.docs.forEach((d: any) => {
                if (!d.data()?.deleted) liveSellers.add(d.id);
            }));

            for (const doc of productsSnapshot.docs) {
                const sellerId = doc.data().sellerId;
                if (sellerId && !liveSellers.has(sellerId)) {
                    orphanedProductIds.push(doc.id);
                }
            }

            results.push({
                module: "Marketplace",
                check: "Orphaned Products (Deleted Seller)",
                status: orphanedProductIds.length > 0 ? "fail" : "pass",
                details: `Scanned ${productsSnapshot.size} products. Found ${orphanedProductIds.length} orphans.`,
                affectedIds: orphanedProductIds
            });
        } catch (e: any) { results.push({ module: "Marketplace", check: "Orphaned Product Scan", status: "fail", details: e.message, affectedIds: [] });
        }

        // CHECK: Contact Drift (Profile Phone vs Verified Phone)
        try { const verifiedSellersSnapshot = await db.collection(COLLECTIONS.SELLER_VERIFICATIONS)
                .where("status", "==", "approved")
                .limit(100)
                .get();

            const driftedIds: string[] = [];

            for (const doc of verifiedSellersSnapshot.docs) {
                const data = doc.data();
                const userId = data.userId;
                const verifiedPhone = data.phoneNumber;

                if (userId && verifiedPhone) {
                    const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
                    const userPhone = userDoc.data()?.phone;

                    if (userPhone !== verifiedPhone) {
                        driftedIds.push(userId);
                    }
                }
            }

            results.push({
                module: "Marketplace",
                check: "Phone Data Drift (Profile vs Verified)",
                status: driftedIds.length > 0 ? "warning" : "pass",
                details: `Scanned ${verifiedSellersSnapshot.size} verifications. Found ${driftedIds.length} mismatches.`,
                affectedIds: driftedIds
            });

        } catch (e: any) { results.push({ module: "Marketplace", check: "Contact Drift Scan", status: "fail", details: e.message, affectedIds: [] });
        }

        // ============================================================================
        // 3. WAVE INTEGRITY
        // ============================================================================

        // CHECK: Eligibility Paradox (WAVE Role but Male OR Under 18)
        try {
            const waveParticipantsQuery = await db.collection(COLLECTIONS.USERS)
                .where("roles", "array-contains", "wave_participant")
                .limit(200) // Sample size
                .get();

            const ineligibleIds: string[] = [];
            const undatedIds: string[] = [];

            for (const doc of waveParticipantsQuery.docs) {
                const data = doc.data();
                const gender = data.gender;

                // The age half of this check never ran.
                //
                // It read `data.dateOfBirth` on the USER document, and the only
                // thing that writes that field is the admin create-user flow in
                // admin.ts. Registration does not write it, and no code anywhere
                // writes a top-level `dob` either — so for every user who signed
                // up normally the value was undefined, `if (dob)` was false, and
                // the check passed them silently.
                //
                // The date does exist. _saveKYCProfileAction writes
                // `kyc.dateOfBirth` and `verificationProfile.dob`, and the WAVE
                // application itself carries one. All three are consulted now,
                // in the same order lib/verification-canonical.ts resolves an
                // identity profile.
                const dob = data.dateOfBirth
                    || data.kyc?.dateOfBirth
                    || data.verificationProfile?.dob;

                // Gender Check
                if (gender !== "female") {
                    ineligibleIds.push(`${doc.id} (Gender: ${gender})`);
                    continue;
                }

                // Age Check
                if (!dob) {
                    // Reported rather than passed. A forensic that cannot see a
                    // date should say so — "no finding" and "could not look" are
                    // different answers, and this check gave the first for the
                    // second. The cooperative reconciliation below already
                    // separates them with `unreadableMembers`.
                    undatedIds.push(`${doc.id} (no date of birth on record)`);
                    continue;
                }

                const birthDate = new Date(dob);
                if (Number.isNaN(birthDate.getTime())) {
                    undatedIds.push(`${doc.id} (unreadable date of birth: ${String(dob)})`);
                    continue;
                }

                const today = new Date();
                let age = today.getFullYear() - birthDate.getFullYear();
                const m = today.getMonth() - birthDate.getMonth();
                if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
                    age--;
                }
                if (age < 18) {
                    ineligibleIds.push(`${doc.id} (Age: ${age})`);
                }
            }

            results.push({
                module: "WAVE",
                check: "Eligibility Paradox (Gender/Age)",
                status: ineligibleIds.length > 0 ? "fail" : "pass",
                details:
                    `Scanned ${waveParticipantsQuery.size} participants. Found ${ineligibleIds.length} ineligible.` +
                    (undatedIds.length > 0
                        ? ` ${undatedIds.length} could not be age-checked — no readable date of birth on record.`
                        : ""),
                // Listed alongside, so somebody reading the report can see WHO
                // was not checked. They are not counted as ineligible: an
                // absent date is a gap in the records, not evidence about a
                // participant.
                affectedIds: [...ineligibleIds, ...undatedIds]
            });
        } catch (e: any) { results.push({ module: "WAVE", check: "Eligibility Scan", status: "fail", details: e.message, affectedIds: [] });
        }

        // ============================================================================
        // 4. COOPERATIVE INTEGRITY
        // ============================================================================

        // CHECK: Financial Reconciliation (Transactions vs Balance)
        // Note: This is expensive. We'll sample 20 members.
        try { const coopMembersQuery = await db.collection(COLLECTIONS.USERS)
                .where("roles", "array-contains", "cooperative_member")
                .limit(20)
                .get();

            const balanceMismatches: string[] = [];
            const unreadableMembers: string[] = [];

            // This check reconciled nothing, on both sides of the comparison.
            //
            // It read `doc.data().cooperativeProfile?.savingsBalance` off the
            // USER document. Nothing in the codebase writes cooperativeProfile —
            // not one line. The maintained balance lives on the
            // COOPERATIVE_MEMBERS document as savingsBalance, which is what
            // debitJsonbBalanceWithFloor debits for a withdrawal and what
            // user.ts reads before allowing account deletion.
            //
            // So `|| 0` turned "this field does not exist" into "the balance is
            // zero", for every member, forever. That is how a broken check goes
            // on looking healthy.
            //
            // The ledger side was wrong too. _makeContributionAction credits
            // savingsBalance and writes its row with type "savings" — which was
            // not in the counted list — while "withdrawal" was subtracted and is
            // never written at all: a withdrawal moves savings into
            // lockedBalance and records a cooperative_withdrawals document.
            //
            // Both sides are corrected here, and lockedBalance is included
            // because money reserved for a pending withdrawal is still the
            // member's.
            // fixed_savings_lock is a debit and was not written at all until
            // now: creating a fixed savings plan reduced savingsBalance and
            // recorded the movement in neither ledger. Unlike a withdrawal it
            // does not move the amount into lockedBalance, so heldBalance fell
            // with nothing on the ledger side to match it, and every member
            // holding a plan reported as a mismatch here — permanently, and
            // correctly, because the money genuinely was not accounted for.
            //
            // A check that always fails for a whole class of member is a check
            // nobody reads, which is the same way the cooperativeProfile bug
            // above stayed invisible. Both creation paths write the row now,
            // and it is counted here.
            const CREDIT_TYPES = ["savings", "deposit", "contribution", "loan_repayment_excess"];
            const DEBIT_TYPES = ["withdrawal", "fixed_savings_lock"];

            for (const doc of coopMembersQuery.docs) {
                const userId = doc.id;

                const memberSnap = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(userId).get();
                if (!memberSnap.exists) {
                    // Reported rather than counted as a zero balance. A user with
                    // the cooperative_member role and no membership record is
                    // itself a finding.
                    unreadableMembers.push(userId);
                    continue;
                }

                const memberData = memberSnap.data() || {};
                const heldBalance = Number(memberData.savingsBalance || 0) + Number(memberData.lockedBalance || 0);

                const transactionsSnapshot = await db.collection(COLLECTIONS.COOPERATIVE_TRANSACTIONS)
                    .where("userId", "==", userId)
                    .where("status", "==", "completed") // Only completed transactions count
                    .get();

                let calculatedBalance = 0;
                transactionsSnapshot.docs.forEach(tx => {
                    const type = tx.data().type;
                    const amount = Number(tx.data().amount || 0);
                    if (CREDIT_TYPES.includes(type)) {
                        calculatedBalance += amount;
                    } else if (DEBIT_TYPES.includes(type)) {
                        calculatedBalance -= amount;
                    }
                });

                // Tolerance for floating point math (kobo)
                if (Math.abs(calculatedBalance - heldBalance) > 1.0) {
                    balanceMismatches.push(`${userId} (Held: ${heldBalance}, Ledger: ${calculatedBalance})`);
                }
            }

            results.push({
                module: "Cooperative",
                check: "Financial Reconciliation (Balance vs Txs)",
                status: (balanceMismatches.length > 0 || unreadableMembers.length > 0) ? "fail" : "pass",
                // The sample size and the comparison are both stated, so a
                // "pass" cannot be read as more than it is.
                details: `Sampled ${coopMembersQuery.docs.length} members. Compared cooperative_members.savingsBalance + lockedBalance against completed ledger rows (${CREDIT_TYPES.join("/")} minus ${DEBIT_TYPES.join("/")}). ${balanceMismatches.length} mismatch(es), ${unreadableMembers.length} member(s) with no membership record.`,
                affectedIds: [...balanceMismatches, ...unreadableMembers.map((id) => `${id} (no membership record)`)]
            });
        } catch (e: any) { results.push({ module: "Cooperative", check: "Financial Scan", status: "fail", details: e.message, affectedIds: [] });
        }

        // ============================================================================
        // 5. FARM NATION INTEGRITY
        // ============================================================================

        // CHECK: Verification Fraud (Badge without Document)
        try { const verifiedFarmersQuery = await db.collection(COLLECTIONS.USERS)
                .where("farmNationProfile.isVerified", "==", true)
                .limit(50)
                .get();

            const fraudIds: string[] = [];

            for (const doc of verifiedFarmersQuery.docs) {
                const userId = doc.id;
                // Check if verification doc exists
                const verifSnapshot = await db.collection(COLLECTIONS.LAND_VERIFICATIONS)
                    .where("userId", "==", userId)
                    .where("status", "==", "verified")
                    .limit(1)
                    .get();

                if (verifSnapshot.empty) {
                    fraudIds.push(userId);
                }
            }

            results.push({
                module: "Farm Nation",
                check: "Verification Fraud (Badge vs Doc)",
                status: fraudIds.length > 0 ? "fail" : "pass",
                details: `Scanned 50 verified farmers. Found ${fraudIds.length} without proof.`,
                affectedIds: fraudIds
            });
        } catch (e: any) { results.push({ module: "Farm Nation", check: "Verification Scan", status: "fail", details: e.message, affectedIds: [] });
        }

        // ============================================================================
        // 6. EXPORT INTEGRITY
        // ============================================================================

        // CHECK: Investment Cap Breach
        try {
            const activeWindows = await db.collection(COLLECTIONS.EXPORT_WINDOWS)
                .where("status", "==", "active")
                .get();

            const breachedIds: string[] = [];

            for (const doc of activeWindows.docs) {
                const data = doc.data();
                const cap = data.investmentCap || 0;
                const totalInvested = data.totalInvested || 0;

                // Small tolerance
                if (totalInvested > (cap * 1.05)) { // 5% buffer overrun is suspicious but maybe allowed? Let's flag strict.
                    breachedIds.push(`${doc.id} (Inv: ${totalInvested}, Cap: ${cap})`);
                }
            }

            results.push({
                module: "Export",
                check: "Investment Cap Breach",
                status: breachedIds.length > 0 ? "warning" : "pass",
                details: `Scanned ${activeWindows.size} active windows. Found ${breachedIds.length} over-funded.`,
                affectedIds: breachedIds
            });
        } catch (e: any) { results.push({ module: "Export", check: "Cap Scan", status: "fail", details: e.message, affectedIds: [] });
        }

        // ============================================================================
        // 7. ACADEMY INTEGRITY
        // ============================================================================

        // CHECK: Enrollment Integrity (Paid but no Transaction)
        try {
            const enrollments = await db.collection(COLLECTIONS.COURSE_ENROLLMENTS)
                .where("paymentStatus", "==", "paid")
                .limit(50)
                .get();

            const freeRideIds: string[] = [];

            for (const doc of enrollments.docs) {
                const enrollment = doc.data();
                // If it was "paid", there should be a paymentRef or we check transactions
                // Note: Schema might allow manual entry, so this is a heuristic.
                if (enrollment.amountPaid > 0 && !enrollment.paymentReference) {
                    freeRideIds.push(`${doc.id} (No Payment Ref)`);
                }
            }

            results.push({
                module: "Academy",
                check: "Enrollment Audit (Paid vs Proof)",
                status: freeRideIds.length > 0 ? "warning" : "pass",
                details: `Scanned 50 paid enrollments. Found ${freeRideIds.length} with missing refs.`,
                affectedIds: freeRideIds
            });
        } catch (e: any) { results.push({ module: "Academy", check: "Enrollment Scan", status: "fail", details: e.message, affectedIds: [] });
        }

        return { error: null, success: true as const, results , data: null };

    } catch (error: any) { logger.error("Forensic scan failed:", error);
        return { success: false as const, results: [], error: error.message, data: null };
    }
}
