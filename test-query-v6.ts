import { getAdminDb } from './src/lib/firebase-admin';
import { config } from 'dotenv';
config({ path: '.env.local' });
const db = getAdminDb();

async function check() {
  console.log('Querying Paystack abandoned transactions logs directly...');
  const txRef = db.collection('transactions');
  
  // Paystack webhook or initialization should log an intent in transactions
  const snap = await txRef
      .where('module', '==', 'cooperative')
      .orderBy('createdAt', 'desc')
      .limit(500)
      .get();
  
  let validTargets = [];
  
  for (const doc of snap.docs) {
      const data = doc.data();
      if (data.status !== 'success' && data.userId) {
          const userDoc = await db.collection('users').doc(data.userId).get();
          
          if (userDoc.exists && userDoc.data()?.email) {
             // Final safety check: ensure they didn't pay in a separate attempt
             const memberDoc = await db.collection('cooperative_members').doc(data.userId).get();
             if (!memberDoc.exists || memberDoc.data()?.paymentStatus !== 'completed') {
                 // Add user, ensuring no duplicates if they tried 5 times
                 if (!validTargets.find(t => t.id === data.userId)) {
                     validTargets.push({ 
                         id: data.userId, 
                         email: userDoc.data()!.email, 
                         name: userDoc.data()!.fullName || userDoc.data()!.firstName || 'Member' 
                     });
                 }
             }
          }
      }
  }
  
  console.log(`Discovered ${validTargets.length} unique abandoned users via transactions.`);
  if (validTargets.length > 0) {
      console.log('Sample:', validTargets.slice(0, 2));
  }
}
check().then(() => process.exit(0));
