import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { db } from "../src/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import * as fs from "fs";
import * as path from "path";

async function main() {
    console.log("="?.repeat(60));
    console.log("APPROVING 5K ERROR PAYMENTS & FLAGGING LEGACY MEMBERS");
    console.log("="?.repeat(60));

    // 1. Read CSV to map legacy user IDs
    const csvPath = path.join(process.cwd(), "cooperative_member_reconciliation.csv");
    if (!fs.existsSync(csvPath)) {
        console.error("❌ CSV file not found at:", csvPath);
        process.exit(1);
    }
    const csvContent = fs.readFileSync(csvPath, "utf8");
    const csvLines = csvContent.split("\n");
    const legacyUserIds = new Set<string>();
    for (let i = 1; i < csvLines.length; i++) {
        const line = csvLines[i].trim();
        if (!line) continue;
        const parts = line.split(",").map(p => p.replace(/"/g, "").trim());
        if (parts.length >= 1) {
            legacyUserIds.add(parts[0]);
        }
    }
    console.log(`Loaded ${legacyUserIds.size} legacy user IDs from reconciliation CSV.`);

    // 2. Fetch all legacy-onboarded users from users collection
    console.log("\nSearching for legacy-onboarded users in users collection...");
    const legacyUsersSnap = await db.collection("users")
        .where("legacyOnboardedBy", ">", "")
        .get();
    const legacyOnboardedUserIds = new Set<string>();
    legacyUsersSnap.docs.forEach(doc => {
        legacyOnboardedUserIds.add(doc.id);
    });
    console.log(`Found ${legacyOnboardedUserIds.size} legacy onboarded users in users collection.`);

    // 3. Fetch payments of 5000 (5,000 Naira or 500,000 kobo)
    console.log("\nSearching for 5,000 Naira payments in processedPayments...");
    const paymentsSnap = await db.collection("processedPayments")
        .where("status", "==", "completed")
        .where("type", "==", "cooperative_membership_registration")
        .get();
    
    const usersWith5k = new Set<string>();
    paymentsSnap.docs.forEach(doc => {
        const d = doc.data();
        const amt = d.amount || 0;
        // Paystack stores in kobo/cents sometimes, so 500000 = 5000. Or 5000 directly.
        if (amt === 5000 || amt === 500000) {
            if (d.userId) usersWith5k.add(d.userId);
        }
    });
    console.log(`Found ${usersWith5k.size} users with verified 5,000 Naira payments in processedPayments.`);

    // 4. Fetch all cooperative_members in a paginated way
    console.log("\nFetching cooperative_members paginated...");
    
    let approved5kCount = 0;
    let flaggedLegacyCount = 0;
    let totalChecked = 0;

    let batch = db.batch();
    let batchWrites = 0;

    const commitBatchIfNeeded = async () => {
        if (batchWrites >= 400) {
            await batch.commit();
            console.log(`  [Batch] Committed ${batchWrites} updates to Firestore.`);
            batch = db.batch();
            batchWrites = 0;
        }
    };

    let lastDoc = null;
    let hasMore = true;
    const limit = 500;

    while (hasMore) {
        let query = db.collection("cooperative_members").limit(limit);
        if (lastDoc) {
            query = query.startAfter(lastDoc);
        }
        const snap = await query.get();
        if (snap.empty) {
            hasMore = false;
            break;
        }
        
        console.log(`Processing batch of ${snap.size} members (Total checked so far: ${totalChecked})...`);
        for (const doc of snap.docs) {
            totalChecked++;
            const data = doc.data();
            const userId = data.userId || doc.id;
            
            let shouldApprove = false;
            
            // Check if they paid 5k in document metadata
            const fee = data.registrationFee || 0;
            const amt = data.amountPaid || 0;
            if (fee === 5000 || amt === 5000 || usersWith5k.has(userId)) {
                shouldApprove = true;
            }

            const isLegacy = legacyUserIds.has(userId) || 
                             data._importSource === "legacy_csv_import" || 
                             data._created_by_reconcile === true ||
                             legacyOnboardedUserIds.has(userId);

            const updates: any = {};
            let needsUpdate = false;

            // Apply Approval for 5k users
            if (shouldApprove && data.membershipStatus !== "active" && data.membershipStatus !== "approved") {
                console.log(`  Approving 5k user: ${userId} (${data.email || ""})`);
                updates.membershipStatus = "active";
                updates.status = "active";
                updates.registrationFee = 10000; // Enforce standard flat fee display
                updates.approvedBy = "SYSTEM_RECONCILE_5K";
                updates.approvedAt = new Date();
                needsUpdate = true;
                approved5kCount++;

                // Also update corresponding user document
                const userRef = db.collection("users").doc(userId);
                const userDoc = await userRef.get();
                if (userDoc.exists) {
                    batch.update(userRef, {
                        roles: FieldValue.arrayUnion("cooperative_member"),
                        "serviceRegistrations.cooperative.status": "active",
                        "serviceRegistrations.cooperatives.status": "active",
                        "serviceRegistrations.cooperative.updatedAt": new Date(),
                        "serviceRegistrations.cooperatives.updatedAt": new Date(),
                        updatedAt: new Date()
                    });
                    batchWrites++;
                    await commitBatchIfNeeded();
                }
            }

            // Apply Legacy flag
            if (isLegacy && data.isLegacy !== true) {
                updates.isLegacy = true;
                needsUpdate = true;
                flaggedLegacyCount++;
            }

            if (needsUpdate) {
                updates.updatedAt = new Date();
                batch.update(doc.ref, updates);
                batchWrites++;
                await commitBatchIfNeeded();
            }
        }

        lastDoc = snap.docs[snap.docs.length - 1];
    }

    if (batchWrites > 0) {
        await batch.commit();
        console.log(`  [Batch] Committed final ${batchWrites} updates.`);
    }

    console.log("\n" + "="?.repeat(60));
    console.log("RECONCILIATION SUMMARY");
    console.log(`- Total cooperative members processed: ${totalChecked}`);
    console.log(`- 5k members approved: ${approved5kCount}`);
    console.log(`- Legacy members flagged: ${flaggedLegacyCount}`);
    console.log("="?.repeat(60));
}

main().catch(console.error).finally(() => process.exit(0));
