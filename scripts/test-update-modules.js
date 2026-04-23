const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
require('dotenv').config({ path: '.env.local' });
let privateKey = process.env.FIREBASE_PRIVATE_KEY;
if (privateKey.startsWith('"')) privateKey = privateKey.slice(1, -1);
privateKey = privateKey.replace(/\\n/g, '\n');
initializeApp({ credential: cert({ projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey }) });
const db = getFirestore();

async function run() {
    const courseId = '5s1LUqnXM1N81ad2Bb18';
    const modules = [{
        id: 'test_m1',
        title: 'Test Module',
        description: 'Testing',
        order: 0,
        lessons: [{ id: 'l1', title: 'Lesson 1', content: 'Doc', duration: '10:00', order: 0 }]
    }];
    try {
        await db.collection('academy_courses').doc(courseId).update({ modules });
        console.log('Update success');
    } catch(e) {
        console.error('Update failed:', e);
    }
}
run().catch(console.error);
