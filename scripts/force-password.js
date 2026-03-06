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

const auth = admin.auth();

async function forcePassword() {
    try {
        const user = await auth.getUserByEmail('steviekusu@gmail.com');
        await auth.updateUser(user.uid, { password: 'Password123!' });
        console.log('Successfully forced steviekusu@gmail.com password to Password123!');
    } catch (e) {
        console.error('Failed to force password:', e);
    }
    process.exit(0);
}

forcePassword();
