import admin from 'firebase-admin';
import fs from 'fs';

const serviceAccount = JSON.parse(fs.readFileSync('./service-account.json', 'utf8'));
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

async function check() {
  const q = await db.collection('users').where('email', '==', 'steviekusu@gmail.com').get();
  q.forEach(d => console.log(d.id, d.data().roles, d.data().serviceRegistrations));
}
check();
