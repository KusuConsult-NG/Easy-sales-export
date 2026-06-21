import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

import { db } from "../src/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
    console.log("=========================================");
    console.log("HEALING WAVE MEMBERS AND APPLICATIONS (OPTIMIZED)");
    console.log(DRY_RUN ? "🔍 DRY RUN MODE" : "🔧 LIVE MODE - WRITING TO DB");
    console.log("=========================================");

    const usersMap = new Map<string, any>();

    // 1. Query users with wave_participant role
    console.log("Querying users with 'wave_participant' role...");
    const roleSnap = await db.collection("users").where("roles", "array-contains", "wave_participant").get();
    roleSnap.docs.forEach(doc => usersMap.set(doc.id, doc));
    console.log(`Found ${roleSnap.size} users with role.`);

    // 2. Query users with approved wave status in service registrations
    console.log("Querying users with serviceRegistrations.wave.status == 'approved'...");
    const statusSnap = await db.collection("users").where("serviceRegistrations.wave.status", "==", "approved").get();
    statusSnap.docs.forEach(doc => usersMap.set(doc.id, doc));
    console.log(`Found ${statusSnap.size} users with status approved.`);

    console.log(`Total unique WAVE participants to process: ${usersMap.size}`);

    let healedCount = 0;

    for (const [userId, userDoc] of usersMap.entries()) {
        const uData = userDoc.data();
        const roles = uData.roles || [];
        const waveReg = uData.serviceRegistrations?.wave;

        console.log(`\nProcessing WAVE Participant: ${userId} (${uData.email || "no email"})`);

        // 1. Ensure serviceRegistrations.wave status and applicationId
        let appStatus = waveReg?.status || "approved";
        if (appStatus === "active") appStatus = "approved"; // normalize status
        
        let appDocId = waveReg?.applicationId;
        if (!appDocId) {
            appDocId = `legacy_${userId}`;
            console.log(`  - No applicationId in user profile. Generated: ${appDocId}`);
        }

        // 2. Check wave_applications
        const appRef = db.collection("wave_applications").doc(appDocId);
        const appDoc = await appRef.get();
        let appNeedsCreation = false;
        let appNeedsUpdate = false;

        const names = (uData.fullName || "").split(" ");
        const firstName = uData.firstName || names[0] || "";
        const surname = uData.lastName || names[names.length - 1] || "";
        const fullName = uData.fullName || `${firstName} ${surname}`.trim() || "WAVE Participant";

        const appDataToSet: any = {
            userId: userId,
            email: uData.email || "",
            phone: uData.phone || uData.phoneNumber || "",
            firstName,
            surname,
            fullName,
            status: "approved",
            updatedAt: FieldValue.serverTimestamp(),
        };

        // Sync bank details if available in user doc
        if (uData.bankDetails) {
            appDataToSet.bankName = uData.bankDetails.bankName || "";
            appDataToSet.accountNumber = uData.bankDetails.accountNumber || "";
            appDataToSet.bankCode = uData.bankDetails.bankCode || "";
            appDataToSet.bankAccountName = uData.bankDetails.accountName || fullName;
        }

        // Sync NIN/BVN
        if (uData.nin || uData.kyc?.nin) appDataToSet.nin = uData.nin || uData.kyc?.nin || "";
        if (uData.bvn || uData.kyc?.bvn) appDataToSet.bvn = uData.bvn || uData.kyc?.bvn || "";

        if (!appDoc.exists) {
            console.log(`  - wave_applications doc ${appDocId} DOES NOT EXIST. Will create.`);
            appNeedsCreation = true;
            appDataToSet.createdAt = waveReg?.approvedAt || waveReg?.enrolledAt || FieldValue.serverTimestamp();
            appDataToSet.approvalTimestamp = waveReg?.approvedAt || waveReg?.enrolledAt || FieldValue.serverTimestamp();
            appDataToSet.reviewedAt = waveReg?.approvedAt || waveReg?.enrolledAt || FieldValue.serverTimestamp();
            appDataToSet.approvedBy = waveReg?.enrolledBy || "system_heal";
            appDataToSet.reviewedBy = waveReg?.enrolledBy || "system_heal";
        } else {
            const currentAppStatus = appDoc.data()?.status;
            if (currentAppStatus !== "approved") {
                console.log(`  - wave_applications doc status is '${currentAppStatus}'. Will update to 'approved'.`);
                appNeedsUpdate = true;
            }
        }

        // 3. Check wave_members doc
        const memberRef = db.collection("wave_members").doc(userId);
        const memberDoc = await memberRef.get();
        let memberNeedsCreation = false;
        let memberNeedsUpdate = false;

        if (!memberDoc.exists) {
            console.log(`  - wave_members doc ${userId} DOES NOT EXIST. Will create.`);
            memberNeedsCreation = true;
        } else {
            const memberData = memberDoc.data();
            if (!memberData?.active || memberData?.status !== "approved" || memberData?.applicationId !== appDocId) {
                console.log(`  - wave_members doc exists but needs updates: active=${memberData?.active}, status=${memberData?.status}, applicationId=${memberData?.applicationId}`);
                memberNeedsUpdate = true;
            }
        }

        // 4. Perform updates
        if (!DRY_RUN) {
            const batch = db.batch();

            // Update user registrations if missing/different
            const userUpdate: any = {};
            let userNeedsUpdate = false;
            
            if (!roles.includes("wave_participant")) {
                userUpdate.roles = FieldValue.arrayUnion("wave_participant");
                userNeedsUpdate = true;
            }
            if (waveReg?.status !== "approved" || waveReg?.applicationId !== appDocId) {
                userUpdate["serviceRegistrations.wave.status"] = "approved";
                userUpdate["serviceRegistrations.wave.applicationId"] = appDocId;
                userUpdate["serviceRegistrations.wave.paymentStatus"] = "completed";
                userNeedsUpdate = true;
            }

            if (userNeedsUpdate) {
                console.log(`  [Batch] Updating user profile.`);
                batch.update(userDoc.ref, userUpdate);
            }

            if (appNeedsCreation) {
                console.log(`  [Batch] Creating wave_applications document ${appDocId}.`);
                batch.set(appRef, appDataToSet);
            } else if (appNeedsUpdate) {
                console.log(`  [Batch] Updating wave_applications document ${appDocId} status to approved.`);
                batch.update(appRef, { status: "approved", updatedAt: FieldValue.serverTimestamp() });
            }

            if (memberNeedsCreation) {
                console.log(`  [Batch] Creating wave_members document ${userId}.`);
                batch.set(memberRef, {
                    userId: userId,
                    email: uData.email || "",
                    name: fullName,
                    active: true,
                    status: "approved",
                    enrolledAt: waveReg?.approvedAt || waveReg?.enrolledAt || FieldValue.serverTimestamp(),
                    applicationId: appDocId,
                    createdAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp()
                });
            } else if (memberNeedsUpdate) {
                console.log(`  [Batch] Updating wave_members document ${userId}.`);
                batch.update(memberRef, {
                    active: true,
                    status: "approved",
                    applicationId: appDocId,
                    updatedAt: FieldValue.serverTimestamp()
                });
            }

            await batch.commit();
            console.log("  ✓ Committed updates for user.");
        } else {
            if (appNeedsCreation || appNeedsUpdate || memberNeedsCreation || memberNeedsUpdate) {
                console.log(`  [DRY] Would write updates for user.`);
            } else {
                console.log(`  - No changes needed.`);
            }
        }
        healedCount++;
    }

    console.log(`\nProcessed ${healedCount} WAVE participants.`);
}

main().then(() => process.exit(0)).catch(err => {
    console.error(err);
    process.exit(1);
});
