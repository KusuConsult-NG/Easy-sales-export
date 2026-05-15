import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { db } from '../src/lib/firebase-admin';

async function main() {
    try {
        console.log('Querying most recent 5 users...');
        const usersSnap = await db.collection('users').orderBy('createdAt', 'desc').limit(5).get();
        usersSnap.forEach(doc => {
            const data = doc.data();
            const time = data.createdAt ? data.createdAt.toDate().toISOString() : 'unknown';
            console.log(`- User: ${data.email} (${data.fullName}) at ${time}`);
        });

        console.log('\nQuerying most recent 5 cooperative members...');
        const coopSnap = await db.collection('cooperative_members').orderBy('createdAt', 'desc').limit(5).get();
        coopSnap.forEach(doc => {
            const data = doc.data();
            const time = data.createdAt ? data.createdAt.toDate().toISOString() : 'unknown';
            console.log(`- Coop: ${data.email} (${data.fullName}) at ${time}`);
        });

        process.exit(0);
    } catch (err) {
        console.error('Error:', err);
        process.exit(1);
    }
}

main();
