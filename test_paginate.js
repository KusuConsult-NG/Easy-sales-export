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
  const q1 = db.collection('academy_applications').orderBy('submittedAt', 'desc').limit(50);
  const snap1 = await q1.get();
  console.log('Page 1:', snap1.docs.length);

  const lastDoc = snap1.docs[snap1.docs.length - 1];
  const q2 = db.collection('academy_applications').orderBy('submittedAt', 'desc').startAfter(lastDoc).limit(50);
  const snap2 = await q2.get();
  console.log('Page 2:', snap2.docs.length);
  
  console.log('Total paginated:', snap1.docs.length + snap2.docs.length);
}

run().catch(console.error).then(() => process.exit(0));
