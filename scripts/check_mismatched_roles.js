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
    console.log("Locating mismatched role documents...");

    // Get all cooperative members who are active or approved
    const membersSnap = await db.collection("cooperative_members").get();
    const activeOrApprovedMembers = membersSnap.docs.filter(doc => {
        const status = doc.data().membershipStatus;
        return status === "active" || status === "approved";
    });

    console.log(`Active/approved members in collection: ${activeOrApprovedMembers.length}`);

    // Load all users from Firestore where roles contains "cooperative_member" using query
    const queryUsersSnap = await db.collection("users").where("roles", "array-contains", "cooperative_member").get();
    const queryUserIds = new Set(queryUsersSnap.docs.map(doc => doc.id));
    console.log(`Users with role "cooperative_member" via query: ${queryUserIds.size}`);

    // Let's find the active/approved members whose user ID is NOT in queryUserIds
    const mismatched = [];
    for (const memberDoc of activeOrApprovedMembers) {
        const uid = memberDoc.data().userId || memberDoc.id;
        if (!queryUserIds.has(uid)) {
            // Load user document directly
            const userSnap = await db.collection("users").doc(uid).get();
            mismatched.push({
                memberId: memberDoc.id,
                userId: uid,
                userExists: userSnap.exists,
                userData: userSnap.exists ? userSnap.data() : null,
                memberData: memberDoc.data()
            });
        }
    }

    console.log(`\nFound ${mismatched.length} mismatched active members (not returned by roles query)`);

    // Let's print details of the first 10 mismatched
    mismatched.slice(0, 10).forEach((m, idx) => {
        console.log(`\n--- Mismatch #${idx + 1} ---`);
        console.log(`MemberDoc ID: ${m.memberId}`);
        console.log(`UserId: ${m.userId}`);
        console.log(`User Exists: ${m.userExists}`);
        if (m.userExists) {
            console.log(`User roles: ${JSON.stringify(m.userData.roles)}`);
            console.log(`User roles type: ${typeof m.userData.roles} (isArray: ${Array.isArray(m.userData.roles)})`);
            console.log(`User Email: ${m.userData.email}`);
        } else {
            console.log(`Member Email: ${m.memberData.email}`);
            console.log(`Member Name: ${m.memberData.firstName} ${m.memberData.lastName}`);
        }
    });
}

main().then(() => process.exit(0)).catch(err => {
    console.error("Failed:", err);
    process.exit(1);
});
