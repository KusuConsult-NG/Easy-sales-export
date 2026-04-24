const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

require('ts-node').register({
  compilerOptions: {
    module: "commonjs",
    esModuleInterop: true,
  },
  require: ['tsconfig-paths/register']
});

const { getStandardAcademyApplicationsAction } = require('./src/app/actions/academy-admin.ts');

async function run() {
    // Mock requireSession to return an admin user
    const auth = require('./src/lib/session-guard.ts');
    auth.requireSession = async () => ({
        session: { user: { id: "admin", roles: ["admin"] } }
    });
    
    // Mock user Doc to return admin
    const firebaseAdmin = require('./src/lib/firebase-admin.ts');
    const db = firebaseAdmin.db;
    const oldGet = db.collection('users').doc('admin').get;
    db.collection('users').doc('admin').get = async () => ({
        exists: true,
        data: () => ({ roles: ["admin"] })
    });

    const result = await getStandardAcademyApplicationsAction({ limit: 5000 });
    console.log("Returned count:", result.data?.length);
    console.log("Error:", result.error);
}

run().catch(console.error).then(() => process.exit(0));
