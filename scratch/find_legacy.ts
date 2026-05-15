import { getAdminDb } from '../src/lib/firebase-admin';

async function findUser() {
  const db = getAdminDb();
  const email = 'yangedoris40@gmail.com';
  console.log(`Searching for ${email}...`);

  const collections = ['users', 'legacyMembers', 'serviceRegistrations', 'legacy_forms', 'legacyForms'];
  
  for (const col of collections) {
    const snapshot = await db.collection(col).where('email', '==', email).get();
    console.log(`\nCollection: ${col} - Found ${snapshot.size} records`);
    snapshot.forEach(doc => {
      console.log(doc.id, '=>', JSON.stringify(doc.data(), null, 2));
    });
  }
  
  process.exit(0);
}

findUser().catch(e => {
  console.error(e);
  process.exit(1);
});
