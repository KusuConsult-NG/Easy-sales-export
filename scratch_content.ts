import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
if (!privateKey) throw new Error("No private key");

initializeApp({
  credential: cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: privateKey,
  })
});

const db = getFirestore();

async function test() {
    const productsSnap = await db.collection("products").where("status", "==", "pending").limit(5).get();
    console.log("Products count:", productsSnap.size);
    productsSnap.forEach(doc => {
        const data = doc.data();
        console.log(`Product ${doc.id}: createdAt type =`, typeof data.createdAt, data.createdAt instanceof Date ? 'Date' : (data.createdAt?.toDate ? 'Timestamp' : 'Other'));
    });

    const landSnap = await db.collection("land_listings").where("status", "==", "pending_verification").limit(5).get();
    console.log("Land count:", landSnap.size);
    landSnap.forEach(doc => {
        const data = doc.data();
        console.log(`Land ${doc.id}: createdAt type =`, typeof data.createdAt, data.createdAt instanceof Date ? 'Date' : (data.createdAt?.toDate ? 'Timestamp' : 'Other'));
    });
    
    const exportSnap = await db.collection("export_catalog").where("status", "==", "pending").limit(5).get();
    console.log("Export count:", exportSnap.size);
}
test().catch(console.error);
