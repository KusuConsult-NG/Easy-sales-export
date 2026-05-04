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

const adminEmails = [
    "easysaleswave@gmail.com",
    "easysalescooperative@gmail.com",
    "easysalesmarketplace@gmail.com",
    "easysalesexportwindow@gmail.com",
    "easysalesfarmnation@gmail.com",
    "academy.easysalesexport1@gmail.com"
];

async function checkRoles() {
    for (const email of adminEmails) {
        const snapshot = await db.collection('users').where('email', '==', email).get();
        if (snapshot.empty) {
            console.log(`User ${email} not found.`);
        } else {
            const user = snapshot.docs[0].data();
            console.log(`User ${email}: Roles = `, user.roles);
        }
    }
}

checkRoles().catch(console.error);
