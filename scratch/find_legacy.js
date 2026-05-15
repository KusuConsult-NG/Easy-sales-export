const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const serviceAccount = require('../service-account.json');

initializeApp({
  credential: cert(serviceAccount)
});

const db = getFirestore();

async function findUser() {
  const email = 'yangedoris40@gmail.com';
  console.log(`Searching for ${email}...`);

  const collections = ['users', 'legacyMembers', 'serviceRegistrations'];
  
  for (const col of collections) {
    const snapshot = await db.collection(col).where('email', '==', email).get();
    console.log(`\nCollection: ${col} - Found ${snapshot.size} records`);
    snapshot.forEach(doc => {
      console.log(doc.id, '=>', JSON.stringify(doc.data(), null, 2));
    });
  }
}

findUser().catch(console.error);
