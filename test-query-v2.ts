import { getAdminDb } from './src/lib/firebase-admin';
import { config } from 'dotenv';
config({ path: '.env.local' });

const db = getAdminDb();

async function check() {
  // Option 1: Find users with payment_links/intents that are unresolved
  // Option 2: Find users who created an account right before the bug was fixed
  
  // Let's check the 'cooperative_transactions' or 'transactions' table
  const txRef = db.collection('transactions');
  const snap = await txRef.where('module', '==', 'cooperative').where('status', '==', 'abandoned').get();
  
  let validTargets = [];
  
  for (const doc of snap.docs) {
      const data = doc.data();
      if (data.userId) {
          const userDoc = await db.collection('users').doc(data.userId).get();
          if (userDoc.exists && userDoc.data()?.email) {
             const memberDoc = await db.collection('cooperative_members').doc(data.userId).get();
             if (!memberDoc.exists || memberDoc.data()?.paymentStatus !== 'completed') {
                  validTargets.push({ email: userDoc.data().email, name: userDoc.data().fullName });
             }
          }
      }
  }
  
  console.log('Targeted via transactions:', validTargets.length);
  if (validTargets.length > 0) {
      console.log('Sample:', validTargets.slice(0, 3));
  }
}

check().then(() => process.exit(0));
