import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

import { db } from "../src/lib/firebase-admin";

async function main() {
    console.log("=========================================");
    console.log("DETAILED WAVE USER INSPECTION");
    console.log("=========================================");

    // 1. Inspect wave_members
    console.log("\n--- wave_members Collection documents ---");
    const waveMembersSnap = await db.collection("wave_members").get();
    console.log(`Total documents: ${waveMembersSnap.size}`);
    
    for (const doc of waveMembersSnap.docs) {
        const data = doc.data();
        console.log(`\nDoc ID (userId): ${doc.id}`);
        console.log(`  email: ${data.email || "N/A"}`);
        console.log(`  name: ${data.name || "N/A"}`);
        console.log(`  active: ${data.active}`);
        console.log(`  status: ${data.status || "N/A"}`);
        console.log(`  applicationId: ${data.applicationId || "N/A"}`);
        console.log(`  enrolledAt: ${data.enrolledAt?.toDate?.()?.toISOString() || data.enrolledAt}`);
        
        // Find corresponding application
        if (data.applicationId) {
            const appSnap = await db.collection("wave_applications").doc(data.applicationId).get();
            if (appSnap.exists) {
                console.log(`  -> Application: ${data.applicationId} | status: ${appSnap.data()?.status}`);
            } else {
                console.log(`  -> Application: ${data.applicationId} | NOT FOUND in wave_applications`);
            }
        } else {
            // Try to find application by userId
            const appSnap = await db.collection("wave_applications").where("userId", "==", doc.id).get();
            if (!appSnap.empty) {
                console.log(`  -> Found ${appSnap.size} applications by userId:`);
                appSnap.forEach(d => {
                    console.log(`     appId: ${d.id} | status: ${d.data().status}`);
                });
            } else {
                console.log(`  -> No applications found by userId`);
            }
        }
    }

    // 2. Inspect users with wave_participant role
    console.log("\n--- Users with 'wave_participant' role ---");
    const usersSnap = await db.collection("users").where("roles", "array-contains", "wave_participant").get();
    console.log(`Total users with role: ${usersSnap.size}`);

    for (const doc of usersSnap.docs) {
        const u = doc.data();
        console.log(`\nUser ID: ${doc.id}`);
        console.log(`  email: ${u.email || "N/A"}`);
        console.log(`  fullName: ${u.fullName || "N/A"}`);
        console.log(`  roles: ${JSON.stringify(u.roles)}`);
        console.log(`  serviceRegistrations.wave: ${JSON.stringify(u.serviceRegistrations?.wave || "N/A")}`);
        
        // Check if member exists
        const memberDoc = await db.collection("wave_members").doc(doc.id).get();
        console.log(`  memberDoc exists: ${memberDoc.exists}`);
        if (memberDoc.exists) {
            console.log(`  memberDoc active: ${memberDoc.data()?.active} | status: ${memberDoc.data()?.status}`);
        }
        
        // Check if application exists
        const appSnap = await db.collection("wave_applications").where("userId", "==", doc.id).get();
        if (!appSnap.empty) {
            appSnap.forEach(d => {
                console.log(`  applicationId: ${d.id} | status: ${d.data().status}`);
            });
        } else {
            console.log(`  applicationId: NONE`);
        }
    }
}

main().then(() => process.exit(0)).catch(err => {
    console.error(err);
    process.exit(1);
});
