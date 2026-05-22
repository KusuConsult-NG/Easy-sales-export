import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import * as dotenv from 'dotenv';
import * as fs from 'fs';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

initializeApp({
  credential: cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: privateKey,
  })
});

const db = getFirestore();

async function run() {
  console.log("Searching for zeredogo...");
  const snapshot = await db.collection('users').get();
  
  let found = 0;
  snapshot.forEach(doc => {
    const data = doc.data();
    const str = JSON.stringify(data).toLowerCase();
    if (str.includes('zeredogo')) {
      console.log(`\nFound User ID: ${doc.id}`);
      console.log(`Email: ${data.email}`);
      console.log(`Name: ${data.name || data.firstName + ' ' + data.lastName}`);
      console.log(`Roles:`, data.roles);
      console.log(`Service Registrations:`, JSON.stringify(data.serviceRegistrations, null, 2));
      console.log(`Course Enrollments:`, data.courseEnrollments || 'None');
      found++;
    }
  });
  
  console.log(`\nTotal users found: ${found}`);
}

run().catch(console.error);
