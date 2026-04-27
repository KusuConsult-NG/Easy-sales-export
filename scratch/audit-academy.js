require('dotenv').config({ path: '.env.local' });
const admin = require("firebase-admin");
const fs = require('fs');

let serviceAccountStr = process.env.FIREBASE_SERVICE_ACCOUNT_KEY || process.env.NEXT_PUBLIC_FIREBASE_SERVICE_ACCOUNT_KEY;

if (!serviceAccountStr) {
  console.error("Missing service account string in env");
  process.exit(1);
}

try {
    const serviceAccount = JSON.parse(serviceAccountStr);
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
} catch (e) {
    console.log("Error initializing:", e);
    process.exit(1);
}

const db = admin.firestore();

async function runAudit() {
    const usersSnap = await db.collection("users").get();
    let bypassedCount = 0;
    const bypassedUsers = [];

    usersSnap.forEach(doc => {
        const data = doc.data();
        const academy = data.serviceRegistrations?.academy;
        
        // If they have academy status but NO paymentStatus === 'completed'
        if (academy && academy.status) {
            if (academy.paymentStatus !== 'completed') {
                bypassedCount++;
                bypassedUsers.push({
                    id: doc.id,
                    email: data.email,
                    status: academy.status,
                    paymentStatus: academy.paymentStatus || 'missing',
                    plan: academy.plan || 'missing'
                });
            }
        }
    });

    console.log(`Total users with Academy registration: ${usersSnap.docs.filter(d => d.data().serviceRegistrations?.academy).length}`);
    console.log(`Total users who bypassed payment: ${bypassedCount}`);
    
    fs.writeFileSync('scratch/academy_unpaid_report.json', JSON.stringify(bypassedUsers, null, 2));
    console.log("Report saved to scratch/academy_unpaid_report.json");
    process.exit(0);
}

runAudit().catch(console.error);
