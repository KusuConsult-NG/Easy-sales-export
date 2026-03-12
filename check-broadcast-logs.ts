import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env.local') });
dotenv.config({ path: resolve(process.cwd(), '.env') });

async function checkLogs() {
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
        
        const snap = await admin.firestore().collection('broadcast_logs').orderBy('sentAt', 'desc').limit(5).get();
        if (snap.empty) {
            console.log("No broadcast logs found in the last 5 entries in broadcast_logs.");
        } else {
            snap.forEach((doc: any) => {
                const d = doc.data();
                console.log(`- [${doc.id}]`, d);
            });
        }
    } catch(e) { console.error("Err", e); }
}
checkLogs();
