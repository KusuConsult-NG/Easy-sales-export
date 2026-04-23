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
    // Scan ALL files under academy/
    const [files] = await bucket.getFiles({ prefix: 'academy/' });
    
    console.log(`Total files under academy/: ${files.length}\n`);
    
    files.forEach((f, i) => {
        const name = f.name.split('/').pop();
        const size = (parseInt(f.metadata.size) / (1024 * 1024)).toFixed(2);
        const date = new Date(f.metadata.timeCreated).toLocaleDateString();
        console.log(`${i + 1}. ${name} (${size} MB, uploaded ${date})`);
    });
}
run().catch(console.error);
