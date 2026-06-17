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
    const emails = ["steviekusu@gmail.com", "hackbabvo@gmail.com"];
    for (const email of emails) {
        console.log(`\n=== User: ${email} ===`);
        const snap = await db.collection("users").where("email", "==", email).get();
        if (snap.empty) {
            console.log("No user found with that email!");
            continue;
        }
        
        snap.docs.forEach(doc => {
            console.log(`Document ID: ${doc.id}`);
            const data = doc.data();
            console.log("Roles:", data.roles);
            console.log("Gender:", data.gender);
            console.log("Status:", data.status);
        });
    }
}

main().catch(console.error);
