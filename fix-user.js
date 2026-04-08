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
  const q = await db.collection('users').where('email', '==', 'steviekusu@gmail.com').get();
  if (q.empty) { console.log('not found'); return; }
  
  const docRef = q.docs[0].ref;
  const currentRoles = q.docs[0].data().roles || [];
  
  // Filter out admin roles
  const newRoles = currentRoles.filter(r => r !== 'admin' && r !== 'super_admin');
  
  await docRef.update({
    roles: newRoles,
    role: 'general_user' // change legacy field as well
  });
  
  console.log('Roles updated to', newRoles);
}
run();
