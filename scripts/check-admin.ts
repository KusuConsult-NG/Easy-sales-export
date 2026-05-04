import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

if (!getApps().length) {
    // Basic init for testing using env vars
    initializeApp({
        projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    });
}

const db = getFirestore();
const auth = getAuth();

async function check() {
    const email = 'admin.easysalesexport@gmail.com';
    try {
        console.log(`Checking Firebase Auth for ${email}...`);
        const user = await auth.getUserByEmail(email);
        console.log('Firebase Auth User:', { uid: user.uid, email: user.email });
        
        console.log(`Checking Firestore users collection for uid ${user.uid}...`);
        const doc = await db.collection('users').doc(user.uid).get();
        if (doc.exists) {
            console.log('Firestore Document EXISTS:', doc.data());
        } else {
            console.log('Firestore Document MISSING for uid:', user.uid);
            
            // Search if there's any document with this email
            const query = await db.collection('users').where('email', '==', email).get();
            if (!query.empty) {
                console.log(`Found ${query.size} document(s) with this email but different UID:`);
                query.forEach(d => console.log('Doc ID:', d.id, 'Data:', d.data()));
            } else {
                console.log('No document found with this email in the users collection.');
            }
        }
    } catch (e) {
        console.error('Error:', e);
    }
}

check();
