require('dotenv').config({ path: '.env.production.local' });
const admin = require('firebase-admin');

async function run() {
    let privateKey = process.env.FIREBASE_PRIVATE_KEY;
    if (privateKey.startsWith('"') && privateKey.endsWith('"')) privateKey = privateKey.slice(1, -1);
    if (privateKey.includes('\\n')) privateKey = privateKey.replace(/\\n/g, '\n');

    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: privateKey,
        })
    });

    const db = admin.firestore();
    const email = "steviekusu@gmail.com";

    const userSnapshot = await db.collection("users").where('email', '==', email).limit(1).get();
    if (userSnapshot.empty) {
        console.log("User not found!");
        return;
    }

    const userData = userSnapshot.docs[0].data();
    console.log("Roles:", userData.roles);
    console.log("Service Registrations:", JSON.stringify(userData.serviceRegistrations, null, 2));

}
run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
