const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
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

const db = getFirestore();
const bucket = getStorage().bucket();

async function run() {
    console.log("Scanning Firebase Storage for lost course materials...");
    const coursesSnap = await db.collection('academy_courses').get();
    
    for (const doc of coursesSnap.docs) {
        const courseId = doc.id;
        const data = doc.data();
        
        // Skip if modules already exist and are not empty
        if (data.modules && data.modules.length > 0) {
            console.log(`Course ${courseId} already has modules. Skipping.`);
            continue;
        }

        const prefix = `academy/courses/${courseId}/materials/`;
        const [files] = await bucket.getFiles({ prefix });
        
        if (files.length === 0) {
            console.log(`No files found for course ${courseId}`);
            continue;
        }

        console.log(`Found ${files.length} files for course ${courseId}: "${data.title}"`);
        
        const newModules = [];
        let lessonOrder = 0;
        
        for (const file of files) {
            // Check file type by extension or content type
            const isVideo = file.name.match(/\.(mp4|mov|avi|wmv|flv|mkv)$/i);
            const isExcel = file.name.match(/\.(xls|xlsx|csv)$/i);
            const isDoc = file.name.match(/\.(pdf|doc|docx|ppt|pptx)$/i);
            
            const type = isVideo ? 'video' : (isExcel ? 'excel' : (isDoc ? 'document' : 'text'));
            
            // Try to make the URL public or get the download URL. 
            // In Firebase Storage, if it's public we can construct the URL.
            // Actually, we can just construct the standard public URL or use getSignedUrl/getDownloadURL.
            // In typical Firebase setups, the token is added, but often the download URL is just:
            // https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(file.name)}?alt=media
            
            const fileUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(file.name)}?alt=media`;
            const fileName = file.name.split('/').pop();
            
            // Create a module for each file or group them. Let's create one module called "Recovered Materials"
            // and put all lessons inside it.
            
            const lesson = {
                id: `l-recovered-${Date.now()}-${lessonOrder}`,
                title: `Recovered: ${fileName}`,
                content: fileUrl,
                duration: '00:00',
                order: lessonOrder,
                type: type === 'document' ? 'text' : type,
            };
            
            if (isVideo) lesson.videoUrl = fileUrl;
            if (isExcel) lesson.excelUrl = fileUrl;
            if (isDoc || type === 'text') lesson.documentUrl = fileUrl;
            
            lessonOrder++;
            
            if (newModules.length === 0) {
                newModules.push({
                    id: `m-recovered-${Date.now()}`,
                    title: `Recovered Course Materials`,
                    description: `Automatically recovered materials from storage`,
                    order: 0,
                    lessons: [lesson]
                });
            } else {
                newModules[0].lessons.push(lesson);
            }
        }
        
        if (newModules.length > 0) {
            await doc.ref.update({ modules: newModules });
            console.log(`Successfully restored ${lessonOrder} lessons to course ${courseId}`);
        }
    }
}

run().catch(console.error);
