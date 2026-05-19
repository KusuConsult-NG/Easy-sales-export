import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { getAdminAuth, db } from './src/lib/firebase-admin';

async function run() {
    const auth = getAdminAuth();
    const user = await auth.getUserByEmail("easysalescooperative@gmail.com");
    const doc = await db.collection("USERS").doc(user.uid).get();
    console.log("easysalescooperative@gmail.com User Doc:", doc.data());
}

run().catch(console.error);
