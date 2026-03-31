import { db } from "../src/lib/firebase/admin";
import { COLLECTIONS } from "../src/lib/types/firestore";

async function checkData() {
  try {
    const usersSnap = await db.collection(COLLECTIONS.USERS).get();
    console.log(`Total users in DB: ${usersSnap.size}`);
    
    let hasPhone = 0;
    let academyUsers = 0;
    
    usersSnap.forEach((doc: any) => {
      const data = doc.data();
      if (data.phone || data.phoneNumber || data.kyc?.phoneNumber) hasPhone++;
      if (data.roles?.includes("academy_participant")) academyUsers++;
    });
    
    console.log(`Users with phone numbers: ${hasPhone}`);
    console.log(`Users with "academy_participant" role: ${academyUsers}`);

    const academySnap = await db.collection(COLLECTIONS.ACADEMY_APPLICATIONS).get();
    console.log(`Total academy_applications: ${academySnap.size}`);

    const cm = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).get();
    console.log(`Total cooperative_members: ${cm.size}`);

    const pp = await db.collection(COLLECTIONS.PROCESSED_PAYMENTS).get();
    console.log(`Total processedPayments: ${pp.size}`);
    
  } catch (err) {
    console.error("Error reading from db:", err);
  }
}

checkData();
