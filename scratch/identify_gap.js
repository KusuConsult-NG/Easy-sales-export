const admin = require("firebase-admin");
const dotenv = require("dotenv");
dotenv.config({ path: ".env.local" });

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, '\n'),
        })
    });
}

const db = admin.firestore();

async function run() {
    const snapshot = await db.collection("users").get();
    
    const missingEmailIds = [];
    const emails = new Map();
    const duplicates = [];

    snapshot.docs.forEach(doc => {
        const d = doc.data();
        const raw = d.email || d.userEmail || "";
        const e = raw.toLowerCase().trim();
        
        if (!e) {
            missingEmailIds.push(doc.id);
        } else {
            if (emails.has(e)) {
                duplicates.push({ email: e, original: emails.get(e), duplicate: doc.id });
            } else {
                emails.set(e, doc.id);
            }
        }
    });

    console.log(JSON.stringify({
        totalDocs: snapshot.size,
        missingEmailCount: missingEmailIds.length,
        missingEmailIds: missingEmailIds,
        duplicateCount: duplicates.length,
        duplicates: duplicates
    }, null, 2));
}

run().catch(err => console.error(err.message));
