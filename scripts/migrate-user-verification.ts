
import * as admin from 'firebase-admin';
import { getApps } from 'firebase-admin/app';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

// Service Account setup
// Service Account setup
let serviceAccount;

if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
} else if (process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_CLIENT_EMAIL) {
    serviceAccount = {
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY!.replace(/\\n/g, '\n'),
    };
} else {
    serviceAccount = require(path.resolve(__dirname, '../service-account-key.json'));
}

if (!getApps().length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
    });
}

const db = admin.firestore();

async function migrateUsers() {
    console.log('Starting migration...');
    const usersRef = db.collection('users');
    const snapshot = await usersRef.get();

    let updatedCount = 0;
    const batchSize = 500;
    let batch = db.batch();
    let opCount = 0;

    for (const doc of snapshot.docs) {
        const userData = doc.data();
        const roles = userData.roles || [];
        let isVerified = userData.isVerified;
        let needsUpdate = false;

        // Logic:
        // 1. If user has a "privileged" role (seller, exporter, etc.), they MUST be verified.
        // 2. If user is just 'general_user' or has no roles, they are NOT verified (unless explicitly set).
        // 3. Actually, per new flow: "Login doesn't need approval". 
        //    So `isVerified` is less critical for login, BUT it is critical for ROLE access.
        //    We should ensure that anyone with a privileged role is marked as verified.

        const privilegedRoles = [
            'seller',
            'export_participant',
            'cooperative_member',
            'wave_participant',
            'academy_participant',
            'farmer',
            'consultant',
            'admin',
            'super_admin'
        ];

        const hasPrivilegedRole = roles.some((r: string) => privilegedRoles.includes(r));

        if (hasPrivilegedRole && isVerified !== true) {
            console.log(`Verifying user ${doc.id} (Roles: ${roles.join(', ')})`);
            isVerified = true;
            needsUpdate = true;
        } else if (!hasPrivilegedRole && isVerified === undefined) {
            // Set default for new users/legacy users without status
            isVerified = false;
            needsUpdate = true;
        }

        if (needsUpdate) {
            batch.update(doc.ref, {
                isVerified: isVerified,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            opCount++;
            updatedCount++;
        }

        if (opCount >= batchSize) {
            await batch.commit();
            batch = db.batch();
            opCount = 0;
            console.log(`Committed batch of ${batchSize} updates.`);
        }
    }

    if (opCount > 0) {
        await batch.commit();
        console.log(`Committed final batch of ${opCount} updates.`);
    }

    console.log(`Migration complete. Updated ${updatedCount} users.`);
}

migrateUsers().catch(console.error);
