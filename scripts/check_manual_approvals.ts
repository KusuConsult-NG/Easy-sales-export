import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { db } from "../src/lib/firebase-admin";
import * as fs from "fs";
import * as path from "path";

async function main() {
    const csvPath = path.join(process.cwd(), "cooperative_member_reconciliation.csv");
    if (!fs.existsSync(csvPath)) {
        console.error("CSV file not found!");
        process.exit(1);
    }
    const csvContent = fs.readFileSync(csvPath, "utf8");
    const csvLines = csvContent.split("\n");
    const csvMap = new Map<string, string>();
    for (let i = 1; i < csvLines.length; i++) {
        const line = csvLines[i].trim();
        if (!line) continue;
        const parts = line.split(",").map(p => p.replace(/"/g, "").trim());
        if (parts.length >= 8) {
            csvMap.set(parts[0], parts[7]);
        }
    }

    const coopSnap = await db.collection("cooperative_members").get();
    
    let sampleManualPending: any[] = [];
    let sampleManualNotInCSV: any[] = [];

    coopSnap.docs.forEach(doc => {
        const data = doc.data();
        const status = data.membershipStatus || data.status || "";
        const userId = data.userId || doc.id;
        const isManual = data.approvedBy || data.approvedAt;
        const isActive = (status === "active" || status === "approved");

        if (isActive && isManual) {
            const csvStatus = csvMap.get(userId);
            if (csvStatus === "pending" && sampleManualPending.length < 5) {
                sampleManualPending.push({
                    id: doc.id,
                    email: data.email,
                    fullName: `${data.firstName || ""} ${data.lastName || ""}`.trim(),
                    approvedBy: data.approvedBy || null,
                    approvedAt: data.approvedAt ? (data.approvedAt._seconds ? new Date(data.approvedAt._seconds * 1000) : data.approvedAt) : null,
                    csvStatus
                });
            } else if (!csvStatus && sampleManualNotInCSV.length < 5) {
                sampleManualNotInCSV.push({
                    id: doc.id,
                    email: data.email,
                    fullName: `${data.firstName || ""} ${data.lastName || ""}`.trim(),
                    approvedBy: data.approvedBy || null,
                    approvedAt: data.approvedAt ? (data.approvedAt._seconds ? new Date(data.approvedAt._seconds * 1000) : data.approvedAt) : null,
                    csvStatus: "not_in_csv"
                });
            }
        }
    });

    console.log("Samples of Manually Approved in DB but PENDING in CSV:");
    console.log(JSON.stringify(sampleManualPending, null, 2));

    console.log("\nSamples of Manually Approved in DB but NOT in CSV:");
    console.log(JSON.stringify(sampleManualNotInCSV, null, 2));
}

main().catch(console.error).finally(() => process.exit(0));
