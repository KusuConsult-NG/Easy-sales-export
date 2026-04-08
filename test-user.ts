import { db } from "./src/lib/firebase-admin";
async function run() {
  const q = await db.collection('users').where('email', '==', 'steviekusu@gmail.com').get();
  if (q.empty) { console.log('user not found'); return; }
  console.log(JSON.stringify(q.docs[0].data(), null, 2));
}
run();
