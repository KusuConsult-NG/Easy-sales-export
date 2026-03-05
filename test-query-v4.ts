import { getAdminDb } from './src/lib/firebase-admin';
import { config } from 'dotenv';
config({ path: '.env.local' });
const db = getAdminDb();

async function check() {
  console.log('Fetching sample user...');
  const snap = await db.collection('users').limit(1).get();
  if (!snap.empty) {
      console.log(JSON.stringify(snap.docs[0].data(), null, 2));
  }
}
check().then(() => process.exit(0));
