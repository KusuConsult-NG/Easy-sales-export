const fs = require("fs");
const admin = require("firebase-admin");

function loadEnv(filePath) {
    if (!fs.existsSync(filePath)) return;
    const content = fs.readFileSync(filePath, "utf-8");
    content.split("\n").forEach(line => {
        const parts = line.split("=");
        if (parts.length >= 2) {
            const key = parts[0].trim();
            let val = parts.slice(1).join("=").trim();
            if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
            if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
            process.env[key] = val;
        }
    });
}

loadEnv(".env.local");

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        })
    });
}

const db = admin.firestore();

async function main() {
    const emails = [
        "e2e.admin@easysalesexport.test",
        "e2e.user@easysalesexport.test",
        "e2e.buyer@easysalesexport.test",
        "e2e.seller@easysalesexport.test"
    ];
    for (const email of emails) {
        console.log(`=== SEARCHING FOR EMAIL: ${email} ===`);
        const usersSnap = await db.collection("users").where("email", "==", email).get();
        console.log(`Found ${usersSnap.size} user records in users:`);
        usersSnap.docs.forEach(doc => {
            console.log(`Document ID: ${doc.id}`);
            console.log(`Data:`, JSON.stringify(doc.data(), null, 2));
        });

        const coopSnap = await db.collection("cooperative_members").where("email", "==", email).get();
        console.log(`Found ${coopSnap.size} records in cooperative_members:`);
        coopSnap.docs.forEach(doc => {
            console.log(`Document ID: ${doc.id}`);
            console.log(`Data:`, JSON.stringify(doc.data(), null, 2));
        });
        
        try {
            const authUser = await admin.auth().getUserByEmail(email);
            console.log(`Auth UID: ${authUser.uid}, Email: ${authUser.email}`);
        } catch (e) {
            console.log(`Auth lookup failed for ${email}:`, e.message);
        }
    }
}

main().catch(console.error);
