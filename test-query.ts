import { getAdminDb } from './src/lib/firebase-admin';
import { config } from 'dotenv';
config({ path: '.env.local' });

const db = getAdminDb();

async function check() {
  const usersRef = db.collection('users');
  const snap = await usersRef.get();
  
  let validTargets = [];
  
  for (const doc of snap.docs) {
      const data = doc.data();
      
      // If a user has a cooperativeId, they clicked 'Join' and generated a session
      if (data.cooperativeId && data.email) {
         // Query members list directly
         const memberDoc = await db.collection('cooperative_members').doc(doc.id).get();
         if (!memberDoc.exists || memberDoc.data()?.paymentStatus !== 'completed') {
             validTargets.push({ id: doc.id, email: data.email, name: data.fullName || data.firstName || 'Member' });
         }
      }
  }
  
  console.log('Total targeted abandoned users:', validTargets.length);
  if (validTargets.length > 0) {
      console.log('Sample:', validTargets.slice(0, 3));
  }
}

check().then(() => process.exit(0));
