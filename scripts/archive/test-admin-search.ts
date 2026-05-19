import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '.env.local') });

import { getStandardCooperativeMembersAction } from './src/app/actions/cooperative-admin';
import { getUsersAction } from './src/app/actions/admin';
import { getStandardWaveApplicationsAction } from './src/app/actions/wave-admin';
import * as auth from './src/lib/session-guard';
import * as firebaseAdmin from './src/lib/firebase-admin';

async function run() {
    // Mock requireSession to return an admin user
    (auth as any).requireSession = async () => ({
        session: { user: { id: "p1u1tXbFf3YpYFq9gQ6Z", email: "admin@easysales.com", roles: ["admin"] } }
    });
    
    const db = firebaseAdmin.db;
    
    // Let's check how many users exist
    const usersSnap = await db.collection('users').limit(5).get();
    console.log("Total users in database sampled:", usersSnap.docs.length);
    let sampleEmail = "onomosoffice@gmail.com";
    let sampleName = "onomos";
    
    if (usersSnap.docs.length > 0) {
        sampleEmail = usersSnap.docs[0].data()?.email || sampleEmail;
        sampleName = usersSnap.docs[0].data()?.fullName || usersSnap.docs[0].data()?.firstName || sampleName;
        console.log("Sample user email:", sampleEmail);
        console.log("Sample user name:", sampleName);
    }

    console.log(`\n--- Testing getUsersAction with no search ---`);
    const usersAll = await getUsersAction({ limit: 10 });
    console.log("Returned count (all):", usersAll.data?.length, "Error:", usersAll.error);

    console.log(`\n--- Testing getUsersAction with email search (${sampleEmail}) ---`);
    const usersSearchEmail = await getUsersAction({ limit: 10, search: sampleEmail });
    console.log("Returned count (email):", usersSearchEmail.data?.length, "Error:", usersSearchEmail.error);
    if (usersSearchEmail.data && usersSearchEmail.data.length > 0) {
        console.log("Found user ID:", usersSearchEmail.data[0].id);
    }

    console.log(`\n--- Testing getUsersAction with name search (${sampleName}) ---`);
    const usersSearchName = await getUsersAction({ limit: 10, search: sampleName });
    console.log("Returned count (name):", usersSearchName.data?.length, "Error:", usersSearchName.error);

    console.log(`\n--- Testing getStandardCooperativeMembersAction with no search ---`);
    const coopAll = await getStandardCooperativeMembersAction({ limit: 10 });
    console.log("Returned count (all):", coopAll.data?.length, "Error:", coopAll.error);

    console.log(`\n--- Testing getStandardCooperativeMembersAction with search (${sampleName}) ---`);
    const coopSearchName = await getStandardCooperativeMembersAction({ limit: 10, search: sampleName });
    console.log("Returned count (name):", coopSearchName.data?.length, "Error:", coopSearchName.error);

    console.log(`\n--- Testing getStandardWaveApplicationsAction with no search ---`);
    const waveAll = await getStandardWaveApplicationsAction({ limit: 10 });
    console.log("Returned count (all):", waveAll.data?.length, "Error:", waveAll.error);

    console.log(`\n--- Testing getStandardWaveApplicationsAction with search (${sampleName}) ---`);
    const waveSearchName = await getStandardWaveApplicationsAction({ limit: 10, search: sampleName });
    console.log("Returned count (name):", waveSearchName.data?.length, "Error:", waveSearchName.error);
}

run().catch(console.error).then(() => process.exit(0));
