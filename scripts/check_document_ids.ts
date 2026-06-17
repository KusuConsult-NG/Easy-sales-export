import * as fs from "fs";
import * as admin from "firebase-admin";

function loadEnv(filePath: string) {
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
    console.log("=== CHECKING FOR EMAIL-LIKE DOCUMENT IDs IN USERS COLLECTION ===");
    const snap = await db.collection("users").get();
    let count = 0;
    snap.docs.forEach(doc => {
        const id = doc.id;
        if (id.includes("@")) {
            console.log(`Found email ID: ${id}`);
            console.log("Data:", JSON.stringify(doc.data(), null, 2));
            count++;
        }
    });
    console.log(`Total email-like document IDs found: ${count}`);
}

main().catch(console.error);
