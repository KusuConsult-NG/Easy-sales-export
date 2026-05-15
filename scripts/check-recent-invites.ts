import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { db } from '../src/lib/firebase-admin';

async function main() {
    try {
        console.log('Querying cooperatives_invites for recent...');
        const snap = await db.collection('cooperatives_invites')
            .orderBy('createdAt', 'desc')
            .limit(10)
            .get();
            
        snap.forEach(doc => {
            const data = doc.data();
            const time = data.createdAt ? data.createdAt.toDate().toISOString() : 'unknown';
            console.log(`- ${time}: ${data.email} (${data.fullName})`);
        });
        
        process.exit(0);
    } catch (err) {
        console.error('Error:', err);
        process.exit(1);
    }
}

main();
