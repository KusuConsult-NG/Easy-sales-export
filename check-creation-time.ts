import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env.local') });
dotenv.config({ path: resolve(process.cwd(), '.env') });

async function checkUserTimestamp() {
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
        const userRecord = await admin.auth().getUser('G7tQGmdl1ThZPsybhjcpnKrIlwB2');
        console.log("Account Created:", userRecord.metadata.creationTime);
        console.log("Last Sign In:", userRecord.metadata.lastSignInTime);
        console.log("Password Last Updated (may not be exactly when it was set if it was set on creation):", userRecord.tokensValidAfterTime);
    } catch(e) { console.error("Err", e); }
}
checkUserTimestamp();
