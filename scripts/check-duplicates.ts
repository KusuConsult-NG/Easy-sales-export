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
    const membersSnap = await db.collection("cooperative_members").get();
    let members = membersSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    let emailGroups = {};
    members.forEach(m => {
        if (!m.email) return;
        const e = m.email.toLowerCase();
        if (!emailGroups[e]) emailGroups[e] = [];
        emailGroups[e].push(m);
    });

    let duplicatePaid = 0;
    
    for (const email in emailGroups) {
        const group = emailGroups[email];
        if (group.length > 1) {
            const paidMembers = group.filter(m => m.paymentStatus === 'completed');
            if (paidMembers.length > 1) {
                console.log(`Email ${email} has ${paidMembers.length} PAID applications.`);
                duplicatePaid += paidMembers.length;
            }
        }
    }
    
    console.log(`Found ${duplicatePaid} total paid members who share an email with another paid member.`);
}
main().catch(console.error);
