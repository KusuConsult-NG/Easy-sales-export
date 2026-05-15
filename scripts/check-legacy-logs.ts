import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { db } from '../src/lib/firebase-admin';

async function main() {
    try {
        console.log('Querying audit logs for legacy_member_import...');
        const snap = await db.collection('audit_logs')
            .where('action', '==', 'legacy_member_import')
            .get();
            
        const count = snap.size;
        console.log(`Found ${count} legacy_member_import logs.`);
        
        process.exit(0);
    } catch (err) {
        console.error('Error:', err);
        process.exit(1);
    }
}

main();
