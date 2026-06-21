import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

import { db } from "../src/lib/firebase-admin";

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
    console.log("=========================================");
    console.log("DEDUPLICATING COOPERATIVE & ACADEMY MEMBERS");
    console.log(DRY_RUN ? "🔍 DRY RUN MODE" : "🔧 LIVE MODE - WRITING TO DB");
    console.log("=========================================");

    // 1. DEDUPLICATE COOPERATIVE MEMBERS
    console.log("\n--- Deduplicating cooperative_members ---");
    const coopSnap = await db.collection("cooperative_members").get();
    
    // Group active/approved documents by userId
    const coopUserDocs = new Map<string, any[]>();
    
    coopSnap.docs.forEach(doc => {
        const data = doc.data();
        const userId = data.userId || doc.id;
        const status = data.status || data.membershipStatus || "pending";
        const isActive = status === "active" || status === "approved";
        
        if (isActive) {
            if (!coopUserDocs.has(userId)) {
                coopUserDocs.set(userId, []);
            }
            coopUserDocs.get(userId)!.push({ docId: doc.id, ref: doc.ref, data });
        }
    });

    let coopDuplicatesDeleted = 0;
    let coopBatch = db.batch();
    let coopBatchOps = 0;

    for (const [userId, docs] of coopUserDocs.entries()) {
        if (docs.length > 1) {
            // We have duplicates!
            console.log(`User ${userId} has ${docs.length} active documents: ${JSON.stringify(docs.map(d => d.docId))}`);
            
            // Determine which document to keep
            // Rule: Keep the one where docId === userId. If none, we will write to docId === userId.
            const docToKeep = docs.find(d => d.docId === userId) || docs[0];
            const docsToDelete = docs.filter(d => d.docId !== docToKeep.docId);

            console.log(`  -> Keeping doc: ${docToKeep.docId}`);
            for (const d of docsToDelete) {
                console.log(`  -> Deleting doc: ${d.docId}`);
                coopDuplicatesDeleted++;
                
                if (!DRY_RUN) {
                    coopBatch.delete(d.ref);
                    coopBatchOps++;
                    
                    if (coopBatchOps >= 400) {
                        await coopBatch.commit();
                        coopBatch = db.batch();
                        coopBatchOps = 0;
                    }
                }
            }

            // If the kept document doesn't have docId === userId, we should clone it to docId === userId
            if (docToKeep.docId !== userId) {
                console.log(`  -> Cloning kept doc ${docToKeep.docId} to canonical userId doc ID: ${userId}`);
                if (!DRY_RUN) {
                    const canonicalRef = db.collection("cooperative_members").doc(userId);
                    coopBatch.set(canonicalRef, docToKeep.data);
                    coopBatch.delete(docToKeep.ref); // Delete the old random ID one
                    coopBatchOps += 2;
                    
                    if (coopBatchOps >= 400) {
                        await coopBatch.commit();
                        coopBatch = db.batch();
                        coopBatchOps = 0;
                    }
                }
            }
        }
    }

    if (!DRY_RUN && coopBatchOps > 0) {
        await coopBatch.commit();
        console.log("Committed cooperative deduplication batch.");
    }
    console.log(`Cooperative duplicates identified for deletion: ${coopDuplicatesDeleted}`);

    // 2. DEDUPLICATE ACADEMY APPLICATIONS
    console.log("\n--- Deduplicating academy_applications ---");
    const acadSnap = await db.collection("academy_applications").get();
    
    // Group active/approved documents by userId
    const acadUserDocs = new Map<string, any[]>();
    
    acadSnap.docs.forEach(doc => {
        const data = doc.data();
        const userId = data.userId;
        const status = data.status || "pending";
        const isActive = status === "approved" || status === "active";
        
        if (isActive && userId) {
            if (!acadUserDocs.has(userId)) {
                acadUserDocs.set(userId, []);
            }
            acadUserDocs.get(userId)!.push({ docId: doc.id, ref: doc.ref, data });
        }
    });

    let acadDuplicatesDeleted = 0;
    let acadBatch = db.batch();
    let acadBatchOps = 0;

    for (const [userId, docs] of acadUserDocs.entries()) {
        if (docs.length > 1) {
            // We have duplicates!
            console.log(`Academy User ${userId} has ${docs.length} approved documents: ${JSON.stringify(docs.map(d => d.docId))}`);
            
            // Determine which document to keep
            // Rule: Keep the one with docId === userId. If not, keep the one without legacy prefix.
            let docToKeep = docs.find(d => d.docId === userId);
            if (!docToKeep) {
                docToKeep = docs.find(d => !d.docId.startsWith("legacy_")) || docs[0];
            }
            const docsToDelete = docs.filter(d => d.docId !== docToKeep.docId);

            console.log(`  -> Keeping doc: ${docToKeep.docId}`);
            for (const d of docsToDelete) {
                console.log(`  -> Deleting doc: ${d.docId}`);
                acadDuplicatesDeleted++;
                
                if (!DRY_RUN) {
                    acadBatch.delete(d.ref);
                    acadBatchOps++;
                    
                    if (acadBatchOps >= 400) {
                        await acadBatch.commit();
                        acadBatch = db.batch();
                        acadBatchOps = 0;
                    }
                }
            }
        }
    }

    if (!DRY_RUN && acadBatchOps > 0) {
        await acadBatch.commit();
        console.log("Committed academy deduplication batch.");
    }
    console.log(`Academy duplicates identified for deletion: ${acadDuplicatesDeleted}`);
}

main().catch(err => {
    console.error("Failed:", err);
    process.exit(1);
});
