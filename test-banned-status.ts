import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env.local') });
dotenv.config({ path: resolve(process.cwd(), '.env') });

async function testFirebaseAdmin() {
    try {
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
        
        // G7tQGmdl1ThZPsybhjcpnKrIlwB2 is steviekusu's uid
        const userDoc = await admin.firestore().collection('users').doc('G7tQGmdl1ThZPsybhjcpnKrIlwB2').get();
        console.log("data:", userDoc.data());
        console.log("Raw credentials:", {
            project: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
            email: process.env.FIREBASE_CLIENT_EMAIL,
            pk_length: process.env.FIREBASE_PRIVATE_KEY?.length
        });
    } catch(e) { console.error("Err", e); }
}
testFirebaseAdmin();
