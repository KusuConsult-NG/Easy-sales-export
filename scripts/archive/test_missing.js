const admin = require('firebase-admin');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

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

async function run() {
    const allDocs = await db.collection('academy_applications').get();
    console.log("Total docs in DB:", allDocs.docs.length);
    let missingCount = 0;
    allDocs.docs.forEach(doc => {
        if (!doc.data().submittedAt) {
            missingCount++;
        }
    });
    console.log("Missing submittedAt:", missingCount);

    const qWithOrder = await db.collection('academy_applications').orderBy('submittedAt', 'desc').get();
    console.log("Docs returned by orderBy(submittedAt):", qWithOrder.docs.length);
}

run().catch(console.error).then(() => process.exit(0));
