import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({ 
            projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID, 
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL, 
            privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n")
        })
    });
}
const db = admin.firestore();
const adminAuth = admin.auth();

async function run() {
    console.time("DetectOrphanedUsers");
    try {
        const listUsersResult = await adminAuth.listUsers(100);
        console.log(`Fetched ${listUsersResult.users.length} users from Auth.`);
        
        const chunks = [];
        const chunkSize = 50;
        for (let i = 0; i < listUsersResult.users.length; i += chunkSize) {
            chunks.push(listUsersResult.users.slice(i, i + chunkSize));
        }

        let orphanedCount = 0;
        
        for (const chunk of chunks) {
            const uuids = chunk.map(u => u.uid);
            
            // To fetch multiple documents quickly, we can split them into arrays of 10 for getAll
            const refs = uuids.map(uid => db.collection("users").doc(uid));
            const docs = await db.getAll(...refs);
            
            docs.forEach((doc, idx) => {
                if (!doc.exists) {
                    orphanedCount++;
                }
            });
        }
        console.log(`Finished checking ${listUsersResult.users.length} users. Orphaned: ${orphanedCount}`);
    } catch(e) {
        console.error("Error:", e);
    }
    console.timeEnd("DetectOrphanedUsers");
}
run();
