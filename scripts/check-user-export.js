
require("dotenv").config({ path: ".env.local" });
const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

let privateKey = process.env.FIREBASE_PRIVATE_KEY;
if (privateKey && privateKey.startsWith('"') && privateKey.endsWith('"')) {
    privateKey = privateKey.slice(1, -1);
}
if (privateKey && privateKey.includes('\\n')) {
    privateKey = privateKey.replace(/\\n/g, '\n');
}

if (!getApps().length) {
    initializeApp({
        credential: cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: privateKey,
        }),
    });
}

const db = getFirestore();

async function checkUser(email) {
    const snap = await db.collection("users").where("email", "==", email).get();
    if (snap.empty) {
        console.log("User not found in 'users' collection");
        return;
    }
    const user = snap.docs[0].data();
    console.log("User ID:", snap.docs[0].id);
    console.log("Roles:", user.roles);
    console.log("Service Registrations:", JSON.stringify(user.serviceRegistrations, null, 2));
    
    // Check if they have an approved Export application
    const appSnap = await db.collection("EXPORT_APPLICATIONS").where("userId", "==", snap.docs[0].id).get();
    if (appSnap.empty) {
        console.log("No Export Application found");
    } else {
        const app = appSnap.docs[0].data();
        console.log("Export Application Status:", app.status);
        console.log("Application ID:", appSnap.docs[0].id);
    }
}

checkUser("exportwindowuser@gmail.com").catch(console.error);
