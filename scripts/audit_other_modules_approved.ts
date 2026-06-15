import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { db } from "../src/lib/firebase-admin";

async function auditAcademy() {
    const snap = await db.collection("academy_applications").get();
    let total = 0;
    let approved = 0;
    let approvedManual = 0;
    let approvedHealed = 0;
    const samples: any[] = [];

    snap.docs.forEach(doc => {
        total++;
        const data = doc.data();
        const isApproved = data.status === "approved" || data.status === "active";
        if (isApproved) {
            approved++;
            // Check manual approval fields
            const hasManual = data.approvedBy || data.approvedAt || data.reviewedBy || data.reviewedAt;
            if (hasManual) {
                approvedManual++;
            } else {
                approvedHealed++;
                if (samples.length < 3) {
                    samples.push({ id: doc.id, email: data.email || data.userEmail || "", data });
                }
            }
        }
    });

    console.log(`\n--- ACADEMY APPLICATIONS AUDIT ---`);
    console.log(`Total: ${total}`);
    console.log(`Approved/Active: ${approved}`);
    console.log(`  - Has Manual Approval Fields: ${approvedManual}`);
    console.log(`  - No Manual Approval Fields (Possible Auto-Healed): ${approvedHealed}`);
    if (samples.length > 0) {
        console.log("Samples of unapproved-approved docs:", JSON.stringify(samples, null, 2));
    }
}

async function auditWave() {
    const snap = await db.collection("wave_applications").get();
    let total = 0;
    let approved = 0;
    let approvedManual = 0;
    let approvedHealed = 0;
    const samples: any[] = [];

    snap.docs.forEach(doc => {
        total++;
        const data = doc.data();
        const isApproved = data.status === "approved" || data.status === "active";
        if (isApproved) {
            approved++;
            // Check manual approval fields
            const hasManual = data.approvedBy || data.approvedAt || data.reviewedBy || data.reviewedAt;
            if (hasManual) {
                approvedManual++;
            } else {
                approvedHealed++;
                if (samples.length < 3) {
                    samples.push({ id: doc.id, email: data.email || data.userEmail || "", data });
                }
            }
        }
    });

    console.log(`\n--- WAVE APPLICATIONS AUDIT ---`);
    console.log(`Total: ${total}`);
    console.log(`Approved/Active: ${approved}`);
    console.log(`  - Has Manual Approval Fields: ${approvedManual}`);
    console.log(`  - No Manual Approval Fields (Possible Auto-Healed): ${approvedHealed}`);
    if (samples.length > 0) {
        console.log("Samples of unapproved-approved docs:", JSON.stringify(samples, null, 2));
    }
}

async function auditExport() {
    const snap = await db.collection("export_applications").get();
    let total = 0;
    let approved = 0;
    let approvedManual = 0;
    let approvedHealed = 0;
    const samples: any[] = [];

    snap.docs.forEach(doc => {
        total++;
        const data = doc.data();
        const isApproved = data.status === "approved" || data.status === "active";
        if (isApproved) {
            approved++;
            // Check manual approval fields
            const hasManual = data.approvedBy || data.approvedAt || data.reviewedBy || data.reviewedAt;
            if (hasManual) {
                approvedManual++;
            } else {
                approvedHealed++;
                if (samples.length < 3) {
                    samples.push({ id: doc.id, email: data.email || data.userEmail || "", data });
                }
            }
        }
    });

    console.log(`\n--- EXPORT APPLICATIONS AUDIT ---`);
    console.log(`Total: ${total}`);
    console.log(`Approved/Active: ${approved}`);
    console.log(`  - Has Manual Approval Fields: ${approvedManual}`);
    console.log(`  - No Manual Approval Fields (Possible Auto-Healed): ${approvedHealed}`);
    if (samples.length > 0) {
        console.log("Samples of unapproved-approved docs:", JSON.stringify(samples, null, 2));
    }
}

async function run() {
    await auditAcademy();
    await auditWave();
    await auditExport();
}

run().catch(console.error).finally(() => process.exit(0));
