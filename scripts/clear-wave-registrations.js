import admin from 'firebase-admin';
import fs from 'fs';

// Initialize Firebase
const serviceAccount = JSON.parse(fs.readFileSync('./service-account.json', 'utf8'));
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

async function clearBriefingRegistrations() {
    console.log('Clearing wave_briefing_registrations...');
    const snapshot = await db.collection('wave_briefing_registrations').get();

    if (snapshot.empty) {
        console.log('No registrations found.');
        return;
    }

    const batch = db.batch();
    snapshot.docs.forEach((doc) => {
        batch.delete(doc.ref);
    });

    await batch.commit();
    console.log(`Deleted \${snapshot.size} registration(s).`);
}

clearBriefingRegistrations().catch(console.error).finally(() => process.exit(0));
