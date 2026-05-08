const admin = require("firebase-admin");
const serviceAccount = require("./service-account.json"); // I hope this exists or I can use env

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

const db = admin.firestore();

async function run() {
    const snapshot = await db.collection("users").get();
    console.log("Total Docs:", snapshot.size);
    
    let noEmail = 0;
    const emails = new Set();
    let dups = 0;

    snapshot.docs.forEach(doc => {
        const d = doc.data();
        const e = (d.email || d.userEmail || "").toLowerCase().trim();
        if (!e) {
            noEmail++;
        } else {
            if (emails.has(e)) {
                dups++;
            } else {
                emails.add(e);
            }
        }
    });

    console.log("No Email:", noEmail);
    console.log("Duplicates:", dups);
    console.log("Total Unique:", emails.size);
    console.log("Disparity Sum:", noEmail + dups);
}

run();
