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
    const eliteCourseId = '5s1LUqnXM1N81ad2Bb18';
    
    const [allFiles] = await bucket.getFiles({ prefix: 'academy/courses/' });
    
    // Exclude non-Easy-Sales files
    const excluded = ['gonana_pro', 'XRPL_Grants'];
    const validFiles = allFiles.filter(f => !excluded.some(ex => f.name.includes(ex)));
    
    // Deduplicate by filename (keep first upload of each)
    const seen = new Map();
    validFiles.forEach(f => {
        const baseName = f.name.split('/').pop().replace(/^\d+-/, '');
        if (!seen.has(baseName)) seen.set(baseName, f);
    });
    
    const uniqueFiles = Array.from(seen.values());
    
    // Define display order: Day lessons first (sorted by day), then supplementary videos, then documents
    const order = [
        'Day_1__Onboarding_',
        'Day_2__Requirements_for_Exportation_',
        'Day_3__How_to_Source_for_Products_',
        'Day_3__How_to_Source_farmers_on_facebook_',
        'Day_4__How_to_get_large_export_buyers_',
        'Day_5__Strategies_for_getting_buyers_abroad_',
        'Day_6__How_to_get_your_pricing_right_',
        'Day_7_prt_1__How_to_identify_your_dream_buyers_',
        'Day_7_Prt_2',
        'Day_7_Prt_3',
        'Day_7_Prt_4',
        'Day_7_Prt_5',
        'Day_7_Prt_6',
        'Day_11__Kill_the_enemy_inside_you_',
        'Kill_The_Enemy_I',
        'Day_30__Amazon_Explained_',
        'Procedures_for_securing',
        'Answerthepublic',
        'buyers-of-bitter-kola',
        'countries-with-high-demands',
        'major-buyers-of-honey',
        'abdul-s-audit-template',
        'customers-avater-advance',
        'halostrategyresource',
    ];
    
    // Sort files by the order list
    uniqueFiles.sort((a, b) => {
        const aName = a.name.split('/').pop();
        const bName = b.name.split('/').pop();
        const aIdx = order.findIndex(o => aName.includes(o));
        const bIdx = order.findIndex(o => bName.includes(o));
        return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
    });
    
    // Clean display titles
    function cleanTitle(filename) {
        return filename
            .replace(/^\d+-/, '')
            .replace(/\.[^/.]+$/, '')
            .replace(/_/g, ' ')
            .replace(/  +/g, ' ')
            .replace(/\s*-\s*\d{14}$/, '')
            .trim();
    }
    
    // Build lessons array
    const lessons = uniqueFiles.map((f, i) => {
        const rawName = f.name.split('/').pop();
        const isVideo = rawName.match(/\.(mp4|mov|avi|wmv|flv|mkv)$/i);
        const isExcel = rawName.match(/\.(xls|xlsx|csv)$/i);
        const isDoc = rawName.match(/\.(pdf|doc|docx|ppt|pptx)$/i);
        
        const fileUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(f.name)}?alt=media`;
        const title = cleanTitle(rawName);
        
        const lesson = {
            id: `l-elite-${Date.now()}-${i}`,
            title: title,
            content: isDoc || isExcel ? fileUrl : '',
            duration: '00:00',
            order: i,
        };
        
        if (isVideo) lesson.videoUrl = fileUrl;
        if (isExcel) lesson.excelUrl = fileUrl;
        if (isDoc) lesson.documentUrl = fileUrl;
        
        return lesson;
    });
    
    // Create the module
    const eliteModule = {
        id: `m-elite-${Date.now()}`,
        title: 'Elite Program',
        description: 'Complete Elite training materials — videos, documents, and resources.',
        order: 0,
        lessons: lessons,
    };
    
    await db.collection('academy_courses').doc(eliteCourseId).update({
        modules: [eliteModule],
        updatedAt: FieldValue.serverTimestamp(),
    });
    
    console.log(`Restored Elite module with ${lessons.length} lessons:\n`);
    lessons.forEach((l, i) => console.log(`  ${i + 1}. ${l.title}`));
}
run().catch(console.error);
