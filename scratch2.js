const admin = require('firebase-admin');
const dotenv = require('dotenv');
const path = require('path');
dotenv.config({ path: path.resolve(__dirname, '.env.local') });
admin.initializeApp({
    credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') : undefined,
    }),
});
const db = admin.firestore();
async function run() {
    const snap = await db.collection("users").limit(5).get();
    snap.docs.forEach(d => {
        console.log(`ID: ${d.id}`);
        console.log(`Email: '${d.data().email}'`);
        console.log(`Phone: '${d.data().phone}'`);
        console.log(`FullName: '${d.data().fullName}'`);
        console.log('---');
    });
    process.exit(0);
}
run().catch(console.error);
