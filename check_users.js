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
    const email = "hadizasabo38@gmail.com";
    console.log(`=== SEARCHING FOR SELLER WITH EMAIL: ${email} ===`);
    const usersSnap = await db.collection("users").where("email", "==", email).get();
    console.log(`Found ${usersSnap.size} user records:`);
    usersSnap.docs.forEach(doc => {
        console.log(`Document ID: ${doc.id}`);
        console.log(`Data:`, JSON.stringify(doc.data(), null, 2));
    });
}

main().catch(console.error);
