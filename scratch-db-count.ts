import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { getAdminDb } from './src/lib/firebase-admin';

async function main() {
  const db = getAdminDb();
  const usersCount = await db.collection('users').count().get();
  console.log('DB Users:', usersCount.data().count);
  
  const coopCount = await db.collection('cooperative_members').count().get();
  console.log('DB Cooperative Members:', coopCount.data().count);

  const usersSnap = await db.collection('users').limit(1).get();
  console.log('Sample User ID:', usersSnap.docs[0]?.id);

  process.exit(0);
}

main().catch(console.error);
