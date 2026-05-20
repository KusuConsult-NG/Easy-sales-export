import { config } from "dotenv";
import * as path from "path";
config({ path: path.resolve(process.cwd(), ".env.local") });

import { db } from "../src/lib/firebase-admin";
import { COLLECTIONS } from "../src/lib/types/firestore";

async function backfillUserOnboarding() {
    console.log("🚀 Starting Optimized User Onboarding Details Backfill Script...");

    // 1. Fetch all cooperative members (only ~850 docs)
    console.log("📁 Fetching all cooperative members...");
    const coopSnap = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).get();
    console.log(`Loaded ${coopSnap.size} cooperative member documents.`);

    // 2. Fetch all seller verifications (only ~780 docs)
    console.log("📁 Fetching all seller verifications...");
    const sellerSnap = await db.collection(COLLECTIONS.SELLER_VERIFICATIONS).get();
    console.log(`Loaded ${sellerSnap.size} seller verification documents.`);

    // 3. Map userIds to their onboarding details
    const onboardingMap = new Map<string, { coopData: any; sellerData: any }>();

    for (const doc of coopSnap.docs) {
        const data = doc.data();
        const userId = data.userId || doc.id;
        if (!userId) continue;

        if (!onboardingMap.has(userId)) {
            onboardingMap.set(userId, { coopData: null, sellerData: null });
        }
        onboardingMap.get(userId)!.coopData = data;
    }

    // For sellers, find the latest verification document per user (by sorting or using the most recent)
    const sellerVerificationsByUser = new Map<string, any>();
    for (const doc of sellerSnap.docs) {
        const data = doc.data();
        const userId = data.userId;
        if (!userId) continue;

        const existing = sellerVerificationsByUser.get(userId);
        if (!existing || (data.createdAt && existing.createdAt && data.createdAt.seconds > existing.createdAt.seconds)) {
            sellerVerificationsByUser.set(userId, data);
        }
    }

    for (const [userId, sellerData] of sellerVerificationsByUser.entries()) {
        if (!onboardingMap.has(userId)) {
            onboardingMap.set(userId, { coopData: null, sellerData: null });
        }
        onboardingMap.get(userId)!.sellerData = sellerData;
    }

    const targetUserIds = Array.from(onboardingMap.keys());
    console.log(`🔍 Identified ${targetUserIds.length} unique users to inspect/backfill.`);

    // 4. Fetch the target user documents in batches of 30 to stay within Firestore limits
    console.log(`📁 Fetching users in batches of 30...`);
    const userMap = new Map<string, any>();
    for (let i = 0; i < targetUserIds.length; i += 30) {
        const chunk = targetUserIds.slice(i, i + 30);
        const usersSnap = await db.collection(COLLECTIONS.USERS)
            .where("__name__", "in", chunk)
            .get();
        
        usersSnap.forEach(doc => {
            userMap.set(doc.id, doc.data());
        });
        
        if (i % 300 === 0 || i + 30 >= targetUserIds.length) {
            console.log(`   - Progress: ${Math.min(i + chunk.length, targetUserIds.length)}/${targetUserIds.length} users fetched`);
        }
    }

    // 5. Compute updates and perform batched backfill
    let repairedCount = 0;
    let skipCount = 0;
    let batch = db.batch();
    let batchOperations = 0;

    for (const userId of targetUserIds) {
        const userData = userMap.get(userId);
        if (!userData) {
            // User doesn't exist in USERS collection (orphaned cooperative/seller record)
            skipCount++;
            continue;
        }

        const { coopData, sellerData } = onboardingMap.get(userId)!;
        const updates: any = {};

        // ---- BVN ----
        const currentBvn = userData.bvn;
        const bestBvn = coopData?.bvn || sellerData?.bvn || currentBvn;
        if (bestBvn && bestBvn !== currentBvn) {
            updates.bvn = bestBvn;
            updates.bvnVerified = true;
        }

        // ---- NIN ----
        const currentNin = userData.nin;
        const bestNin = sellerData?.nin || currentNin;
        if (bestNin && bestNin !== currentNin) {
            updates.nin = bestNin;
            updates.ninVerified = true;
        }

        // ---- Gender ----
        const currentGender = userData.gender;
        const bestGender = coopData?.gender || currentGender;
        if (bestGender && bestGender !== currentGender) {
            updates.gender = bestGender;
        }

        // ---- Next of Kin ----
        const currentNextOfKin = userData.nextOfKin;
        const bestNextOfKin = coopData?.nextOfKin || currentNextOfKin;
        if (bestNextOfKin && (!currentNextOfKin || !currentNextOfKin.name || !currentNextOfKin.phone)) {
            updates.nextOfKin = {
                name: bestNextOfKin.name || "",
                phone: bestNextOfKin.phone || "",
                relationship: bestNextOfKin.relationship || "",
                address: bestNextOfKin.address || ""
            };
        }

        // ---- Bank Details ----
        const currentBank = userData.bankDetails;
        const sellerBank = sellerData?.bankAccount || sellerData?.bankDetails;
        const coopBankNumber = coopData?.bankAccountNumber;
        const coopBankName = coopData?.bankName;

        let hasCurrentBank = currentBank && currentBank.accountNumber && currentBank.accountNumber !== "N/A";
        
        if (!hasCurrentBank) {
            if (sellerBank && sellerBank.accountNumber) {
                updates.bankDetails = {
                    accountNumber: sellerBank.accountNumber,
                    bankName: sellerBank.bankName || "",
                    accountName: sellerBank.accountName || userData.fullName || "",
                    bankCode: sellerBank.bankCode || ""
                };
            } else if (coopBankNumber) {
                updates.bankDetails = {
                    accountNumber: coopBankNumber,
                    bankName: coopBankName || "",
                    accountName: coopData?.fullName || userData.fullName || "",
                    bankCode: ""
                };
            }
        }

        // ---- Address details ----
        const currentAddress = userData.address;
        const sellerAddress = sellerData?.address;
        const coopAddress = coopData?.residentialAddress;

        let hasCurrentAddress = currentAddress && currentAddress.street && currentAddress.state;

        if (!hasCurrentAddress) {
            if (sellerAddress && sellerAddress.street) {
                updates.address = {
                    street: sellerAddress.street,
                    city: sellerAddress.city || "",
                    state: sellerAddress.state,
                    lga: sellerAddress.lga || "",
                    country: sellerAddress.country || "Nigeria"
                };
                updates.residentialAddress = sellerAddress.street;
                updates.stateOfOrigin = sellerAddress.state;
                updates.lga = sellerAddress.lga;
            } else if (coopAddress) {
                updates.address = {
                    street: coopAddress,
                    city: "",
                    state: coopData?.stateOfOrigin || coopData?.state || "",
                    lga: coopData?.lga || "",
                    country: "Nigeria"
                };
                updates.residentialAddress = coopAddress;
                updates.stateOfOrigin = coopData?.stateOfOrigin || coopData?.state;
                updates.lga = coopData?.lga;
            }
        }

        // Queue the update if there are fields to repair
        if (Object.keys(updates).length > 0) {
            const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
            batch.set(userRef, {
                ...updates,
                updatedAt: new Date()
            }, { merge: true });

            repairedCount++;
            batchOperations++;

            console.log(`[REPAIR] User ${userId} (${userData.email || "N/A"}): mapped [${Object.keys(updates).join(", ")}]`);

            if (batchOperations >= 400) {
                await batch.commit();
                batch = db.batch();
                batchOperations = 0;
                console.log(`Committed batch: ${repairedCount} users repaired so far...`);
            }
        } else {
            skipCount++;
        }
    }

    if (batchOperations > 0) {
        await batch.commit();
        console.log(`Committed final batch.`);
    }

    console.log("------------------------------------------------------------------");
    console.log("🎉 Optimized User Onboarding Details Backfill Complete!");
    console.log(`Total Checked: ${targetUserIds.length}`);
    console.log(`Total Repaired: ${repairedCount}`);
    console.log(`Total Skipped / Already Complete: ${skipCount}`);
    console.log("------------------------------------------------------------------");
}

backfillUserOnboarding().catch((err) => {
    console.error("Fatal error executing onboarding backfill:", err);
});
