import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const serviceAccount = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
};

if (!global.firebaseApp) {
  global.firebaseApp = initializeApp({
    credential: cert(serviceAccount)
  });
}

const db = getFirestore();

async function main() {
  try {
    const membersSnap = await db.collection("cooperative_members").get();
    const totalDocs = membersSnap.size;
    let paidMembers = 0;
    
    const usersSnap = await db.collection("users").where("roles", "array-contains", "cooperative_member").get();
    const approvedMembers = usersSnap.size;

    console.log(`Total cooperative_member docs: ${totalDocs}`);
    
    membersSnap.forEach(doc => {
      const data = doc.data();
      if (data.paymentStatus === 'completed') {
        paidMembers++;
      }
    });

    console.log(`Paid cooperative members (paymentStatus === 'completed'): ${paidMembers}`);
    console.log(`Approved cooperative members (users with role): ${approvedMembers}`);

  } catch (err: any) {
    console.error(err.message);
  }
}

main();
