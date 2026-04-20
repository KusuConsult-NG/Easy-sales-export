const admin = require('firebase-admin');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const privateKey = process.env.FIREBASE_PRIVATE_KEY
    ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    : undefined;

admin.initializeApp({
    credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey,
    }),
});

const auth = admin.auth();
const db = admin.firestore();

const targetEmail = "q.ew.uy.i.r.u.6.20@gmail.com";
const targetFullName = "oZzgzedgwjeXEBkuzjlVi CmfPOtOgtunkXFZO XxEiHrKvLkvXiJaR";

async function execute() {
    console.log("Searching for user to ban and delete across ALL collections...");

    let uids = [];
    let docRefsToDelete = [];

    // 1. Find via Auth
    try {
        const user = await auth.getUserByEmail(targetEmail);
        console.log(`Found via Auth Email: ${user.uid}`);
        uids.push(user.uid);
    } catch(e) {
        console.log("Not found in Auth by exact email.");
    }

    // 2. Sweeping collections for UIDs or specific docs
    const collectionsToSweep = [
        "users", "cooperative_members", "wave_members", 
        "wave_applications", "academy_applications", "seller_verifications",
        "export_applications", "land_listings", "wave_briefing_registrations",
        "briefing_submissions", "cooperative_onboarding_applications"
    ];

    for (const col of collectionsToSweep) {
        // Find by email
        const e1 = await db.collection(col).where("email", "==", targetEmail).get();
        const e2 = await db.collection(col).where("userEmail", "==", targetEmail).get();
        // Find by fullName
        const n1 = await db.collection(col).where("fullName", "==", targetFullName).get();
        const n2 = await db.collection(col).where("name", "==", targetFullName).get();
        
        const docs = [...e1.docs, ...e2.docs, ...n1.docs, ...n2.docs];
        for (const doc of docs) {
            console.log(`Found doc in ${col}: ${doc.id}`);
            docRefsToDelete.push(doc.ref);
            if (col === "users" && !uids.includes(doc.id)) {
                uids.push(doc.id);
            }
        }
    }

    // De-dupe refs
    const uniqueRefsMap = new Map();
    docRefsToDelete.forEach(ref => {
        uniqueRefsMap.set(ref.path, ref);
    });
    const uniqueRefs = Array.from(uniqueRefsMap.values());

    console.log(`\nFound ${uids.length} UIDs to ban.`);
    console.log(`Found ${uniqueRefs.length} documents to delete.`);

    for (const uid of uids) {
        try {
            await auth.updateUser(uid, { disabled: true });
            console.log(`[+] Banned (disabled) UID: ${uid} in Firebase Auth.`);
            
            // Delete user-id based docs blindly in case they exist
            for (const col of collectionsToSweep) {
                docRefsToDelete.push(db.collection(col).doc(uid));
            }
        } catch(e) {
            console.log(`[-] Could not disable UID: ${uid} in Auth (may already be disabled or not exist)`);
        }
    }

    // Create a new deduped list to include the blind deletes
    const finalRefsMap = new Map();
    docRefsToDelete.forEach(ref => finalRefsMap.set(ref.path, ref));
    const finalRefs = Array.from(finalRefsMap.values());

    // Batch delete
    const batchSize = 500;
    for (let i = 0; i < finalRefs.length; i += batchSize) {
        const batch = db.batch();
        const chunk = finalRefs.slice(i, i + batchSize);
        chunk.forEach(ref => batch.delete(ref));
        await batch.commit();
    }
    
    console.log(`[+] Purged ${finalRefs.length} records/paths across all DB collections.`);

    console.log("\nSuccess: User banned and data fully deleted from app.");
    process.exit(0);
}

execute().catch(console.error);
