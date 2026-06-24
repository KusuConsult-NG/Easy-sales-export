const admin = require('firebase-admin');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env.local') });

let privateKey = process.env.FIREBASE_PRIVATE_KEY;
if (privateKey) {
    if (privateKey.startsWith('"') && privateKey.endsWith('"')) {
        privateKey = privateKey.slice(1, -1);
    }
    if (privateKey.includes('\\n')) {
        privateKey = privateKey.replace(/\\n/g, '\n');
    }
}

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: privateKey,
        }),
    });
}

const db = admin.firestore();

async function main() {
    console.log("Analyzing duplicate cooperative membership documents...");

    const membersSnap = await db.collection("cooperative_members").get();
    const activeOrApprovedMembers = membersSnap.docs.filter(doc => {
        const status = doc.data().membershipStatus;
        return status === "active" || status === "approved";
    });

    console.log(`Active/approved members count: ${activeOrApprovedMembers.length}`);

    // Map of userId -> array of member document IDs
    const userToDocs = {};
    activeOrApprovedMembers.forEach(doc => {
        const uid = doc.data().userId || doc.id;
        if (!userToDocs[uid]) {
            userToDocs[uid] = [];
        }
        userToDocs[uid].push(doc.id);
    });

    const uniqueUsersCount = Object.keys(userToDocs).length;
    console.log(`Unique users among active/approved members: ${uniqueUsersCount}`);

    const duplicates = [];
    Object.entries(userToDocs).forEach(([uid, docIds]) => {
        if (docIds.length > 1) {
            duplicates.push({ userId: uid, docIds });
        }
    });

    console.log(`Number of users with duplicate membership documents: ${duplicates.length}`);

    // Print first 5 duplicates as sample
    console.log("\nSample of first 5 duplicates:");
    duplicates.slice(0, 5).forEach((d, idx) => {
        console.log(`\nDuplicate #${idx + 1}:`);
        console.log(`UserId: ${d.userId}`);
        console.log(`Doc IDs: ${JSON.stringify(d.docIds)}`);
        
        // Let's load the data for these documents
        d.docIds.forEach(docId => {
            const doc = activeOrApprovedMembers.find(m => m.id === docId);
            console.log(`  - Doc ${docId}: cooperativeId=${doc.data().cooperativeId} | membershipStatus=${doc.data().membershipStatus} | createdAt=${doc.data().createdAt}`);
        });
    });
}

main().then(() => process.exit(0)).catch(err => {
    console.error("Failed:", err);
    process.exit(1);
});
