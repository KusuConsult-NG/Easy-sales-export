import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { getAuth } from 'firebase-admin/auth';
import * as admin from 'firebase-admin';

// Initialize firebase admin if not done
if (!admin.apps.length) {
    let cert: any = process.env.FIREBASE_SERVICE_ACCOUNT_KEY || process.env.FIREBASE_ADMIN_CREDENTIALS;
    if (cert) {
        try { cert = JSON.parse(cert); } catch(e) {}
        admin.initializeApp({ credential: admin.credential.cert(cert) });
    } else {
        admin.initializeApp();
    }
}

async function main() {
    try {
        console.log('Querying recent users from Firebase Auth...');
        const listUsersResult = await getAuth().listUsers(100);
        
        let count = 0;
        const now = Date.now();
        listUsersResult.users.forEach((userRecord) => {
            const creationTime = new Date(userRecord.metadata.creationTime).getTime();
            // Users created in the last 2 days
            if (now - creationTime < 2 * 24 * 60 * 60 * 1000) {
                console.log(`- Created at ${userRecord.metadata.creationTime}: ${userRecord.email} (${userRecord.displayName})`);
                count++;
            }
        });
        console.log(`Found ${count} users created in the last 2 days.`);
        
        process.exit(0);
    } catch (err) {
        console.error('Error:', err);
        process.exit(1);
    }
}

main();
