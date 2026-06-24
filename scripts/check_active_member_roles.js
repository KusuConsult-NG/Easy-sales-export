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
    console.log("Analyzing roles of active/approved cooperative members...");

    const membersSnap = await db.collection("cooperative_members").get();
    const activeOrApprovedMembers = membersSnap.docs.filter(doc => {
        const status = doc.data().membershipStatus;
        return status === "active" || status === "approved";
    });

    console.log(`Total active/approved members: ${activeOrApprovedMembers.length}`);

    const usersSnap = await db.collection("users").select("roles").get();
    const usersMap = {};
    usersSnap.forEach(doc => {
        usersMap[doc.id] = doc.data();
    });

    const activeMemberRoles = {};
    let missingUsers = 0;

    activeOrApprovedMembers.forEach(doc => {
        const uid = doc.data().userId || doc.id;
        const user = usersMap[uid];
        if (!user) {
            missingUsers++;
        } else {
            const roles = user.roles || [];
            roles.forEach(role => {
                activeMemberRoles[role] = (activeMemberRoles[role] || 0) + 1;
            });
            if (roles.length === 0) {
                activeMemberRoles["NO_ROLES"] = (activeMemberRoles["NO_ROLES"] || 0) + 1;
            }
        }
    });

    console.log(`Missing user profiles for active members: ${missingUsers}`);
    console.log("Roles among active/approved members:");
    console.log(JSON.stringify(activeMemberRoles, null, 2));
}

main().then(() => process.exit(0)).catch(err => {
    console.error("Failed:", err);
    process.exit(1);
});
