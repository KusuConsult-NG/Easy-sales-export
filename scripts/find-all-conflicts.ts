import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { db, adminAuth } from '../src/lib/firebase-admin';
import { COLLECTIONS } from '../src/lib/types/firestore';

async function scanFast() {
    console.log("Fetching all Firebase Auth users in small batches to prevent timeouts...");
    const authMap = new Map();
    let pageToken;
    let count = 0;
    
    try {
        do {
            const result: any = await adminAuth.listUsers(100, pageToken); // small batch
            result.users.forEach((u: any) => {
                if (u.email) {
                    authMap.set(u.email.toLowerCase(), u.uid);
                }
            });
            count += result.users.length;
            console.log(`Fetched ${count} users from Auth...`);
            pageToken = result.pageToken;
        } while (pageToken);
    } catch (e: any) {
        console.error("Auth fetch failed:", e.message);
        return;
    }

    console.log(`\nSuccessfully loaded ${authMap.size} Auth emails. Now checking database...`);
    const snap = await db.collection(COLLECTIONS.USERS).select('email').get();
    
    let conflicts = [];

    for (const doc of snap.docs) {
        const data = doc.data();
        if (!data.email) continue;
        
        const emailLower = data.email.toLowerCase();
        const authUid = authMap.get(emailLower);
        
        if (authUid && authUid !== doc.id) {
            conflicts.push(emailLower);
            console.log(`\n🚨 CONFLICT FOUND FOR EMAIL: ${emailLower}`);
            console.log(`Run this exact command to fix it:`);
            console.log(`npx tsx scripts/fix-auth-firestore-conflict.ts ${emailLower} --delete-auth`);
        }
    }

    if (conflicts.length === 0) {
        console.log("\n✅ No conflicts found at all!");
    }
}

scanFast().then(() => process.exit(0)).catch(e => {
    console.error(e);
    process.exit(1);
});
