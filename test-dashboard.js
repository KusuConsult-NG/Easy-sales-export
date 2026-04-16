require('dotenv').config({ path: '.env.local' });
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore, AggregateField } = require('firebase-admin/firestore');

if (!getApps().length) {
  initializeApp({
    credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)),
  });
}
const db = getFirestore();

async function run() {
    try {
        console.log("Checking transactions count...");
        const c1 = await db.collection("transactions").count().get();
        console.log("Count:", c1.data().count);
        
        console.log("Checking revenue aggregate...");
        // This is what the global aggregation is running
        const c2 = await db.collection("transactions")
             .where("status", "==", "completed")
             .aggregate({ total: AggregateField.sum("amount") })
             .get();
        console.log("Revenue:", c2.data().total);
        
    } catch (e) {
        console.error("FIREBASE ERROR:", e.message);
    }
}
run();
