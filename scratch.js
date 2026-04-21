const admin = require('firebase-admin');
const serviceAccount = require('./service-account.json');
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function run() {
  const p = await db.collection("marketplace_products").where("status", "==", "pending").count().get();
  console.log("products pending:", p.data().count);
  const l = await db.collection("land_listings").where("verificationStatus", "==", "pending").count().get();
  console.log("land pending:", l.data().count);
  const lo = await db.collection("loan_applications").where("status", "==", "pending").count().get();
  console.log("loans pending:", lo.data().count);
  const w = await db.collection("wave_applications").where("status", "==", "pending").count().get();
  console.log("wave pending:", w.data().count);
}
run().then(() => process.exit(0));
