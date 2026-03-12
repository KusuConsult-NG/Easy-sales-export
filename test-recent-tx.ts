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

async function run() {
    try {
        console.log("Fetching cooperative members transaction data...");
        const recentCoopSnap = await db
            .collection("cooperative_members")
            .where("paymentStatus", "==", "completed")
            .orderBy("updatedAt", "desc")
            .limit(5)
            .get();
            
        console.log(`Found ${recentCoopSnap.size} cooperative transactions`);
        
        console.log("Fetching escrow transactions data...");
        const recentEscrowSnap = await db
            .collection("escrow_transactions")
            .orderBy("createdAt", "desc")
            .limit(5)
            .get();
            
        console.log(`Found ${recentEscrowSnap.size} escrow transactions`);
    } catch(e) {
        console.error("Error executing query:", e);
    }
}
run();
