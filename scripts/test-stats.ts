import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { db } from '../src/lib/firebase-admin';

async function test() {
    const snap = await db.collection('USERS').get();
    let count = 0;
    snap.docs.forEach(doc => {
        const d = doc.data();
        if (d.roles && d.roles.includes('cooperative_member')) {
            count++;
        }
    });
    console.log(`Users with cooperative_member role: ${count}`);
}

test().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
