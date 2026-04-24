const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

// Since we can't easily import a Next.js server module, we will replicate getStandardAcademyApplicationsAction logic.
const admin = require('firebase-admin');

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
  const countSnap = await db.collection('academy_applications').count().get();
  console.log(`Stats count: ${countSnap.data().count}`);

  const q = db.collection('academy_applications').orderBy('submittedAt', 'desc').limit(5000);
  const snap = await q.get();
  console.log(`Query count: ${snap.docs.length}`);

  let missingSubmittedAt = 0;
  for (let doc of snap.docs) {
    if (!doc.data().submittedAt) missingSubmittedAt++;
  }
  console.log(`Missing submittedAt: ${missingSubmittedAt}`);
}

run().catch(console.error).then(() => process.exit(0));
