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
    console.log("Analyzing Cooperative Membership using targeted queries...");

    // 1. Count cooperative_members collection
    const coopCountSnap = await db.collection("cooperative_members").count().get();
    console.log(`cooperative_members collection total count: ${coopCountSnap.data().count}`);

    // 2. Count cooperative_members by membershipStatus
    const activeCount = await db.collection("cooperative_members").where("membershipStatus", "==", "active").count().get();
    const approvedCount = await db.collection("cooperative_members").where("membershipStatus", "==", "approved").count().get();
    const pendingCount = await db.collection("cooperative_members").where("membershipStatus", "==", "pending").count().get();
    const suspendedCount = await db.collection("cooperative_members").where("membershipStatus", "==", "suspended").count().get();

    console.log(`- active: ${activeCount.data().count}`);
    console.log(`- approved: ${approvedCount.data().count}`);
    console.log(`- pending: ${pendingCount.data().count}`);
    console.log(`- suspended: ${suspendedCount.data().count}`);

    // 3. Count users in "users" collection with specific roles using select()
    // We only fetch the "roles" field using select()
    console.log("Fetching roles for all users...");
    const usersSnap = await db.collection("users").select("roles").get();
    console.log(`Fetched ${usersSnap.size} user roles.`);

    const roleCounts = {};
    usersSnap.forEach(doc => {
        const roles = doc.data().roles || [];
        roles.forEach(role => {
            roleCounts[role] = (roleCounts[role] || 0) + 1;
        });
    });

    console.log("Role distribution among all users:");
    console.log(JSON.stringify(roleCounts, null, 2));
}

main().then(() => process.exit(0)).catch(err => {
    console.error("Failed:", err);
    process.exit(1);
});
