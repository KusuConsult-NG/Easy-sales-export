import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

import { db } from "../src/lib/firebase-admin";

async function main() {
    console.log("=========================================");
    console.log("INSPECTING UNPAID COOP MEMBERS");
    console.log("=========================================");

    const coopSnap = await db.collection("cooperative_members").get();
    console.log(`Total cooperative members: ${coopSnap.size}`);

    const completedRefs = new Set<string>();
    const processedPaymentsSnap = await db.collection("processedPayments")
        .where("status", "==", "completed")
        .select("reference")
        .get();
    processedPaymentsSnap.docs.forEach(doc => {
        const ref = doc.data().reference;
        if (ref) completedRefs.add(ref);
    });

    let count = 0;
    const refCounts: Record<string, number> = {};
    const sample: any[] = [];
    const dateCounts: Record<string, number> = {};

    for (const doc of coopSnap.docs) {
        const member = doc.data();
        const status = member.status || member.membershipStatus || "pending";
        const paymentStatus = member.paymentStatus || "pending";

        const isActiveOrApproved = status === "active" || status === "approved";
        if (!isActiveOrApproved) continue;

        const isLegacy = 
            member._importSource === "legacy_csv_import" || 
            member.isLegacy === true || 
            member.legacyOnboardedBy || 
            member.paymentReference === "LEGACY_IMPORT_RECEIPT";

        const isManual = 
            member.approvedBy || 
            member.approvedAt || 
            member._system_healed || 
            member.healedByScript;

        if (isLegacy || isManual) continue;

        const ref = member.paymentReference;
        if (!ref || !completedRefs.has(ref)) {
            count++;
            
            const refKey = ref ? "has_ref" : "no_ref";
            refCounts[refKey] = (refCounts[refKey] || 0) + 1;
            
            if (ref) {
                refCounts[ref] = (refCounts[ref] || 0) + 1;
            }

            const createdDate = member.createdAt?.toDate?.()?.toISOString() || member.createdAt || "N/A";
            const dateKey = createdDate.substring(0, 10);
            dateCounts[dateKey] = (dateCounts[dateKey] || 0) + 1;

            if (sample.length < 15) {
                sample.push({
                    userId: member.userId || doc.id,
                    email: member.email || "N/A",
                    fullName: member.fullName || "N/A",
                    paymentReference: ref || "(none)",
                    createdAt: createdDate,
                    paymentStatus,
                    status
                });
            }
        }
    }

    console.log(`\nTotal regular active/approved members without completed payment references: ${count}`);
    console.log("\nReference breakdown:");
    console.log(refCounts);
    console.log("\nCreation date distribution (first 20 dates):");
    console.log(Object.entries(dateCounts).sort((a,b) => b[1] - a[1]).slice(0, 20));
    console.log("\nSample members:");
    console.log(sample);
}

main().then(() => process.exit(0)).catch(err => {
    console.error(err);
    process.exit(1);
});
