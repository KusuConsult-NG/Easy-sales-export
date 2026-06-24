import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

import { db } from "../src/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

const DRY_RUN = !process.argv.includes("--execute");

async function main() {
    console.log("=========================================");
    console.log("WAVE APPLICATIONS BULK APPROVAL SYSTEM");
    console.log(DRY_RUN ? "🔍 DRY RUN MODE (Safe Preview)" : "🔴 LIVE EXECUTION MODE (Writing to Database)");
    console.log("=========================================");

    // 1. Fetch all pending wave applications
    console.log("Fetching pending wave applications from Firestore...");
    let pendingApps: any[] = [];
    let hasMoreApps = true;
    let lastAppDoc = null;
    const PAGE_LIMIT = 5000;

    while (hasMoreApps) {
        let q = db.collection("wave_applications")
            .where("status", "==", "pending")
            .limit(PAGE_LIMIT);
            
        if (lastAppDoc) {
            q = q.startAfter(lastAppDoc);
        }

        const snap = await q.get();
        if (snap.empty) {
            hasMoreApps = false;
            break;
        }

        snap.docs.forEach(doc => {
            pendingApps.push({ id: doc.id, data: doc.data(), ref: doc.ref });
        });

        lastAppDoc = snap.docs[snap.docs.length - 1];
        console.log(`  Fetched ${pendingApps.length} pending applications so far...`);
        
        if (snap.size < PAGE_LIMIT) {
            hasMoreApps = false;
        }
    }

    console.log(`Total pending applications found: ${pendingApps.length}`);

    if (pendingApps.length === 0) {
        console.log("No pending applications found to approve. Exiting.");
        return;
    }

    // 2. Load all users from Firestore to match in-memory (highly efficient)
    console.log("Loading user profiles from Firestore for in-memory matching...");
    const userEmailsToDocs = new Map<string, { id: string; data: any; ref: any }>();
    const userIdsToDocs = new Map<string, { id: string; data: any; ref: any }>();
    
    let lastDoc = null;
    let hasMoreUsers = true;
    let totalUsersScanned = 0;

    while (hasMoreUsers) {
        let q = db.collection("users").select(
            "email", "firstName", "lastName", "fullName", "phone", "phoneNumber", 
            "roles", "serviceRegistrations"
        ).limit(PAGE_LIMIT);
        
        if (lastDoc) {
            q = q.startAfter(lastDoc);
        }
        
        const snap = await q.get();
        if (snap.empty) {
            hasMoreUsers = false;
            break;
        }

        snap.docs.forEach(doc => {
            const data = doc.data();
            const email = (data.email || "").toLowerCase().trim();
            const record = { id: doc.id, data, ref: doc.ref };
            
            if (email) {
                userEmailsToDocs.set(email, record);
            }
            userIdsToDocs.set(doc.id, record);
        });

        totalUsersScanned += snap.size;
        lastDoc = snap.docs[snap.docs.length - 1];
        
        if (snap.size < PAGE_LIMIT) {
            hasMoreUsers = false;
        }
    }
    
    console.log(`Loaded ${userIdsToDocs.size} unique users from Firestore.`);

    // 3. Match pending applications with users
    const matchedUsers: any[] = [];
    const unmatchedApps: any[] = [];

    for (const app of pendingApps) {
        const appData = app.data;
        // Search by userId first, then email
        let user = appData.userId ? userIdsToDocs.get(appData.userId) : null;
        if (!user && appData.email) {
            user = userEmailsToDocs.get(appData.email.toLowerCase().trim());
        }
        if (!user && appData.userEmail) {
            user = userEmailsToDocs.get(appData.userEmail.toLowerCase().trim());
        }

        if (user) {
            matchedUsers.push({ app, user });
        } else {
            unmatchedApps.push(app);
        }
    }

    console.log(`Matching Summary:`);
    console.log(`  - Matched applications: ${matchedUsers.length}`);
    console.log(`  - Unmatched applications (no user doc): ${unmatchedApps.length}`);

    if (matchedUsers.length === 0) {
        console.log("No pending applications could be matched to active users. Exiting.");
        return;
    }

    if (DRY_RUN) {
        console.log("\n🔍 DRY RUN PREVIEW (Showing first 3 approvals):");
        for (const item of matchedUsers.slice(0, 3)) {
            const uData = item.user.data;
            const appData = item.app.data;
            const names = (uData.fullName || appData.fullName || "").trim().split(/\s+/);
            const firstName = uData.firstName || names[0] || "";
            const surname = uData.lastName || names[names.length - 1] || "";
            const fullName = uData.fullName || appData.fullName || `${firstName} ${surname}`.trim();

            console.log(`- Will approve WAVE Application ${item.app.id} for User ${item.user.id}:`);
            console.log(`  Name: ${fullName}`);
            console.log(`  Email: ${uData.email || appData.email}`);
            console.log(`  Current User Status: ${uData.serviceRegistrations?.wave?.status || "none"}`);
            console.log(`  Current Roles: ${JSON.stringify(uData.roles || [])}`);
        }
        console.log(`\n⏭️ Re-run script with --execute to perform the actual bulk approval.`);
        return;
    }

    // 4. Perform approvals in batches
    // We do 3 writes per user (update user, update application, set member).
    // Max writes per batch = 500. So we process 150 users per batch (450 writes).
    console.log("\n🔴 Commencing bulk approvals in batches of 150 (450 operations per batch)...");
    let batch = db.batch();
    let count = 0;
    let totalApproved = 0;

    for (const item of matchedUsers) {
        const uData = item.user.data;
        const appData = item.app.data;
        const userId = item.user.id;
        const email = uData.email || appData.email || "";
        
        const names = (uData.fullName || appData.fullName || "").trim().split(/\s+/);
        const firstName = uData.firstName || names[0] || "";
        const surname = uData.lastName || names[names.length - 1] || "";
        const fullName = uData.fullName || appData.fullName || `${firstName} ${surname}`.trim();

        const appDocId = item.app.id;

        // 1. Update user document
        const userRef = db.collection("users").doc(userId);
        const userRoles = uData.roles || [];
        const userUpdate: any = {
            "serviceRegistrations.wave.status": "approved",
            "serviceRegistrations.wave.paymentStatus": "completed",
            "serviceRegistrations.wave.applicationId": appDocId,
            "serviceRegistrations.wave.approvedAt": FieldValue.serverTimestamp(),
            "serviceRegistrations.wave.updatedAt": FieldValue.serverTimestamp()
        };
        
        if (!userRoles.includes("wave_participant")) {
            userUpdate.roles = FieldValue.arrayUnion("wave_participant");
        }
        batch.update(userRef, userUpdate);

        // 2. Update wave application document
        const appRef = db.collection("wave_applications").doc(appDocId);
        batch.update(appRef, {
            status: "approved",
            reviewedAt: FieldValue.serverTimestamp(),
            reviewedBy: "system_bulk_approve",
            approvedBy: "system_bulk_approve",
            approvalTimestamp: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp()
        });

        // 3. Create or update wave_members document
        const memberRef = db.collection("wave_members").doc(userId);
        batch.set(memberRef, {
            userId: userId,
            email: email,
            name: fullName,
            active: true,
            status: "approved",
            enrolledAt: FieldValue.serverTimestamp(),
            applicationId: appDocId,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            _system_approved: true
        });

        count += 3; // 3 operations per user

        if (count >= 450) {
            await batch.commit();
            totalApproved += (count / 3);
            console.log(`✔️ Successfully approved batch of ${count / 3} users (Total approved: ${totalApproved}).`);
            batch = db.batch();
            count = 0;
        }
    }

    if (count > 0) {
        await batch.commit();
        totalApproved += (count / 3);
        console.log(`✔️ Successfully approved final batch of ${count / 3} users (Total approved: ${totalApproved}).`);
    }

    console.log(`\n🎉 BULK APPROVAL COMPLETE! Total approved applications: ${totalApproved}`);
}

main().then(() => process.exit(0)).catch(err => {
    console.error("Bulk approval failed:", err);
    process.exit(1);
});
