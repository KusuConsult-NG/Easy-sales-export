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
  const q = db.collection('academy_applications').orderBy("submittedAt", "desc").limit(2000);
  const snap = await q.get();
  console.log(`Query returned docs: ${snap.docs.length}`);
}

run().catch(console.error).then(() => process.exit(0));
