const admin = require('firebase-admin');
const dotenv = require('dotenv');
const fs = require('fs');

const env = dotenv.parse(fs.readFileSync('.env.local'));
const serviceAccount = {
  project_id: env.FIREBASE_PROJECT_ID,
  client_email: env.FIREBASE_CLIENT_EMAIL,
  private_key: env.FIREBASE_PRIVATE_KEY.replace(/\\\\n/g, '\\n').replace(/^\"|\"$/g, '')
};

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function run() {
    try {
        console.log("Fetching transactions...");
        const [txSnap, coopSnap, escrowSnap] = await Promise.allSettled([
            db.collection('processedPayments').orderBy("processedAt", "desc").limit(15).get(),
            db.collection('cooperativeTransactions').orderBy("createdAt", "desc").limit(15).get(),
            db.collection('escrowTransactions').orderBy("createdAt", "desc").limit(15).get()
        ]);

        console.log("txSnap status:", txSnap.status);
        if(txSnap.status === 'fulfilled') {
            console.log("tx count:", txSnap.value.docs.length);
        } else {
            console.log("tx error:", txSnap.reason);
        }

        console.log("coopSnap status:", coopSnap.status);
        if(coopSnap.status === 'fulfilled') {
            console.log("coop count:", coopSnap.value.docs.length);
        } else {
            console.log("coop error:", coopSnap.reason);
        }

        console.log("test complete");
        process.exit(0);
    } catch(e) {
        console.error(e);
        process.exit(1);
    }
}
run();
