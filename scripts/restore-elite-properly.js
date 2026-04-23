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

async function run() {
    const courseId = 'ZzQP201ask3MK4yVMMUX';
    
    console.log("Fetching files from Storage...");
    const [files] = await bucket.getFiles({ prefix: `academy/courses/${courseId}/materials/` });
    
    // Sort files strictly by upload time
    files.sort((a, b) => new Date(a.metadata.timeCreated) - new Date(b.metadata.timeCreated));
    
    const eliteFiles = files.slice(-14);
    const earlierFiles = files.slice(0, files.length - 14);
    
    const foundationFiles = earlierFiles.slice(0, 12);
    const standardFiles = earlierFiles.slice(12);
    
    function createLesson(file, order) {
        const isVideo = file.name.match(/\.(mp4|mov|avi|wmv|flv|mkv)$/i);
        const isExcel = file.name.match(/\.(xls|xlsx|csv)$/i);
        const isDoc = file.name.match(/\.(pdf|doc|docx|ppt|pptx)$/i);
        const type = isVideo ? 'video' : (isExcel ? 'excel' : (isDoc ? 'document' : 'text'));
        
        const fileUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(file.name)}?alt=media`;
        const fileName = file.name.split('/').pop().replace(/^\d+-/, '').replace(/_/g, ' ').replace(/\.[^/.]+$/, "");
        
        const lesson = {
            id: `l-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
            title: fileName || 'Recovered Lesson',
            content: fileUrl,
            duration: '00:00',
            order: order,
            type: type === 'document' ? 'text' : type,
        };
        if (isVideo) lesson.videoUrl = fileUrl;
        if (isExcel) lesson.excelUrl = fileUrl;
        if (isDoc || type === 'text') lesson.documentUrl = fileUrl;
        return lesson;
    }

    const modules = [
        {
            id: `m-foundation-${Date.now()}`,
            title: "Foundation",
            description: "Foundation level materials",
            order: 0,
            isExpanded: true,
            lessons: foundationFiles.map((f, i) => createLesson(f, i))
        },
        {
            id: `m-standard-${Date.now()}`,
            title: "Standard",
            description: "Standard level materials",
            order: 1,
            isExpanded: true,
            lessons: standardFiles.map((f, i) => createLesson(f, i))
        },
        {
            id: `m-elite-${Date.now()}`,
            title: "Elite",
            description: "Elite level materials (Latest 14 files)",
            order: 2,
            isExpanded: true,
            lessons: eliteFiles.map((f, i) => createLesson(f, i))
        }
    ];
    
    const courseData = {
        title: "Export Masterclass",
        description: "The complete Easy Sales Export Masterclass.",
        instructor: "Admin",
        duration: "4 weeks",
        level: "advanced",
        price: 0,
        currency: "NGN",
        category: "business",
        enrolledCount: 0,
        rating: 5.0,
        status: "published",
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        modules: modules
    };
    
    await db.collection('academy_courses').doc(courseId).set(courseData);
    console.log(`Successfully restored course ${courseId} with 3 categories and the 14 Elite files!`);
}
run().catch(console.error);
