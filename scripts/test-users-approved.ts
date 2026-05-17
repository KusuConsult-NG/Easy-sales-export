import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { db } from '../src/lib/firebase-admin';

async function test() {
    const snap = await db.collection('USERS').where('status', '==', 'approved').get();
    console.log(`Users with status 'approved': ${snap.size}`);
}

test().then(() => process.exit(0));
