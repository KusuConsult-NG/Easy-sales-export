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
    
    console.log("Starting Backfill for WAVE Applications...");
    const waveApps = await db.collection('wave_applications').get();
    let updated = 0;

    for (const doc of waveApps.docs) {
        const data = doc.data();
        const uid = data.userId;
        const status = data.status || "pending";
        
        if (uid) {
            const userRef = db.collection('users').doc(uid);
            const userDoc = await userRef.get();
            
            if (userDoc.exists) {
                const userData = userDoc.data();
                const existingStatus = userData.serviceRegistrations?.wave?.status;
                
                if (!existingStatus) {
                    await userRef.update({
                        "serviceRegistrations.wave.status": status,
                        "serviceRegistrations.wave.applicationId": doc.id,
                        "serviceRegistrations.wave.submittedAt": data.applicationDate || admin.firestore.FieldValue.serverTimestamp()
                    });
                    console.log(`Linked WAVE application ${doc.id} to user ${uid} (${status})`);
                    updated++;
                }
            }
        }
    }
    
    console.log(`Backfilled ${updated} WAVE applications.`);
}
run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
