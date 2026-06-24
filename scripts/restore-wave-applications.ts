import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

import { db } from "../src/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { hashData } from "../src/lib/security";

const DRY_RUN = !process.argv.includes("--execute");

async function main() {
    console.log("=========================================");
    console.log("WAVE APPLICATIONS DATABASE RESTORATION");
    console.log(DRY_RUN ? "🔍 DRY RUN MODE (Safe Preview)" : "🔴 LIVE EXECUTION MODE (Writing to Database)");
    console.log("=========================================");

    const csvPath = path.resolve(__dirname, "../../wave_registration_export.csv");
    if (!fs.existsSync(csvPath)) {
        console.error("CSV not found at:", csvPath);
        process.exit(1);
    }

    // 1. Read and parse CSV
    const content = fs.readFileSync(csvPath, "utf8");
    const lines = content.split("\n");
    console.log(`Total lines in CSV: ${lines.length}`);

    const csvApps: { fullName: string; email: string; phone: string; state: string; lga: string }[] = [];
    const seenEmails = new Set<string>();

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        const parts = line.split(",").map(p => p.replace(/"/g, "").trim());
        if (parts.length >= 6) {
            const fullName = parts[0];
            const email = parts[1].toLowerCase().trim();
            const phone = parts[2];
            const state = parts[3];
            const lga = parts[4];
            const source = parts[5];
            
            if (source === "WAVE Application" && email) {
                if (seenEmails.has(email)) continue;
                seenEmails.add(email);
                csvApps.push({ fullName, email, phone, state, lga });
            }
        }
    }

    console.log(`Unique WAVE Application records in CSV: ${csvApps.length}`);

    // 2. Fetch existing wave_applications documents
    console.log("Fetching existing wave_applications to avoid duplicate writes...");
    const appsSnap = await db.collection("wave_applications").select("userId", "email", "userEmail").get();
    const existingAppEmails = new Set<string>();
    const existingAppUserIds = new Set<string>();
    
    appsSnap.forEach(doc => {
        const data = doc.data();
        const email = (data.userEmail || data.email || "").toLowerCase().trim();
        if (email) existingAppEmails.add(email);
        if (data.userId) existingAppUserIds.add(data.userId);
    });
    console.log(`Existing wave_applications: ${appsSnap.size}`);

    // 3. Load user records from Firestore
    console.log("Loading user profiles from Firestore for in-memory matching...");
    const userEmailsToDocs = new Map<string, { id: string; data: any }>();
    let lastDoc = null;
    let hasMore = true;
    let totalUsersScanned = 0;
    const PAGE_LIMIT = 5000;

    while (hasMore) {
        let q = db.collection("users").select(
            "email", "firstName", "lastName", "fullName", "phone", "phoneNumber", 
            "gender", "address", "bankDetails", "nin", "bvn", "createdAt", "serviceRegistrations"
        ).limit(PAGE_LIMIT);
        
        if (lastDoc) {
            q = q.startAfter(lastDoc);
        }
        
        const snap = await q.get();
        if (snap.empty) {
            hasMore = false;
            break;
        }

        snap.docs.forEach(doc => {
            const data = doc.data();
            const email = (data.email || "").toLowerCase().trim();
            if (email) {
                userEmailsToDocs.set(email, { id: doc.id, data });
            }
        });

        totalUsersScanned += snap.size;
        lastDoc = snap.docs[snap.docs.length - 1];
        
        if (snap.size < PAGE_LIMIT) {
            hasMore = false;
        }
    }
    
    console.log(`Loaded ${userEmailsToDocs.size} unique user emails from Firestore (Scanned ${totalUsersScanned} docs).`);

    // 4. Identify missing applications
    const toRestore: any[] = [];
    for (const app of csvApps) {
        const user = userEmailsToDocs.get(app.email);
        if (user) {
            const hasApp = existingAppEmails.has(app.email) || existingAppUserIds.has(user.id);
            if (!hasApp) {
                toRestore.push({ app, user });
            }
        }
    }

    console.log(`Total missing applications to restore: ${toRestore.length}`);

    if (toRestore.length === 0) {
        console.log("No applications need to be restored. Exiting.");
        return;
    }

    if (DRY_RUN) {
        console.log("\n🔍 DRY RUN PREVIEW (Showing first 3 restores):");
        for (const item of toRestore.slice(0, 3)) {
            const uData = item.user.data;
            const names = (uData.fullName || item.app.fullName || "").trim().split(" ");
            const firstName = uData.firstName || names[0] || "";
            const surname = uData.lastName || names[names.length - 1] || "";
            const fullName = uData.fullName || item.app.fullName || `${firstName} ${surname}`.trim();
            
            console.log(`- Restore Application for User ${item.user.id} (${item.app.email}):`);
            console.log(`  Name: ${fullName}`);
            console.log(`  Phone: ${uData.phone || uData.phoneNumber || item.app.phone}`);
            console.log(`  State/LGA: ${uData.address?.state || item.app.state} / ${uData.address?.lga || item.app.lga}`);
            console.log(`  Bank: ${uData.bankDetails?.bankName || "none"} | Account: ${uData.bankDetails?.accountNumber || "none"}`);
            console.log(`  NIN/BVN in Profile: ${uData.nin ? "YES" : "NO"} / ${uData.bvn ? "YES" : "NO"}`);
        }
        console.log(`\n⏭️ Re-run script with --execute to perform the actual write operations.`);
        return;
    }

    // 5. Perform batched writes (limit 500 writes per batch)
    console.log("\n🔴 Commencing restoration writes in batches of 250 (500 operations per batch max)...");
    let batch = db.batch();
    let count = 0;
    let totalCommitted = 0;

    for (const item of toRestore) {
        const uData = item.user.data;
        const appInfo = item.app;
        const userId = item.user.id;
        const userEmail = appInfo.email;
        
        // Resolve application ID
        let applicationId = uData.serviceRegistrations?.wave?.applicationId;
        if (!applicationId) {
            applicationId = `WAVE-${Date.now()}-${Math.random().toString(36).substring(2, 11).toUpperCase()}`;
        }

        // Parse names canonically
        const names = (uData.fullName || appInfo.fullName || "").trim().split(/\s+/);
        const firstName = uData.firstName || names[0] || "";
        const surname = uData.lastName || names[names.length - 1] || "";
        const otherNames = uData.otherName || names.slice(1, -1).join(" ") || "";
        const fullName = uData.fullName || appInfo.fullName || [firstName, otherNames, surname].filter(Boolean).join(" ");

        // Determine age
        let age = 30; // fallback default
        let dobStr = uData.dateOfBirth || "";
        if (dobStr) {
            const dob = new Date(dobStr);
            if (!isNaN(dob.getTime())) {
                const today = new Date();
                age = today.getFullYear() - dob.getFullYear();
                const m = today.getMonth() - dob.getMonth();
                if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) {
                    age--;
                }
            }
        }

        // Construct wave application doc
        const appRef = db.collection("wave_applications").doc(applicationId);
        
        const newAppDoc: any = {
            userId: userId,
            email: userEmail,
            userEmail: userEmail,
            firstName,
            surname,
            otherNames,
            fullName,
            phone: uData.phone || uData.phoneNumber || appInfo.phone || "",
            alternativePhone: "",
            residentialAddress: uData.address?.street || uData.residentialAddress || "",
            stateOfResidence: uData.address?.state || appInfo.state || "",
            lgaOfResidence: uData.address?.lga || appInfo.lga || "",
            stateOfOrigin: uData.stateOfOrigin || uData.address?.state || appInfo.state || "",
            lgaOfOrigin: uData.lgaOfOrigin || uData.address?.lga || appInfo.lga || "",
            dateOfBirth: dobStr,
            age,
            maritalStatus: uData.maritalStatus || "",
            highestEducation: uData.highestEducation || "",
            currentOccupation: uData.currentOccupation || "Entrepreneur",
            averageMonthlyIncome: uData.averageMonthlyIncome || "",
            involvedInAgriculture: true,
            agricultureTypes: ["farming"],
            valueChainAreas: ["crop_production"],
            preferredCommodities: ["other"],
            preferredCommodityOther: "Various",
            hasAccessToFarmland: false,
            needsFarmlandAccess: true,
            hasBankAccount: !!uData.bankDetails?.accountNumber,
            bankName: uData.bankDetails?.bankName || "",
            accountNumber: uData.bankDetails?.accountNumber || "",
            bankAccountName: uData.bankDetails?.accountName || fullName,
            bankCode: uData.bankDetails?.bankCode || "",
            isMemberOfCooperative: uData.roles?.includes("cooperative_member") || false,
            willingToJoinCooperative: true,
            supportNeeded: ["finance", "market_access"],
            willingToUndergoTraining: true,
            willingToComplyWithStandards: true,
            willingToParticipateInME: true,
            declarationAccepted: true,
            consentGiven: true,
            status: uData.serviceRegistrations?.wave?.status || "pending",
            
            // Reconstruct timestamps from user's creation time
            createdAt: uData.createdAt || FieldValue.serverTimestamp(),
            applicationDate: uData.createdAt || FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            
            _system_restored_from_csv: true
        };

        // Hashed fields
        if (uData.nin) newAppDoc.nin = hashData(uData.nin);
        if (uData.bvn) newAppDoc.bvn = hashData(uData.bvn);

        // Queue application document creation
        batch.set(appRef, newAppDoc);

        // Queue user document update to link application
        const userRef = db.collection("users").doc(userId);
        batch.update(userRef, {
            "serviceRegistrations.wave.applicationId": applicationId,
            "serviceRegistrations.wave.submittedAt": uData.createdAt || FieldValue.serverTimestamp(),
            "serviceRegistrations.wave.updatedAt": FieldValue.serverTimestamp()
        });

        count += 2; // 2 writes per item (1 set, 1 update)

        if (count >= 500) {
            await batch.commit();
            totalCommitted += (count / 2);
            console.log(`✔️ Successfully restored batch of ${count / 2} applications (Total: ${totalCommitted}).`);
            batch = db.batch();
            count = 0;
        }
    }

    if (count > 0) {
        await batch.commit();
        totalCommitted += (count / 2);
        console.log(`✔️ Successfully restored final batch of ${count / 2} applications (Total: ${totalCommitted}).`);
    }

    console.log(`\n🎉 RESTORATION COMPLETED! Total restored applications: ${totalCommitted}`);
}

main().then(() => process.exit(0)).catch(err => {
    console.error("Restoration failed:", err);
    process.exit(1);
});
