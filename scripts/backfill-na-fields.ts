import { config } from "dotenv";
import * as path from "path";
config({ path: path.resolve(process.cwd(), ".env.local") });

import { db } from "../src/lib/firebase-admin";
import { COLLECTIONS } from "../src/lib/types/firestore";

function sanitizeValue(val: any): any {
    if (typeof val === 'string') {
        const cleaned = val.trim();
        const lower = cleaned.toLowerCase();
        if (
            lower === 'n/a' || 
            lower === 'undefined' || 
            lower === 'null' ||
            lower.startsWith('n/a*') ||
            lower.includes('n/a****n/a')
        ) {
            return '';
        }
        return val;
    }
    if (Array.isArray(val)) {
        return val.map(item => sanitizeValue(item));
    }
    if (val !== null && typeof val === 'object' && !(val instanceof Date)) {
        // Handle Firestore Timestamp objects (either with toDate function, or _seconds/_nanoseconds)
        if (typeof val.toDate === 'function' || (val._seconds !== undefined && val._nanoseconds !== undefined) || (val.seconds !== undefined && val.nanoseconds !== undefined)) {
            return val;
        }
        const cleanedObj: any = {};
        for (const key of Object.keys(val)) {
            cleanedObj[key] = sanitizeValue(val[key]);
        }
        return cleanedObj;
    }
    return val;
}

function isDeepEqual(val1: any, val2: any): boolean {
    if (val1 === val2) return true;
    if (val1 === null || val1 === undefined || val2 === null || val2 === undefined) {
        return val1 === val2;
    }
    if (typeof val1 !== typeof val2) return false;
    
    if (val1 instanceof Date && val2 instanceof Date) {
        return val1.getTime() === val2.getTime();
    }
    
    // Firestore Timestamp check
    const isVal1TS = typeof val1.toDate === 'function' || (val1._seconds !== undefined && val1._nanoseconds !== undefined) || (val1.seconds !== undefined && val1.nanoseconds !== undefined);
    const isVal2TS = typeof val2.toDate === 'function' || (val2._seconds !== undefined && val2._nanoseconds !== undefined) || (val2.seconds !== undefined && val2.nanoseconds !== undefined);
    if (isVal1TS && isVal2TS) {
        const s1 = val1._seconds !== undefined ? val1._seconds : (val1.seconds !== undefined ? val1.seconds : 0);
        const s2 = val2._seconds !== undefined ? val2._seconds : (val2.seconds !== undefined ? val2.seconds : 0);
        const n1 = val1._nanoseconds !== undefined ? val1._nanoseconds : (val1.nanoseconds !== undefined ? val1.nanoseconds : 0);
        const n2 = val2._nanoseconds !== undefined ? val2._nanoseconds : (val2.nanoseconds !== undefined ? val2.nanoseconds : 0);
        return s1 === s2 && n1 === n2;
    }
    
    if (Array.isArray(val1) && Array.isArray(val2)) {
        if (val1.length !== val2.length) return false;
        for (let i = 0; i < val1.length; i++) {
            if (!isDeepEqual(val1[i], val2[i])) return false;
        }
        return true;
    }
    
    if (typeof val1 === 'object') {
        const keys1 = Object.keys(val1);
        const keys2 = Object.keys(val2);
        if (keys1.length !== keys2.length) return false;
        for (const key of keys1) {
            if (!isDeepEqual(val1[key], val2[key])) return false;
        }
        return true;
    }
    
    return false;
}

async function commitWithRetry(batch: any, retries = 3, delayMs = 2000) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            await batch.commit();
            return;
        } catch (error: any) {
            console.warn(`⚠️ Batch commit attempt ${attempt} failed: ${error.message || error}`);
            if (attempt === retries) {
                throw error;
            }
            const backoff = delayMs * Math.pow(2, attempt - 1);
            console.log(`⏳ Retrying batch commit in ${backoff}ms...`);
            await new Promise(resolve => setTimeout(resolve, backoff));
        }
    }
}

