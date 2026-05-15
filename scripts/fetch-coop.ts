import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { db } from '../src/lib/firebase-admin';

async function main() {
    try {
        console.log('Fetching most recent cooperative member...');
        const coopSnap = await db.collection('cooperative_members').orderBy('createdAt', 'desc').limit(2).get();
        coopSnap.forEach(doc => {
            console.log(doc.id, '=>', JSON.stringify(doc.data(), null, 2));
        });
        process.exit(0);
    } catch (err) {
        console.error('Error:', err);
        process.exit(1);
    }
}

main();
