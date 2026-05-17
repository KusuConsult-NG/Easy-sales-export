import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { db } from '../src/lib/firebase-admin';

async function test() {
    const collections = await db.listCollections();
    console.log(collections.map(c => c.id).sort());
}

test().then(() => process.exit(0));
