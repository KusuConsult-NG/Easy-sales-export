console.log('starting');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
require('dotenv').config({ path: '.env.local' });

console.log('got config, project=', process.env.FIREBASE_PROJECT_ID);

const serviceAccount = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
};

try {
  initializeApp({ credential: cert(serviceAccount) });
  const db = getFirestore();
  console.log('initialized');

  async function run() {
    const q = await db.collection('users').limit(1).get();
    console.log('got users:', q.docs.length);
  }
  run().catch(console.error);
} catch(e) {
  console.error('err', e);
}
