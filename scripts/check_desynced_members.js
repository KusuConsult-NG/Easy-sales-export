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
    console.log("Analyzing desynced cooperative members...");

    // Get all cooperative members who are active or approved
    const membersSnap = await db.collection("cooperative_members")
        .get();
        
    const activeOrApprovedMembers = membersSnap.docs.filter(doc => {
        const status = doc.data().membershipStatus;
        return status === "active" || status === "approved";
    });

    console.log(`Found ${activeOrApprovedMembers.length} active or approved members in cooperative_members collection.`);

    // Find which ones do not have the cooperative_member role in users collection
    let desyncedCount = 0;
    const desyncedList = [];

    // To be fast, let's load all users' roles using select() to do in-memory lookup
    const usersSnap = await db.collection("users").select("roles", "email", "fullName", "name").get();
    const usersMap = {};
    usersSnap.forEach(doc => {
        usersMap[doc.id] = doc.data();
    });

    activeOrApprovedMembers.forEach(memberDoc => {
        const memberData = memberDoc.data();
        const userId = memberData.userId || memberDoc.id;
        const user = usersMap[userId];

        if (!user) {
            console.log(`[Missing User Profile] Member ID/UserId: ${userId} has no matching profile in 'users' collection!`);
            desyncedCount++;
            desyncedList.push({ userId, memberId: memberDoc.id, type: "missing_profile", memberData });
        } else {
            const roles = user.roles || [];
            if (!roles.includes("cooperative_member")) {
                desyncedCount++;
                desyncedList.push({ userId, memberId: memberDoc.id, type: "missing_role", user, memberData });
            }
        }
    });

    console.log(`\nTotal desynced members: ${desyncedCount}`);
    console.log(`- Missing profile: ${desyncedList.filter(d => d.type === "missing_profile").length}`);
    console.log(`- Missing role: ${desyncedList.filter(d => d.type === "missing_role").length}`);

    // Print first 10 desynced members as sample
    console.log("\nSample of first 10 desynced members:");
    desyncedList.slice(0, 10).forEach(d => {
        if (d.type === "missing_profile") {
            console.log(`- Missing profile: userId=${d.userId} | Email=${d.memberData.email} | Name=${d.memberData.firstName} ${d.memberData.lastName}`);
        } else {
            console.log(`- Missing role: userId=${d.userId} | Email=${d.user.email} | Name=${d.user.fullName || d.user.name} | Roles=${JSON.stringify(d.user.roles)}`);
        }
    });
}

main().then(() => process.exit(0)).catch(err => {
    console.error("Failed:", err);
    process.exit(1);
});
