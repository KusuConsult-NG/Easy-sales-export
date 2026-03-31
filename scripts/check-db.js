const admin = require("firebase-admin");
const serviceAccount = require("./serviceAccountKey.json");
if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();

async function checkData() {
  try {
    const usersSnap = await db.collection("users").get();
    console.log(`Total users in DB: ${usersSnap.size}`);
    
    let hasPhone = 0;
    let academyUsers = 0;
    let verifiedUsers = 0;
    
    usersSnap.forEach(doc => {
      const data = doc.data();
      if (data.phone || data.phoneNumber) hasPhone++;
      if (data.roles && data.roles.includes("academy_participant")) academyUsers++;
      if (data.isVerified) verifiedUsers++;
    });
    
    console.log(`Users with phone numbers: ${hasPhone}`);
    console.log(`Users with "academy_participant" role: ${academyUsers}`);
    console.log(`Verified users: ${verifiedUsers}`);

    const academySnap = await db.collection("academy_applications").get();
    console.log(`Total academy_applications: ${academySnap.size}`);

    const waveSnap = await db.collection("wave_applications").get();
    console.log(`Total wave_applications: ${waveSnap.size}`);
    
  } catch (err) {
    console.error("Error reading from db:", err);
  }
}

checkData().then(() => process.exit(0));
