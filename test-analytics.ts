const sessionGuard = require("./src/lib/session-guard");
sessionGuard.requireSession = async () => ({
    session: { user: { id: "test", email: "test@easysalesexport.com", roles: ["admin"] } }
});

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import * as admin from 'firebase-admin';
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({ 
            projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID, 
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL, 
            privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n")
        })
    });
}

const { getDashboardStatsAction } = require("./src/app/actions/admin-analytics");

async function run() {
    try {
        console.log("Fetching stats...");
        const stats = await getDashboardStatsAction();
        console.log("STATS RECIEVED:", JSON.stringify(stats, null, 2));
    } catch(e) {
        console.error("ERROR IN ACTION:", e);
    }
}
run();
