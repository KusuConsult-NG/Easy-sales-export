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
  const snap = await db.collection('academy_applications').get();
  console.log(`Total apps: ${snap.docs.length}`);
  let missingSubmitted = 0;
  let missingCreated = 0;
  for (const doc of snap.docs) {
    const d = doc.data();
    if (!d.submittedAt) missingSubmitted++;
    if (!d.createdAt) missingCreated++;
  }
  console.log(`Missing submittedAt: ${missingSubmitted}`);
  console.log(`Missing createdAt: ${missingCreated}`);
}

run().catch(console.error).then(() => process.exit(0));
