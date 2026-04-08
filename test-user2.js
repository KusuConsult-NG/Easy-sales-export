const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
require('dotenv').config({ path: '.env.local' });

const serviceAccount = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
};

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

async function run() {
  const q = await db.collection('users').get();
  const docs = q.docs.filter(d => {
    const data = d.data();
    return data.email && data.email.includes('stevie');
  });
  if (docs.length === 0) { console.log('user not found among', q.docs.length, 'users'); return; }
  console.log(JSON.stringify(docs[0].data(), null, 2));
}
run();
