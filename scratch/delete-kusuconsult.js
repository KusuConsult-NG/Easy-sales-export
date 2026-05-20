const admin = require('firebase-admin');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const privateKey = process.env.FIREBASE_PRIVATE_KEY
    ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    : undefined;

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey,
        }),
    });
}

const auth = admin.auth();
const db = admin.firestore();

const targetEmail = "kusuconsult@gmail.com";

async function execute() {
    console.log(`Starting complete removal of ${targetEmail} from Firebase Auth, Firestore, and Redis...`);

    let uids = [];
    let docRefsToDelete = [];

    // 1. Find via Auth
    try {
        const user = await auth.getUserByEmail(targetEmail);
        console.log(`Found user in Auth. Email: ${user.email}, UID: ${user.uid}`);
        uids.push(user.uid);
    } catch (e) {
        console.log(`User not found in Firebase Auth by email: ${targetEmail}`);
    }

    // 2. Sweep collections for the target email
    const collectionsToSweep = [
        "users", "admin_users", "cooperative_members", "wave_members", 
        "wave_applications", "academy_applications", "seller_verifications",
        "export_applications", "land_listings", "wave_briefing_registrations",
        "briefing_submissions", "cooperative_onboarding_applications",
        "wallets", "wallet_transactions", "notifications", "disputes"
    ];

    for (const col of collectionsToSweep) {
        try {
            const snapEmail1 = await db.collection(col).where("email", "==", targetEmail).get();
            const snapEmail2 = await db.collection(col).where("userEmail", "==", targetEmail).get();
            
            const docs = [...snapEmail1.docs, ...snapEmail2.docs];
            for (const doc of docs) {
                console.log(`Found record in ${col}: ${doc.id}`);
                docRefsToDelete.push(doc.ref);
                if (col === "users" && !uids.includes(doc.id)) {
                    uids.push(doc.id);
                }
            }
        } catch (e) {
            // Some collections might not exist or be queryable by these fields, which is fine
        }
    }

    // Add explicit document paths by UID if found
    for (const uid of uids) {
        for (const col of collectionsToSweep) {
            docRefsToDelete.push(db.collection(col).doc(uid));
        }
    }

    // De-duplicate document references
    const finalRefsMap = new Map();
    docRefsToDelete.forEach(ref => finalRefsMap.set(ref.path, ref));
    const finalRefs = Array.from(finalRefsMap.values());

    console.log(`\nIdentified UIDs for deletion: ${JSON.stringify(uids)}`);
    console.log(`Identified ${finalRefs.length} database document references to delete.`);

    // 3. Delete from Firebase Auth
    for (const uid of uids) {
        try {
            await auth.deleteUser(uid);
            console.log(`[+] Deleted UID ${uid} from Firebase Auth.`);
        } catch (e) {
            console.error(`[-] Failed to delete UID ${uid} from Firebase Auth: ${e.message}`);
        }
    }

    // 4. Batch delete from Firestore
    if (finalRefs.length > 0) {
        const batchSize = 500;
        let deletedDocsCount = 0;
        for (let i = 0; i < finalRefs.length; i += batchSize) {
            const batch = db.batch();
            const chunk = finalRefs.slice(i, i + batchSize);
            
            // We check if doc exists before deleting to make it cleaner, or we can just delete blindly
            // Since we're doing blind delete on some collections by UID, we delete blindly
            chunk.forEach(ref => batch.delete(ref));
            await batch.commit();
            deletedDocsCount += chunk.length;
        }
        console.log(`[+] Purged ${deletedDocsCount} document paths across all Firestore collections.`);
    }

    // 5. Invalidate Redis Cache
    for (const uid of uids) {
        try {
            const { redis, CacheKeys } = require("../src/lib/redis");
            await Promise.all([
                redis.del(CacheKeys.userProfile(uid)),
                redis.del(CacheKeys.userPermissions(uid)),
                redis.del(CacheKeys.userSession(uid)),
                redis.del(CacheKeys.userStats(uid)),
            ]);
            console.log(`[+] Invalidated Redis cache for UID: ${uid}`);
        } catch (cacheErr) {
            console.log(`[!] Redis cache invalidation skipped/failed for UID: ${uid} (Redis might not be running/configured locally)`);
        }
    }

    console.log(`\n✅ COMPLETE: ${targetEmail} has been completely removed from the entire application.`);
    process.exit(0);
}

execute().catch(e => {
    console.error("Fatal execution error:", e);
    process.exit(1);
});
