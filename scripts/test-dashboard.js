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
        console.log("Fetching global metrics...");
        const [paystackSnap, allUsersSnap, usersSnap2] = await Promise.allSettled([
            db.collection('processedPayments').where("status", "==", "completed").limit(10).get(),
            db.collection('users').count().get(),
            db.collection('processedPayments').count().get()
        ]);

        console.log("allUsersSnap status:", allUsersSnap.status);
        if(allUsersSnap.status === 'fulfilled') {
            console.log("totalUsers:", allUsersSnap.value.data().count);
        } else {
            console.log("totalUsers error:", allUsersSnap.reason);
        }

        console.log("test complete");
        process.exit(0);
    } catch(e) {
        console.error(e);
        process.exit(1);
    }
}
run();
