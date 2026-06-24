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
    console.log("Analyzing Cooperative Membership...");
    
    // Count docs in cooperative_members collection
    const coopSnap = await db.collection("cooperative_members").get();
    console.log(`\n1. "cooperative_members" collection document count: ${coopSnap.size}`);

    // Check if there's any other cooperative-related collections
    // Let's count users in the "users" collection with cooperative_member role
    const usersSnap = await db.collection("users").get();
    let usersWithCoopRole = 0;
    const roleCounts = {};
    
    usersSnap.forEach(doc => {
        const data = doc.data();
        const roles = data.roles || [];
        roles.forEach(role => {
            roleCounts[role] = (roleCounts[role] || 0) + 1;
        });
        if (roles.includes("cooperative") || roles.includes("cooperative_member") || roles.includes("member")) {
            usersWithCoopRole++;
        }
    });

    console.log(`\n2. Total users in "users" collection: ${usersSnap.size}`);
    console.log("Role distribution among all users:");
    console.log(JSON.stringify(roleCounts, null, 2));

    // Also let's print first 10 cooperative members from collection
    console.log('\n3. Sample of first 10 docs in "cooperative_members" collection:');
    coopSnap.docs.slice(0, 10).forEach(doc => {
        console.log(`- DocID (UserId): ${doc.id} => `, doc.data());
    });
}

main().then(() => process.exit(0)).catch(err => {
    console.error("Failed:", err);
    process.exit(1);
});
