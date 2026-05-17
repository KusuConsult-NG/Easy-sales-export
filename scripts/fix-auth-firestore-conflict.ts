import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { db, adminAuth } from '../src/lib/firebase-admin';
import { COLLECTIONS } from '../src/lib/types/firestore';

async function main() {
    const args = process.argv.slice(2);
    const email = args[0];
    const action = args[1];

    if (!email) {
        console.log("Usage: npx tsx scripts/fix-auth-firestore-conflict.ts <email> [--delete-auth | --delete-firestore]");
        process.exit(1);
    }

    console.log(`Analyzing conflict for email: ${email}\n`);

    let authRecord;
    try {
        authRecord = await adminAuth.getUserByEmail(email);
        console.log(`[AUTH] Found User: UID = ${authRecord.uid}`);
        console.log(`       Created At: ${authRecord.metadata.creationTime}`);
        console.log(`       Last Sign In: ${authRecord.metadata.lastSignInTime}`);
    } catch (e: any) {
        if (e.code === 'auth/user-not-found') {
            console.log(`[AUTH] No user found with email ${email}`);
        } else {
            console.error(`[AUTH] Error fetching user: ${e.message}`);
        }
    }

    let firestoreDoc;
    try {
        const snap = await db.collection(COLLECTIONS.USERS).where('email', '==', email.toLowerCase()).limit(1).get();
        if (!snap.empty) {
            firestoreDoc = snap.docs[0];
            console.log(`[FIRESTORE] Found Document: ID = ${firestoreDoc.id}`);
            const data = firestoreDoc.data();
            console.log(`            Name: ${data.name || data.fullName || 'N/A'}`);
            console.log(`            Phone: ${data.phone || data.phoneNumber || 'N/A'}`);
            console.log(`            Roles: ${data.roles?.join(', ') || 'None'}`);
        } else {
            console.log(`[FIRESTORE] No document found with email ${email}`);
        }
    } catch (e: any) {
        console.error(`[FIRESTORE] Error fetching document: ${e.message}`);
    }

    if (authRecord && firestoreDoc) {
        if (authRecord.uid !== firestoreDoc.id) {
            console.log(`\n!!! CONFLICT DETECTED !!!`);
            console.log(`Auth UID:     ${authRecord.uid}`);
            console.log(`Firestore ID: ${firestoreDoc.id}`);
            
            if (action === '--delete-auth') {
                console.log(`\nExecuting: Deleting Auth User ${authRecord.uid}...`);
                await adminAuth.deleteUser(authRecord.uid);
                console.log(`✅ Auth user deleted successfully.`);
                console.log(`You can now re-run the legacy onboarding. The system will recreate the Auth user with UID: ${firestoreDoc.id}`);
            } else if (action === '--delete-firestore') {
                console.log(`\nExecuting: Deleting Firestore Document ${firestoreDoc.id}...`);
                await firestoreDoc.ref.delete();
                console.log(`✅ Firestore document deleted successfully.`);
            } else {
                console.log(`\nTo resolve this conflict, run one of the following commands:`);
                console.log(`\nOption 1: Retain Firestore data (Safest, usually recommended for legacy onboarding)`);
                console.log(`Command: npx tsx scripts/fix-auth-firestore-conflict.ts ${email} --delete-auth`);
                
                console.log(`\nOption 2: Retain Auth user (Only if the Firestore doc is an empty/mistake record)`);
                console.log(`Command: npx tsx scripts/fix-auth-firestore-conflict.ts ${email} --delete-firestore`);
            }
        } else {
            console.log(`\n✅ No conflict. Auth UID and Firestore ID match (${authRecord.uid}).`);
        }
    } else {
        console.log(`\nNo conflict detected (missing in one or both databases).`);
    }
}

main().then(() => process.exit(0)).catch(e => {
    console.error(e);
    process.exit(1);
});
