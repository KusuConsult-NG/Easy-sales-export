const admin = require('firebase-admin');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const privateKey = process.env.FIREBASE_PRIVATE_KEY
    ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    : undefined;

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: privateKey,
        }),
    });
}

const db = admin.firestore();
const auth = admin.auth();

const TARGET_EMAIL = process.argv[2] || 'steviekusu@gmail.com';
const ROLE = process.argv[3] || 'super_admin';
const TEMP_PASSWORD = 'Password123!';

async function createAdmin() {
    try {
        console.log(`Checking if user ${TARGET_EMAIL} exists...`);
        let userRecord;
        try {
            userRecord = await auth.getUserByEmail(TARGET_EMAIL);
            console.log('User exists in Auth.');
        } catch (e) {
            if (e.code === 'auth/user-not-found') {
                console.log('User not found. Creating user in Auth...');
                userRecord = await auth.createUser({
                    email: TARGET_EMAIL,
                    password: TEMP_PASSWORD,
                    emailVerified: true,
                    displayName: TARGET_EMAIL.split('@')[0],
                });
                console.log(`Created user in Auth with UID: ${userRecord.uid}`);
            } else {
                throw e;
            }
        }

        const userId = userRecord.uid;

        console.log(`Setting custom claims for ${userId}...`);
        await auth.setCustomUserClaims(userId, {
            role: ROLE,
            admin: true,
            superAdmin: true,
        });

        console.log(`Creating/Updating user document in Firestore...`);
        await db.collection('users').doc(userId).set({
            email: TARGET_EMAIL,
            fullName: TARGET_EMAIL.split('@')[0],
            role: ROLE,
            roles: admin.firestore.FieldValue.arrayUnion(ROLE),
            status: 'active',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            isEmailVerified: true,
        }, { merge: true });

        console.log(`Creating admin_users record...`);
        await db.collection('admin_users').doc(userId).set({
            email: TARGET_EMAIL,
            role: ROLE,
            permissions: ['*'],
            grantedAt: admin.firestore.FieldValue.serverTimestamp(),
            grantedBy: 'system',
        }, { merge: true });

        console.log('\n✅ SUCCESS: User steviekusu@gmail.com has been created and promoted to super_admin.');
        console.log(` Temporary password: ${TEMP_PASSWORD}\n`);

    } catch (e) {
        console.error('❌ Error:', e.message);
    }
    process.exit(0);
}

createAdmin();
