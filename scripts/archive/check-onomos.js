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
  console.log("=== CHECKING ONOMOSOFFICE@GMAIL.COM ===");
  
  // 1. Search in users collection
  const usersSnap = await db.collection('users').where('email', '==', 'onomosoffice@gmail.com').get();
  console.log(`Users found with email: ${usersSnap.docs.length}`);
  for (const doc of usersSnap.docs) {
    console.log(`User Doc ID: ${doc.id}`);
    console.log("User Data:", JSON.stringify(doc.data(), null, 2));
  }

  // 2. Search in cooperative_members collection
  const coopSnap = await db.collection('cooperative_members').where('email', '==', 'onomosoffice@gmail.com').get();
  console.log(`\nCooperative members found with email field: ${coopSnap.docs.length}`);
  for (const doc of coopSnap.docs) {
    console.log(`Coop Member Doc ID: ${doc.id}`);
    console.log("Coop Member Data:", JSON.stringify(doc.data(), null, 2));
  }

  if (usersSnap.docs.length > 0) {
    const userId = usersSnap.docs[0].id;
    console.log(`\nSearching in cooperative_members by userId: ${userId}`);
    const coopSnapByUid = await db.collection('cooperative_members').where('userId', '==', userId).get();
    console.log(`Cooperative members found with userId: ${coopSnapByUid.docs.length}`);
    for (const doc of coopSnapByUid.docs) {
      console.log(`Coop Member Doc ID: ${doc.id}`);
      console.log("Coop Member Data:", JSON.stringify(doc.data(), null, 2));
    }
  }
}

run().catch(console.error).then(() => process.exit(0));
