const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
require('dotenv').config({ path: '.env.local' });

let privateKey = process.env.FIREBASE_PRIVATE_KEY;
if (privateKey.startsWith('"')) privateKey = privateKey.slice(1, -1);
privateKey = privateKey.replace(/\\n/g, '\n');

initializeApp({ 
    credential: cert({ 
        projectId: process.env.FIREBASE_PROJECT_ID, 
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL, 
        privateKey 
    })
});

const db = getFirestore();

async function run() {
    const courseId = 'ZzQP201ask3MK4yVMMUX';
    
    const docRef = db.collection('academy_courses').doc(courseId);
    const docSnap = await docRef.get();
    
    if (!docSnap.exists) {
        console.log("Course not found!");
        return;
    }
    
    const data = docSnap.data();
    
    // Clean up course title and description
    const newTitle = "Export Masterclass";
    const newDescription = "Learn the fundamentals and advanced strategies of international export, product sourcing, and finding global buyers.";
    
    // Clean up modules and lessons
    const newModules = data.modules.map(mod => {
        return {
            ...mod,
            title: "Course Materials",
            description: "All course lessons and materials",
            lessons: mod.lessons.map(lesson => {
                return {
                    ...lesson,
                    title: lesson.title.replace('Recovered: ', '').replace('Recovered File', 'Lesson Material').trim()
                };
            })
        };
    });
    
    await docRef.update({
        title: newTitle,
        description: newDescription,
        modules: newModules
    });
    
    console.log("Successfully cleaned up the course and removed 'Recovered' labels.");
}

run().catch(console.error);
