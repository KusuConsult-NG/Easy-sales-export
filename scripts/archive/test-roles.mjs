import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import serviceAccountCredentials from './serviceAccount.json' with { type: 'json' };

initializeApp({
  credential: cert(serviceAccountCredentials)
});

const db = getFirestore();
const auth = getAuth();

async function check() {
  const user = await auth.getUserByEmail('steviekusu@gmail.com');
  console.log('User ID:', user.uid);
  console.log('Roles:', user.customClaims?.roles);
  
  const snap = await db.collection('USERS').doc(user.uid).get();
  console.log('serviceRegistrations:', snap.data().serviceRegistrations);
  process.exit(0);
}
check();
