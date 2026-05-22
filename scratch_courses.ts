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
  const snapshot = await db.collection('academy_courses').get();
  console.log(`Total academy courses: ${snapshot.size}`);
  snapshot.forEach(doc => {
      const data = doc.data();
      console.log(`- ${data.title} (Tier: ${data.tier || 'free'}, Status: ${data.status || 'unknown'})`);
  });
}

run().catch(console.error);
