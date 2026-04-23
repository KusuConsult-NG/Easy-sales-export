const { initializeApp, cert } = require('firebase-admin/app');
const { getStorage } = require('firebase-admin/storage');
require('dotenv').config({ path: '.env.local' });
let privateKey = process.env.FIREBASE_PRIVATE_KEY;
if (privateKey.startsWith('"')) privateKey = privateKey.slice(1, -1);
privateKey = privateKey.replace(/\\n/g, '\n');
initializeApp({ credential: cert({ projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey }), storageBucket: process.env.FIREBASE_STORAGE_BUCKET || process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET });
const bucket = getStorage().bucket();

async function run() {
    console.log("Scanning Firebase Storage...");
    const [files] = await bucket.getFiles({ prefix: 'academy/courses/' });
    console.log(`Found ${files.length} files under academy/courses/`);
    files.forEach(f => console.log(f.name));
}
run().catch(console.error);
