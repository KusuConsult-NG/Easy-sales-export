const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const serviceAccount = require('./serviceAccountKey.json');
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();
db.collection('processed_payments').limit(1).get().then(snap => {
    console.log(snap.docs[0].data());
    process.exit(0);
});
