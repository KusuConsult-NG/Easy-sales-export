const admin = require("firebase-admin");
const serviceAccount = require("./serviceAccountKey.json");
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function run() {
  const users = await db.collection("users").get();
  console.log("Total users:", users.size);
  let hasPhone = 0;
  users.forEach(doc => {
    const d = doc.data();
    if (d.phone || d.phoneNumber) hasPhone++;
  });
  console.log("Users with phone:", hasPhone);

  const cm = await db.collection("cooperative_members").get();
  console.log("cooperative_members:", cm.size);

  const aa = await db.collection("academy_applications").get();
  console.log("academy_applications:", aa.size);
}
run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
