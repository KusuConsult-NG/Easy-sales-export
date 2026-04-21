require('dotenv').config({ path: '.env.local' });
const admin = require('firebase-admin');

const svc = {
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
};

admin.initializeApp({ credential: admin.credential.cert(svc) });
const db = admin.firestore();

async function run() {
  const convs = await db.collection('conversations').limit(5).get();
  for (const c of convs.docs) {
     console.log('\nConv:', c.id);
     const msgs = await c.ref.collection('messages').get();
     console.log('Messages count:', msgs.size);
     if(msgs.size > 0) {
        console.log('Sample message ID:', msgs.docs[0].id);
        console.log('Sample message text:', msgs.docs[0].data().text);
        console.log('Sample message timestamp:', msgs.docs[0].data().timestamp);
     }
  }
}
run().then(() => process.exit(0)).catch(console.error);
