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
    console.log("Searching for user to ban and delete...");
    let uids = [];

    // 1. Find via Auth
    try {
        const user = await auth.getUserByEmail(targetEmail);
        console.log(`Found via Auth Email: ${user.uid}`);
        uids.push(user.uid);
    } catch(e) {
        console.log("Not found in Auth by exact email.");
    }

    // 2. Find via name in Users collection
    const usersSnap = await db.collection("users").where("fullName", "==", targetFullName).get();
    usersSnap.docs.forEach(d => {
        console.log(`Found via Users Collection Name: ${d.id}`);
        if (!uids.includes(d.id)) uids.push(d.id);
    });

    const emailSnap = await db.collection("users").where("email", "==", targetEmail).get();
    emailSnap.docs.forEach(d => {
        console.log(`Found via Users Collection Email: ${d.id}`);
        if (!uids.includes(d.id)) uids.push(d.id);
    });

    if (uids.length === 0) {
        console.log("User not found anywhere.");
        process.exit(1);
    }

    for (const uid of uids) {
        console.log(`\nProcessing UID: ${uid}`);
        
        // Disable in Auth (BAN)
        try {
            await auth.updateUser(uid, { disabled: true });
            console.log(`[+] Banned (disabled) in Firebase Auth.`);
        } catch(e) {
            console.log(`[-] Could not disable in Auth: ${e.message}`);
        }

        // Delete from all major collections
        const collectionsToCheck = [
            "users", "cooperative_members", "wave_members", 
            "wave_applications", "academy_applications", "seller_verifications",
            "export_applications", "land_listings"
        ];

        const batch = db.batch();
        
        for (const col of collectionsToCheck) {
            // Delete by ID
            batch.delete(db.collection(col).doc(uid));

            // Query by email and delete
            const e1 = await db.collection(col).where("email", "==", targetEmail).get();
            const e2 = await db.collection(col).where("userEmail", "==", targetEmail).get();
            
            e1.docs.forEach(d => batch.delete(d.ref));
            e2.docs.forEach(d => batch.delete(d.ref));
        }

        await batch.commit();
        console.log(`[+] Purged records from all DB collections.`);
    }

    console.log("\nSuccess: User banned and data deleted from app.");
    process.exit(0);
}

execute().catch(console.error);
