import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { getAdminDb, getAdminAuth } from './src/lib/firebase-admin';

async function run() {
    const db = getAdminDb();
    const auth = getAdminAuth();
    const emails = [
        "easysaleswave@gmail.com",
        "easysalescooperative@gmail.com",
        "easysalesmarketplace@gmail.com",
        "easysalesexportwindow@gmail.com",
        "easysalesfarmnation@gmail.com",
        "academy.easysalesexport1@gmail.com"
    ];

    for (const email of emails) {
        try {
            const userRecord = await auth.getUserByEmail(email);
            const doc = await db.collection("users").doc(userRecord.uid).get();
            const data = doc.data();
            console.log(`\nEmail: ${email}`);
            console.log(`Auth Claims:`, userRecord.customClaims);
            console.log(`Firestore Roles:`, data?.roles);
        } catch (error: any) {
            console.log(`\nEmail: ${email} - Error: ${error.message}`);
        }
    }
}

run().catch(console.error);
