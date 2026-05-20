import * as dotenv from 'dotenv';
import { resolve } from 'path';

// Load env files
dotenv.config({ path: resolve(process.cwd(), '.env.local') });
dotenv.config({ path: resolve(process.cwd(), '.env') });

import { getAdminDb } from '../src/lib/firebase-admin';

async function check() {
    const db = getAdminDb();
    
    const collections = ['sms_broadcast_logs', 'broadcast_logs', 'inapp_broadcast_logs', 'audit_logs'];
    for (const coll of collections) {
        try {
            const snap = await db.collection(coll).get();
            console.log(`Collection: ${coll} has ${snap.size} total documents.`);
            if (snap.size > 0) {
                const oldest = await db.collection(coll).orderBy('sentAt', 'asc').limit(1).get();
                if (!oldest.empty) {
                    const data = oldest.docs[0].data();
                    console.log(`  Oldest doc in ${coll}: ${oldest.docs[0].id} from ${data.sentAt?.toDate() || data.createdAt?.toDate() || 'no date'}`);
                }
            }
        } catch (e: any) {
            console.error(`Error reading ${coll}:`, e.message);
        }
    }
}

check().then(() => process.exit(0)).catch(console.error);
