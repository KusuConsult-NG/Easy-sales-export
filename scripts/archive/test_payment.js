const admin = require('firebase-admin');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    })
  });
}

const db = admin.firestore();

async function run() {
    const fetchLimit = 5000;
    const snapshot = await db.collection('academy_applications').orderBy("submittedAt", "desc").limit(fetchLimit).get();
    
    let exportApps = snapshot.docs.map(doc => {
        const d = doc.data();
        return {
            id: doc.id,
            paymentStatus: d.paymentStatus,
        };
    });

    console.log("Total exportApps:", exportApps.length);
    let paymentFilter = "all";
    let filteredAll = exportApps.filter(a => {
        if (paymentFilter === "all") return true;
        if (paymentFilter === "completed") return a.paymentStatus === "completed" || a.paymentStatus === "paid";
        return a.paymentStatus !== "completed" && a.paymentStatus !== "paid";
    });
    console.log("Filtered all:", filteredAll.length);
}

run().catch(console.error).then(() => process.exit(0));
