import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

import { db } from "../src/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { invalidateUserCache } from "../src/lib/cache-invalidation";

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
    console.log("=========================================");
    console.log("REVERTING UNPAID COOPERATIVE MEMBERS (OPTIMIZED)");
    console.log(DRY_RUN ? "🔍 DRY RUN MODE" : "🔧 LIVE MODE - WRITING TO DB");
    console.log("=========================================");

    const coopSnap = await db.collection("cooperative_members").get();
    console.log(`Total cooperative members in DB: ${coopSnap.size}`);

    const completedRefs = new Set<string>();
    const processedPaymentsSnap = await db.collection("processedPayments")
        .where("status", "==", "completed")
        .select("reference")
        .get();
    processedPaymentsSnap.docs.forEach(doc => {
        const ref = doc.data().reference;
        if (ref) completedRefs.add(ref);
    });
    console.log(`Loaded ${completedRefs.size} completed payment references from processedPayments.`);

    const membersToRevert: any[] = [];

    for (const doc of coopSnap.docs) {
        const member = doc.data();
        const userId = member.userId || doc.id;
        const status = member.status || member.membershipStatus || "pending";
        const paymentStatus = member.paymentStatus || "pending";

        const isActiveOrApproved = status === "active" || status === "approved";
        if (!isActiveOrApproved) continue;

        // Legacy check
        const isLegacy = 
            member._importSource === "legacy_csv_import" || 
            member.isLegacy === true || 
            member.legacyOnboardedBy || 
            member.paymentReference === "LEGACY_IMPORT_RECEIPT";

        // Manual check
        const isManual = member.approvedBy || member.approvedAt || member.healedByScript;

        if (isLegacy || isManual) continue;

        // Payment check
        const ref = member.paymentReference;
        const hasValidPayment = ref && completedRefs.has(ref);

        if (hasValidPayment) continue;

        membersToRevert.push({
            userId,
            email: member.email,
            paymentStatus,
            status,
            ref: doc.ref,
            paymentReference: ref
        });
    }

    console.log(`Identified ${membersToRevert.length} unpaid members to revert.`);

    if (membersToRevert.length === 0) {
        console.log("No members need reversion.");
        return;
    }

    // Batch fetch user documents in chunks of 500
    console.log("Checking user profiles existence in batches...");
    const existingUserIds = new Set<string>();
    const chunkSize = 500;
    
    for (let i = 0; i < membersToRevert.length; i += chunkSize) {
        const chunk = membersToRevert.slice(i, i + chunkSize);
        const refs = chunk.map(m => db.collection("users").doc(m.userId));
        
        // Firestore db.getAll accepts an array of DocumentReferences
        const docs = await db.getAll(...refs);
        docs.forEach(doc => {
            if (doc.exists) {
                existingUserIds.add(doc.id);
            }
        });
        console.log(`  Fetched chunk ${Math.floor(i / chunkSize) + 1}/${Math.ceil(membersToRevert.length / chunkSize)}. Total users found: ${existingUserIds.size}`);
    }

    // Perform batched updates (200 users per batch = max 400 operations, under batch limit of 500)
    let batch = db.batch();
    let updatesInBatch = 0;
    let totalUpdated = 0;

    for (const member of membersToRevert) {
        if (!DRY_RUN) {
            // Update cooperative_members
            batch.update(member.ref, {
                status: "pending",
                membershipStatus: "pending",
                paymentStatus: "pending",
                _reverted_as_unpaid: true,
                _revertedAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp()
            });
            updatesInBatch++;

            // Update users collection if doc exists
            if (existingUserIds.has(member.userId)) {
                const userRef = db.collection("users").doc(member.userId);
                batch.update(userRef, {
                    roles: FieldValue.arrayRemove("cooperative_member"),
                    "serviceRegistrations.cooperative.status": "pending",
                    "serviceRegistrations.cooperatives.status": "pending",
                    "serviceRegistrations.cooperative.paymentStatus": "pending",
                    "serviceRegistrations.cooperatives.paymentStatus": "pending",
                    "serviceRegistrations.cooperative.updatedAt": FieldValue.serverTimestamp(),
                    "serviceRegistrations.cooperatives.updatedAt": FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp()
                });
                updatesInBatch++;
            }

            if (updatesInBatch >= 400) {
                await batch.commit();
                totalUpdated += Math.round(updatesInBatch / 2); // approximate users count
                console.log(`  [Batch] Committed updates for batch. Total users reverted so far: ~${totalUpdated}`);
                batch = db.batch();
                updatesInBatch = 0;
            }
        }
    }

    if (!DRY_RUN && updatesInBatch > 0) {
        await batch.commit();
        console.log(`  [Batch] Committed final batch of ${updatesInBatch} updates.`);
    }

    console.log(`\nReversion complete. Reverted ${membersToRevert.length} unpaid members.`);

    // Invalidate Redis cache for reverted users in chunks of 50 in parallel to be fast
    if (!DRY_RUN) {
        console.log("Invalidating Upstash Redis caches...");
        const invalidationPromises = membersToRevert.map(m => invalidateUserCache(m.userId));
        
        // Chunk invalidation promises to avoid hitting Redis rate limits
        const invalidationChunkSize = 50;
        for (let i = 0; i < invalidationPromises.length; i += invalidationChunkSize) {
            const chunk = invalidationPromises.slice(i, i + invalidationChunkSize);
            await Promise.all(chunk);
            if (i > 0 && i % 250 === 0) {
                console.log(`  Invalidated ${i} caches...`);
            }
        }
        console.log(`Redis cache invalidation complete for ${membersToRevert.length} users.`);
    }
}

main().then(() => process.exit(0)).catch(err => {
    console.error(err);
    process.exit(1);
});
