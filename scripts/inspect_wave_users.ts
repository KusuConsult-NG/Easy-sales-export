import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

import { db } from "../src/lib/firebase-admin";

async function main() {
    console.log("Analyzing WAVE applications and users...");

    const appsSnap = await db.collection("wave_applications").get();
    console.log(`Total WAVE applications in collection: ${appsSnap.size}`);

    const statusCounts: Record<string, number> = {};
    const userRoleCounts: Record<string, number> = {};

    for (const doc of appsSnap.docs) {
        const app = doc.data();
        const status = app.status || "N/A";
        statusCounts[status] = (statusCounts[status] || 0) + 1;

        if (status === "approved" || status === "active") {
            const uid = app.userId;
            if (uid) {
                const userSnap = await db.collection("users").doc(uid).get();
                if (userSnap.exists) {
                    const userData = userSnap.data();
                    const roles = userData?.roles || [];
                    roles.forEach((r: string) => {
                        userRoleCounts[r] = (userRoleCounts[r] || 0) + 1;
                    });
                } else {
                    userRoleCounts["NO_USER_PROFILE"] = (userRoleCounts["NO_USER_PROFILE"] || 0) + 1;
                }
            } else {
                userRoleCounts["NO_USER_ID"] = (userRoleCounts["NO_USER_ID"] || 0) + 1;
            }
        }
    }

    console.log("Status distribution of WAVE applications:");
    console.log(statusCounts);

    console.log("Roles of users with 'approved' or 'active' WAVE applications:");
    console.log(userRoleCounts);

    // Let's also check wave_members collection
    const waveMembersSnap = await db.collection("wave_members").get();
    console.log(`Total documents in 'wave_members' collection: ${waveMembersSnap.size}`);

    // Let's also check total users in the users collection who have wave_participant or similar roles
    const usersSnap = await db.collection("users").get();
    let waveRolesCount = 0;
    usersSnap.forEach(doc => {
        const roles = doc.data().roles || [];
        if (roles.includes("wave_participant") || roles.includes("wave_admin")) {
            waveRolesCount++;
        }
    });
    console.log(`Total users in 'users' collection with WAVE-related roles: ${waveRolesCount}`);
}

main().then(() => process.exit(0)).catch(err => {
    console.error(err);
    process.exit(1);
});
