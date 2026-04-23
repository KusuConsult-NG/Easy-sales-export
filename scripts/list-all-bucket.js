const { initializeApp, cert } = require('firebase-admin/app');
const { getStorage } = require('firebase-admin/storage');
require('dotenv').config({ path: '.env.local' });

let privateKey = process.env.FIREBASE_PRIVATE_KEY;
if (privateKey.startsWith('"')) privateKey = privateKey.slice(1, -1);
privateKey = privateKey.replace(/\\n/g, '\n');

initializeApp({ 
    credential: cert({ 
        projectId: process.env.FIREBASE_PROJECT_ID, 
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL, 
        privateKey 
    }),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
});

const bucket = getStorage().bucket();

async function run() {
    console.log("Scanning ENTIRE Firebase Storage...");
    const [files] = await bucket.getFiles();
    
    let eliteFiles = [];
    files.forEach(f => {
        if(f.name.toLowerCase().includes('elite')) {
            eliteFiles.push(f.name);
        }
    });
    console.log("Files with 'elite' in name:", eliteFiles);
    
    // Group files by top-level directory
    const folders = new Map();
    files.forEach(f => {
        const parts = f.name.split('/');
        const top = parts[0];
        folders.set(top, (folders.get(top) || 0) + 1);
    });
    console.log("Top level folders:", Array.from(folders.entries()));
}
run().catch(console.error);
