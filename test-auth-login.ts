import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env.local') });
dotenv.config({ path: resolve(process.cwd(), '.env') });

const email = "steviekusu@gmail.com";
const password = "Password123!"; // we'll test if we get wrong-password or something else

async function testAuth() {
    try {
        const firebaseApiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
        console.log("Key set?", !!firebaseApiKey);
        
        const response = await fetch(
            `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${firebaseApiKey}`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    email,
                    password,
                    returnSecureToken: true
                })
            }
        );

        const responseData = await response.json();
        console.log("Firebase REST Response:", response.ok ? "OK" : "ERROR", responseData.error || responseData.localId);

        if (!response.ok) return;

        const uid = responseData.localId;
        console.log("UID:", uid);

        // Test getting the user from admin DB
        const admin = require('firebase-admin');
        if (!admin.apps.length) {
            admin.initializeApp({ 
                credential: admin.credential.cert({ 
                    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID, 
                    clientEmail: process.env.FIREBASE_CLIENT_EMAIL, 
                    privateKey: process.env.FIREBASE_PRIVATE_KEY!.replace(/\\n/g, "\n") 
                }) 
            });
        }
        
        const userDoc = await admin.firestore().collection('users').doc(uid).get();
        console.log("Firestore User Exists?", userDoc.exists);
        
        if (userDoc.exists) {
            const userData = userDoc.data();
            console.log("status:", userData.status, "isBanned:", userData.isBanned, "suspended:", userData.suspended);
        }

    } catch (e) {
        console.error("Test Auth Error:", e);
    }
}

testAuth();
