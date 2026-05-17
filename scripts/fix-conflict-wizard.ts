import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { db, adminAuth } from '../src/lib/firebase-admin';
import { COLLECTIONS } from '../src/lib/types/firestore';
import * as readline from 'readline';

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

async function main() {
    console.log("\n=========================================");
    console.log("   DATA CONFLICT RESOLUTION WIZARD");
    console.log("=========================================\n");
    console.log("Since you don't remember the exact email, please go back to your Admin Dashboard.");
    console.log("Try filling out the Onboard Legacy Member form again until the error pops up.");
    console.log("Once it pops up, look at the email you just typed!\n");

    rl.question("👉 Enter the exact email address here (or press Ctrl+C to cancel): ", async (email) => {
        email = email.trim();
        if (!email) {
            console.log("No email provided. Exiting.");
            process.exit(0);
        }

        console.log(`\n🔍 Checking conflict for: ${email}...`);

        let authUid;
        try {
            const authRecord = await adminAuth.getUserByEmail(email);
            authUid = authRecord.uid;
        } catch (e) {
            // ignore
        }

        let firestoreId;
        try {
            const snap = await db.collection(COLLECTIONS.USERS).where('email', '==', email.toLowerCase()).limit(1).get();
            if (!snap.empty) {
                firestoreId = snap.docs[0].id;
            }
        } catch (e) {
            // ignore
        }

        if (authUid && firestoreId && authUid !== firestoreId) {
            console.log(`\n🚨 CONFLICT CONFIRMED!`);
            console.log(`   Auth UID:     ${authUid}`);
            console.log(`   Firestore ID: ${firestoreId}`);
            
            console.log(`\nFixing it automatically by deleting the broken Auth record...`);
            await adminAuth.deleteUser(authUid);
            
            console.log(`\n✅ FIXED! You can now go back and submit the Onboarding form successfully!`);
        } else {
            console.log(`\n✅ No conflict found for ${email}. Are you sure that was the right email?`);
        }

        process.exit(0);
    });
}

main();
