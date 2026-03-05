import { getAdminDb } from './src/lib/firebase-admin';
import { config } from 'dotenv';
config({ path: '.env.local' });
const db = getAdminDb();

async function check() {
  console.log('Querying limited subset for safety...');
  const usersRef = db.collection('users');
  const snap = await usersRef.limit(100).get(); // Scan only 100 for safety
  
  let targeted = 0;
  
  for (const doc of snap.docs) {
      const data = doc.data();
      if (data.cooperativeId) {
          const memberDoc = await db.collection('cooperative_members').doc(doc.id).get();
          if (!memberDoc.exists || memberDoc.data()?.paymentStatus !== 'completed') {
             targeted++;
          }
      }
  }
  console.log(`Out of 100 users, ${targeted} possess an abandoned checkout trace.`);
}
check().then(() => process.exit(0));
