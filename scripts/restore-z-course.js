const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
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
    const courseId = 'ZzQP201ask3MK4yVMMUX';
    
    console.log("Restoring deleted course and fetching files from Storage...");
    
    const prefix = `academy/courses/${courseId}/materials/`;
    const [files] = await bucket.getFiles({ prefix });
    
    console.log(`Found ${files.length} files. Grouping them...`);
    
    // Sort files by creation or filename
    files.sort((a, b) => a.name.localeCompare(b.name));
    
    const lessons = [];
    let order = 0;
    
    for (const file of files) {
        const isVideo = file.name.match(/\.(mp4|mov|avi|wmv|flv|mkv)$/i);
        const isExcel = file.name.match(/\.(xls|xlsx|csv)$/i);
        const isDoc = file.name.match(/\.(pdf|doc|docx|ppt|pptx)$/i);
        
        const type = isVideo ? 'video' : (isExcel ? 'excel' : (isDoc ? 'document' : 'text'));
        
        const fileUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(file.name)}?alt=media`;
        const fileName = file.name.split('/').pop().replace(/^\d+-/, '').replace(/_/g, ' ').replace(/\.[^/.]+$/, "");
        
        const lesson = {
            id: `l-recovered-${Date.now()}-${order}`,
            title: fileName || 'Recovered File',
            content: fileUrl,
            duration: '00:00',
            order: order,
            type: type === 'document' ? 'text' : type,
        };
        
        if (isVideo) lesson.videoUrl = fileUrl;
        if (isExcel) lesson.excelUrl = fileUrl;
        if (isDoc || type === 'text') lesson.documentUrl = fileUrl;
        
        lessons.push(lesson);
        order++;
    }
    
    // Group into chunks of 10 or just one big module
    const modules = [{
        id: `m-recovered-${Date.now()}`,
        title: `Export Masterclass Recovered Modules`,
        description: `Recovered materials from storage. Please review and rename.`,
        order: 0,
        lessons: lessons
    }];
    
    const courseData = {
        title: "Export Masterclass (Recovered)",
        description: "This course was recovered from the storage backup.",
        instructor: "Admin",
        duration: "4 weeks",
        level: "beginner",
        price: 0,
        currency: "NGN",
        category: "business",
        enrolledCount: 0,
        rating: 5.0,
        status: "published",
        thumbnail: "/images/courses/market-analysis.jpg",
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        modules: modules
    };
    
    await db.collection('academy_courses').doc(courseId).set(courseData);
    console.log(`Successfully recreated course ${courseId} with ${lessons.length} lessons!`);
}

run().catch(console.error);
