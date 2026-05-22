import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
if (!privateKey) throw new Error("No private key");

initializeApp({
  credential: cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: privateKey,
  })
});

const db = getFirestore();

// copy the in-memory filtering logic to test
const options = {
    fromDate: "2026-05-18",
    toDate: "2026-05-20"
};

const from = new Date(options.fromDate);
from.setHours(0, 0, 0, 0);

const to = new Date(options.toDate);
to.setHours(23, 59, 59, 999);

console.log("FROM:", from.toISOString());
console.log("TO:", to.toISOString());

const testDates = [
    "2026-05-17T23:59:59.000Z",
    "2026-05-18T00:00:01.000Z",
    "2026-05-19T12:00:00.000Z",
    "2026-05-20T23:59:59.000Z",
    "2026-05-21T00:00:01.000Z"
];

testDates.forEach(d => {
    const dObj = new Date(d);
    const valid = dObj >= from && dObj <= to;
    console.log(`Date ${d} is valid? ${valid}`);
});
