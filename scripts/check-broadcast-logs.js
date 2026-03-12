const admin = require('firebase-admin');
const serviceAccount = require('./service-account.json');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

async function check() {
  const snapshot = await db.collection('broadcast_logs').orderBy('sentAt', 'desc').limit(5).get();
  snapshot.forEach(doc => {
    console.log(doc.id, "=>", doc.data());
  });
}

check().then(() => process.exit(0)).catch(console.error);
