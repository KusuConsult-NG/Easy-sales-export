const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');
require('dotenv').config({ path: '.env.local' });

let privateKey = process.env.FIREBASE_PRIVATE_KEY;
if (privateKey.startsWith('"')) privateKey = privateKey.slice(1, -1);
privateKey = privateKey.replace(/\\n/g, '\n');

initializeApp({ 
    credential: cert({ projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey }),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
});

const db = getFirestore();
const bucket = getStorage().bucket();

async function getDownloadUrl(filePath) {
    const file = bucket.file(filePath);
    const [metadata] = await file.getMetadata();
    const token = metadata.metadata?.firebaseStorageDownloadTokens;
    if (token) {
        return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(filePath)}?alt=media&token=${token}`;
    }
    // Generate a new token via signed URL (long-lived)
    const [signedUrl] = await file.getSignedUrl({
        action: 'read',
        expires: '03-01-2030',
    });
    return signedUrl;
}

async function run() {
    const doc = await db.collection('academy_courses').doc('5s1LUqnXM1N81ad2Bb18').get();
    const data = doc.data();
    const modules = data.modules || [];
    
    if (modules.length === 0) {
        console.log("No modules found");
        return;
    }
    
    const mod = modules[0];
    let fixed = 0;
    
    for (const lesson of mod.lessons) {
        // Extract the storage path from the old URL
        const urlFields = ['videoUrl', 'documentUrl', 'excelUrl'];
        
        for (const field of urlFields) {
            if (lesson[field]) {
                try {
                    // Extract path from URL
                    const urlObj = new URL(lesson[field]);
                    const encodedPath = urlObj.pathname.split('/o/')[1];
                    if (!encodedPath) continue;
                    const storagePath = decodeURIComponent(encodedPath);
                    
                    const newUrl = await getDownloadUrl(storagePath);
                    lesson[field] = newUrl;
                    fixed++;
                    console.log(`Fixed: ${lesson.title} (${field})`);
                } catch (err) {
                    console.error(`Failed for ${lesson.title} ${field}:`, err.message);
                }
            }
        }
        
        // Also fix content field if it contains a storage URL
        if (lesson.content && lesson.content.includes('firebasestorage.googleapis.com')) {
            try {
                const urlObj = new URL(lesson.content);
                const encodedPath = urlObj.pathname.split('/o/')[1];
                if (encodedPath) {
                    const storagePath = decodeURIComponent(encodedPath);
                    lesson.content = await getDownloadUrl(storagePath);
                }
            } catch (err) {}
        }
    }
    
    await db.collection('academy_courses').doc('5s1LUqnXM1N81ad2Bb18').update({
        modules: [mod],
        updatedAt: FieldValue.serverTimestamp(),
    });
    
    console.log(`\nFixed ${fixed} URLs with proper access tokens.`);
}
run().catch(console.error);
