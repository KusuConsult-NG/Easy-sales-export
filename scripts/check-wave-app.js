require('dotenv').config({ path: '.env.production.local' });
const admin = require('firebase-admin');

async function run() {
    let privateKey = process.env.FIREBASE_PRIVATE_KEY;
    if (privateKey.startsWith('"') && privateKey.endsWith('"')) privateKey = privateKey.slice(1, -1);
    // Fixed parsing issue in my previous scripts to be safe
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
    if(userSnapshot.empty) {
        console.log("User not found!");
        return;
    }
    
    const userData = userSnapshot.docs[0].data();
    const waveAppId = userData.serviceRegistrations?.wave?.applicationId;
    console.log("User wave status in user profile:", userData.serviceRegistrations?.wave?.status);
    console.log("Wave Application ID:", waveAppId);

    if (waveAppId) {
        const appDoc = await db.collection("wave_applications").doc(waveAppId).get();
        if (appDoc.exists) {
            console.log("Wave App data:", appDoc.data());
        } else {
            console.log("Wave App not found directly by ID");
        }
    } else {
        const appsRef = await db.collection("wave_applications").where("userId", "==", userSnapshot.docs[0].id).get();
        appsRef.forEach(d => {
            console.log("Found app:", d.data());
        });
    }

}

run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
