import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { db } from '../src/lib/firebase-admin';

async function test() {
    const snap = await db.collection('wave_members').get();
    console.log(`Total wave_members: ${snap.size}`);
}

test().then(() => process.exit(0));
