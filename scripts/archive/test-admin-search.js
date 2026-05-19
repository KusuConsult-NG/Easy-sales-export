const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

require('ts-node').register({
  compilerOptions: {
    module: "commonjs",
    esModuleInterop: true,
  },
  require: ['tsconfig-paths/register']
});

const { getStandardCooperativeMembersAction } = require('./src/app/actions/cooperative-admin.ts');
const { getUsersAction } = require('./src/app/actions/admin.ts');
const { getStandardWaveApplicationsAction } = require('./src/app/actions/wave-admin.ts');

async function run() {
    // Mock requireSession to return an admin user
    const auth = require('./src/lib/session-guard.ts');
    auth.requireSession = async () => ({
        session: { user: { id: "p1u1tXbFf3YpYFq9gQ6Z", email: "admin@easysales.com", roles: ["admin"] } }
    });
    
    // Mock user Doc to return admin
    const firebaseAdmin = require('./src/lib/firebase-admin.ts');
    const db = firebaseAdmin.db;
    
    // Let's first check if there are users in the collection
    const usersSnap = await db.collection('users').limit(5).get();
    console.log("Total users in database sampled:", usersSnap.docs.length);
    if (usersSnap.docs.length > 0) {
        console.log("Sample user email:", usersSnap.docs[0].data()?.email);
        console.log("Sample user name:", usersSnap.docs[0].data()?.fullName || usersSnap.docs[0].data()?.name || usersSnap.docs[0].data()?.firstName);
    }

    // Let's run a search for a specific existing user name/email or a substring
    const sampleEmail = usersSnap.docs.length > 0 ? usersSnap.docs[0].data()?.email : "onomosoffice@gmail.com";
    const sampleName = usersSnap.docs.length > 0 ? (usersSnap.docs[0].data()?.fullName || usersSnap.docs[0].data()?.firstName || "onomos") : "onomos";

    console.log(`\n--- Testing getUsersAction with no search ---`);
    const usersAll = await getUsersAction({ limit: 10 });
    console.log("Returned count (all):", usersAll.data?.length, "Error:", usersAll.error);

    console.log(`\n--- Testing getUsersAction with email search (${sampleEmail}) ---`);
    const usersSearchEmail = await getUsersAction({ limit: 10, search: sampleEmail });
    console.log("Returned count (email):", usersSearchEmail.data?.length, "Error:", usersSearchEmail.error);
    if (usersSearchEmail.data?.length > 0) {
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