async function getQueryWithRetry(query: any, retries = 3, delayMs = 2000) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const snap = await query.get();
            return snap;
        } catch (error: any) {
            console.warn(`⚠️ Query get attempt ${attempt} failed: ${error.message || error}`);
            if (attempt === retries) {
                throw error;
            }
            const backoff = delayMs * Math.pow(2, attempt - 1);
            console.log(`⏳ Retrying query get in ${backoff}ms...`);
            await new Promise(resolve => setTimeout(resolve, backoff));
        }
    }
}

async function backfillCollection(collectionName: string) {
    console.log(`\n📂 Starting backfill for collection: "${collectionName}"...`);
    
    let totalProcessed = 0;
    let totalUpdated = 0;
    let batch = db.batch();
    let batchSize = 0;
    
    let lastDoc: any = null;
    let hasMore = true;
    const PAGE_SIZE = 100;
    
    while (hasMore) {
        let query = db.collection(collectionName).limit(PAGE_SIZE);
        if (lastDoc) {
            query = query.startAfter(lastDoc);
        }
        
        const snap = await getQueryWithRetry(query);
        if (snap.empty) {
            hasMore = false;
            break;
        }
        
        for (const doc of snap.docs) {
            totalProcessed++;
            const data = doc.data();
            const sanitized = sanitizeValue(data);
            
            if (!isDeepEqual(data, sanitized)) {
                // Find what fields changed for nice logging
                const changedFields: string[] = [];
                for (const key of Object.keys(sanitized)) {
                    if (!isDeepEqual(data[key], sanitized[key])) {
                        changedFields.push(key);
                    }
                }
                
                batch.set(doc.ref, sanitized, { merge: true });
                batchSize++;
                totalUpdated++;
                
                console.log(`[UPDATE] ${collectionName} / ${doc.id}: Sanitized [${changedFields.join(", ")}]`);
                
                if (batchSize >= 200) {
                    console.log(`⏳ Committing batch of ${batchSize} updates for ${collectionName}...`);
                    await commitWithRetry(batch);
                    console.log(`✅ Batch committed successfully.`);
                    batch = db.batch();
                    batchSize = 0;
                }
            }
        }
        
        lastDoc = snap.docs[snap.docs.length - 1];
        if (snap.size < PAGE_SIZE) {
            hasMore = false;
        }
    }
    
    if (batchSize > 0) {
        console.log(`⏳ Committing final batch of ${batchSize} updates for ${collectionName}...`);
        await commitWithRetry(batch);
        console.log(`✅ Final batch committed successfully.`);
    }
    
    console.log(`🏁 Finished collection "${collectionName}": Processed ${totalProcessed}, Updated ${totalUpdated}, Skipped ${totalProcessed - totalUpdated}`);
    return { processed: totalProcessed, updated: totalUpdated };
}

async function runBackfill() {
    console.log("🚀 Starting Firestore Deep Sanitization Backfill Script...");
    const stats: any = {};
    
    stats.users = await backfillCollection(COLLECTIONS.USERS);
    stats.cooperative_members = await backfillCollection(COLLECTIONS.COOPERATIVE_MEMBERS);
    stats.wave_applications = await backfillCollection(COLLECTIONS.WAVE_APPLICATIONS);
    
    console.log("\n========================================================");
    console.log("🎉 Firestore Deep Sanitization Complete!");
    console.log("========================================================");
    for (const [col, s] of Object.entries(stats) as any) {
        console.log(`${col.toUpperCase()}: Processed: ${s.processed}, Sanitized/Updated: ${s.updated}, Skipped: ${s.processed - s.updated}`);
    }
    console.log("========================================================\n");
}

runBackfill().catch(err => {
    console.error("❌ Fatal error executing deep sanitization backfill:", err);
});
