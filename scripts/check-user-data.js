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
    
    // Find the most recently submitted WAVE applications to see how they are structured
    console.log("--- MOST RECENT WAVE APPLICATIONS ---");
    const apps = await db.collection('wave_applications').orderBy('createdAt', 'desc').limit(3).get();
    apps.forEach(doc => {
        const d = doc.data();
        console.log(`App ID: ${doc.id}, User ID: ${d.userId}, Email: ${d.userEmail}`);
    });
    console.log("---------------------------------------");
    
    // Look up the most recent user document
    console.log("--- USER PROFILES OF THOSE APPLICANTS ---");
    for (const doc of apps.docs) {
        const uid = doc.data().userId;
        if(uid) {
            const userDoc = await db.collection('users').doc(uid).get();
            if(userDoc.exists) {
                const u = userDoc.data();
                console.log(`User ${uid} (${u.email}): serviceRegistrations =`, JSON.stringify(u.serviceRegistrations, null, 2));
            } else {
                console.log(`User ${uid} does not exist in 'users' collection!`);
            }
        }
    }

}
run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
