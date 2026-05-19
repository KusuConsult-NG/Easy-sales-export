const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();
async function run() {
  const snap = await db.collection('cooperative_members').limit(10).get();
  snap.docs.forEach(doc => {
    console.log(doc.id, JSON.stringify(doc.data()));
  });
}
run();
