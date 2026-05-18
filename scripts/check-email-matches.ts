import { config } from "dotenv";
config({ path: ".env.local" });
import * as admin from "firebase-admin";

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        })
    });
}
const db = admin.firestore();

async function main() {
    const processedSnap = await db.collection("processedPayments").get();
    let paymentRecords = [];
    processedSnap.docs.forEach(doc => {
        const d = doc.data();
        const type = d.type || d.paymentType || d.metadata?.type || '';
        if (type.includes('cooperative') && (d.status === 'success' || d.status === 'completed' || !d.status)) {
            paymentRecords.push(d);
        }
    });

    const membersSnap = await db.collection("cooperative_members").get();
    let members = membersSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    let matchCount = 0;
    let missingCount = 0;
    
    for (const record of paymentRecords) {
        // Find if this record matches any member by ID or Email
        const matchedMember = members.find(m => m.id === record.userId || m.email === record.email || m.email === record.customer?.email);
        
        if (matchedMember) {
            matchCount++;
        } else {
            missingCount++;
        }
    }
    
    console.log(`Matched payment records to applications: ${matchCount}`);
    console.log(`Payment records with NO application match: ${missingCount}`);
}
main().catch(console.error);
