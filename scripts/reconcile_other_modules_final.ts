import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { db } from "../src/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

async function main() {
    console.log("=".repeat(60));
    console.log("RECONCILING ACADEMY & WAVE AUTO-APPROVED APPLICATIONS...");
    console.log("=".repeat(60));

    let batch = db.batch();
    let updatesCount = 0;

    // 1. Academy Applications
    console.log("Auditing academy_applications...");
    const academySnap = await db.collection("academy_applications").get();
    for (const doc of academySnap.docs) {
        const data = doc.data();
        const isApproved = data.status === "approved" || data.status === "active";
        const isHealed = data._system_healed_recovery === true || data._system_healed === true;
        const hasManual = data.approvedBy || data.approvedAt || data.reviewedBy || data.reviewedAt;

        if (isApproved && isHealed && !hasManual) {
            const userId = data.userId;
            console.log(`  Reverting Academy App for User: ${userId} (${data.personalInfo?.email || ""})`);
            
            // Revert application status
            batch.update(doc.ref, {
                status: "pending",
                updatedAt: new Date()
            });

            // Revert user profile role & status if user doc exists
            if (userId) {
                const userRef = db.collection("users").doc(userId);
                const userDoc = await userRef.get();
                if (userDoc.exists) {
                    batch.update(userRef, {
                        roles: FieldValue.arrayRemove("academy_participant"),
                        "serviceRegistrations.academy.status": "pending",
                        updatedAt: new Date()
                    });
                }
            }

            updatesCount++;
            if (updatesCount >= 400) {
                await batch.commit();
                batch = db.batch();
                updatesCount = 0;
            }
        }
    }

    // 2. WAVE Applications
    console.log("\nAuditing wave_applications...");
    const waveSnap = await db.collection("wave_applications").get();
    for (const doc of waveSnap.docs) {
        const data = doc.data();
        const isApproved = data.status === "approved" || data.status === "active";
        const isHealed = data._system_healed_recovery === true || data._system_healed === true;
        const hasManual = data.approvedBy || data.approvedAt || data.reviewedBy || data.reviewedAt;

        if (isApproved && isHealed && !hasManual) {
            const userId = data.userId;
            console.log(`  Reverting WAVE App for User: ${userId} (${data.personalInfo?.email || ""})`);
            
            // Revert application status
            batch.update(doc.ref, {
                status: "pending",
                updatedAt: new Date()
            });

            // Revert user profile role & status if user doc exists
            if (userId) {
                const userRef = db.collection("users").doc(userId);
                const userDoc = await userRef.get();
                if (userDoc.exists) {
                    batch.update(userRef, {
                        roles: FieldValue.arrayRemove("wave_participant"),
                        "serviceRegistrations.wave.status": "pending",
                        updatedAt: new Date()
                    });
                }
            }

            updatesCount++;
            if (updatesCount >= 400) {
                await batch.commit();
                batch = db.batch();
                updatesCount = 0;
            }
        }
    }

    if (updatesCount > 0) {
        await batch.commit();
        console.log(`\nCommitted final ${updatesCount} updates.`);
    }

    console.log("\nReconciliation complete! Auto-approved applications reverted to pending successfully.");
}

main().catch(console.error).finally(() => process.exit(0));
