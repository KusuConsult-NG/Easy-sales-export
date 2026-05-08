"use server";

import { db, adminAuth } from "@/lib/firebase-admin";
import { logger } from "@/lib/logger";
import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session-guard";
import { COLLECTIONS } from "@/lib/types/firestore";

interface ScanResult {
    module: string;
    check: string;
    status: "pass" | "fail" | "warning";
    details: string;
    affectedIds: string[];
}

export async function runForensicScanAction(): Promise<{ error: string | null, success: true | false; results: ScanResult[];  }> {
    try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return null as any;
    const { session } = sessionResult;
        // Strict Admin Check
        if (!session?.user?.roles?.includes("super_admin") && (!session?.user?.roles?.includes("admin") && !session?.user?.roles?.includes("super_admin"))) {
            return { success: false as const, results: [], error: "Unauthorized: Admin access required" };
        }

        const results: ScanResult[] = [];
        logger.info("Starting Forensic Data Integrity Scan...");

        // ============================================================================
        // 1. AUTH & IAM INTEGRITY
        // ============================================================================

        // CHECK: Ghost Users (Auth users without Firestore profile)
        // Note: Listing all auth users is expensive, limit to 100 for this check or iterate if needed.
        // For safety, we'll scan the top 100 most recent users.
        try {
            const listUsersResult = await adminAuth.listUsers(100);
            const authUsers = listUsersResult.users;
            const ghostUserIds: string[] = [];

            for (const user of authUsers) {
                const doc = await db.collection(COLLECTIONS.USERS).doc(user.uid).get();
                if (!doc.exists) {
                    ghostUserIds.push(user.uid);
                }
            }

            results.push({
                module: "Auth",
                check: "Ghost Users (Auth exists, No Profile)",
                status: ghostUserIds.length > 0 ? "fail" : "pass",
                details: `Scanned recent 100 Auth users. Found ${ghostUserIds.length} ghosts.`,
                affectedIds: ghostUserIds
            });
        } catch (e: any) {
            results.push({ module: "Auth", check: "Ghost User Scan", status: "fail", details: e.message, affectedIds: [] });
        }

        // ============================================================================
        // 2. MARKETPLACE INTEGRITY
        // ============================================================================

        // CHECK: Orphaned Products (Seller does not exist)
        try {
            const productsSnapshot = await db.collection(COLLECTIONS.PRODUCTS).limit(200).get(); // Sample check
            const orphanedProductIds: string[] = [];

            for (const doc of productsSnapshot.docs) {
                const sellerId = doc.data().sellerId;
                if (sellerId) {
                    const sellerDoc = await db.collection(COLLECTIONS.USERS).doc(sellerId).get();
                    if (!sellerDoc.exists || sellerDoc.data()?.deleted) {
                        orphanedProductIds.push(doc.id);
                    }
                }
            }

            results.push({
                module: "Marketplace",
                check: "Orphaned Products (Deleted Seller)",
                status: orphanedProductIds.length > 0 ? "fail" : "pass",
                details: `Scanned ${productsSnapshot.size} products. Found ${orphanedProductIds.length} orphans.`,
                affectedIds: orphanedProductIds
            });
        } catch (e: any) {
            results.push({ module: "Marketplace", check: "Orphaned Product Scan", status: "fail", details: e.message, affectedIds: [] });
        }

        // CHECK: Contact Drift (Profile Phone vs Verified Phone)
        try {
            const verifiedSellersSnapshot = await db.collection(COLLECTIONS.SELLER_VERIFICATIONS)
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

        } catch (e: any) {
            results.push({ module: "Marketplace", check: "Contact Drift Scan", status: "fail", details: e.message, affectedIds: [] });
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

            for (const doc of waveParticipantsQuery.docs) {
                const data = doc.data();
                const gender = data.gender;
                const dob = data.dateOfBirth; // String YYYY-MM-DD

                // Gender Check
                if (gender !== "female") {
                    ineligibleIds.push(`${doc.id} (Gender: ${gender})`);
                    continue;
                }

                // Age Check
                if (dob) {
                    const birthDate = new Date(dob);
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
            }

            results.push({
                module: "WAVE",
                check: "Eligibility Paradox (Gender/Age)",
                status: ineligibleIds.length > 0 ? "fail" : "pass",
                details: `Scanned ${waveParticipantsQuery.size} participants. Found ${ineligibleIds.length} ineligible.`,
                affectedIds: ineligibleIds
            });
        } catch (e: any) {
            results.push({ module: "WAVE", check: "Eligibility Scan", status: "fail", details: e.message, affectedIds: [] });
        }

        // ============================================================================
        // 4. COOPERATIVE INTEGRITY
        // ============================================================================

        // CHECK: Financial Reconciliation (Transactions vs Balance)
        // Note: This is expensive. We'll sample 20 members.
        try {
            const coopMembersQuery = await db.collection(COLLECTIONS.USERS)
                .where("roles", "array-contains", "cooperative_member")
                .limit(20)
                .get();

            const balanceMismatches: string[] = [];

            for (const doc of coopMembersQuery.docs) {
                const userId = doc.id;
                const profileBalance = doc.data().cooperativeProfile?.savingsBalance || 0;

                // Sum Sync Transactions
                const transactionsSnapshot = await db.collection(COLLECTIONS.COOPERATIVE_TRANSACTIONS)
                    .where("userId", "==", userId)
                    .where("status", "==", "completed") // Only completed transactions count
                    .get();

                let calculatedBalance = 0;
                transactionsSnapshot.docs.forEach(tx => {
                    const type = tx.data().type;
                    const amount = tx.data().amount || 0;
                    if (type === "deposit" || type === "contribution" || type === "loan_repayment_excess") {
                        calculatedBalance += amount;
                    } else if (type === "withdrawal") {
                        calculatedBalance -= amount;
                    }
                });

                // Tolerance for floating point math (kobo)
                if (Math.abs(calculatedBalance - profileBalance) > 1.0) {
                    balanceMismatches.push(`${userId} (Profile: ${profileBalance}, Calc: ${calculatedBalance})`);
                }
            }

            results.push({
                module: "Cooperative",
                check: "Financial Reconciliation (Balance vs Txs)",
                status: balanceMismatches.length > 0 ? "fail" : "pass",
                details: `Scanned 20 random members. Found ${balanceMismatches.length} balance mismatches.`,
                affectedIds: balanceMismatches
            });
        } catch (e: any) {
            results.push({ module: "Cooperative", check: "Financial Scan", status: "fail", details: e.message, affectedIds: [] });
        }

        // ============================================================================
        // 5. FARM NATION INTEGRITY
        // ============================================================================

        // CHECK: Verification Fraud (Badge without Document)
        try {
            const verifiedFarmersQuery = await db.collection(COLLECTIONS.USERS)
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
        } catch (e: any) {
            results.push({ module: "Farm Nation", check: "Verification Scan", status: "fail", details: e.message, affectedIds: [] });
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
        } catch (e: any) {
            results.push({ module: "Export", check: "Cap Scan", status: "fail", details: e.message, affectedIds: [] });
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
        } catch (e: any) {
            results.push({ module: "Academy", check: "Enrollment Scan", status: "fail", details: e.message, affectedIds: [] });
        }

        return { error: null, success: true as const, results };

    } catch (error: any) {
        logger.error("Forensic scan failed:", error);
        return { success: false as const, results: [], error: error.message };
    }
}
