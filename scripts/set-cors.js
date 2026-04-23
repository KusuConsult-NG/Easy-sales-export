const { initializeApp, cert } = require('firebase-admin/app');
const { getStorage } = require('firebase-admin/storage');
require('dotenv').config({ path: '.env.local' });

let privateKey = process.env.FIREBASE_PRIVATE_KEY;
if (privateKey.startsWith('"')) privateKey = privateKey.slice(1, -1);
privateKey = privateKey.replace(/\\n/g, '\n');

initializeApp({ 
    credential: cert({ projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey }),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
});

const bucket = getStorage().bucket();

async function run() {
    try {
        await bucket.setCorsConfiguration([
            {
                origin: ['*'],
                method: ['GET', 'HEAD', 'OPTIONS'],
                responseHeader: ['Content-Type', 'Content-Range', 'Accept-Ranges', 'Content-Length', 'Range'],
                maxAgeSeconds: 3600
            }
        ]);
        console.log('CORS configured successfully!');
        
        // Verify
        const [metadata] = await bucket.getMetadata();
        console.log('CORS config:', JSON.stringify(metadata.cors, null, 2));
    } catch (err) {
        console.error('Failed:', err.message);
    }
}
run().catch(console.error);
