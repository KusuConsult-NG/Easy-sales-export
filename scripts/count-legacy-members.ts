import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { db } from '../src/lib/firebase-admin';

async function main() {
    try {
        console.log('Querying cooperatives_invites...');
        const snap = await db.collection('cooperatives_invites').count().get();
        console.log('Total cooperative invites (legacy):', snap.data().count);
        process.exit(0);
    } catch (err) {
        console.error('Error:', err);
        process.exit(1);
    }
}

main();
