import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { db } from "../src/lib/firebase-admin";
import * as fs from "fs";
import * as path from "path";

async function main() {
    console.log("Reading CSV...");
    const csvPath = path.join(process.cwd(), "cooperative_member_reconciliation.csv");
    if (!fs.existsSync(csvPath)) {
        console.error("CSV file not found!");
        process.exit(1);
    }
    const csvContent = fs.readFileSync(csvPath, "utf8");
    const csvLines = csvContent.split("\n");
    
    // Parse CSV: Map of userId -> csvData
    const csvMap = new Map<string, any>();
    for (let i = 1; i < csvLines.length; i++) {
        const line = csvLines[i].trim();
        if (!line) continue;
        const parts = line.split(",").map(p => p.replace(/"/g, "").trim());
        if (parts.length >= 8) {
            const userId = parts[0];
            csvMap.set(userId, {
                userId,
                firstName: parts[1],
                lastName: parts[2],
                email: parts[3],
                phone: parts[4],
                hasSubmitted: parts[5],
                hasPaid: parts[6],
                status: parts[7],
                ref: parts[8] || ""
            });
        }
    }
    console.log(`Loaded ${csvMap.size} users from CSV.`);

    console.log("Fetching cooperative_members from Firestore...");
    const coopSnap = await db.collection("cooperative_members").get();
    console.log(`Loaded ${coopSnap.size} members from Firestore.`);

    let dbActiveCount = 0;
    let manualApprovedCount = 0;
    let healedCount = 0;
    let otherActiveCount = 0;

    let manualApprovedInCSV = 0;
    let healedInCSV = 0;
    let otherActiveInCSV = 0;

    let csvActiveInDBActive = 0;
    let csvActiveInDBPending = 0;
    let csvActiveNotInDB = 0;

    const manualCSVStatuses: Record<string, number> = {};
    const healedCSVStatuses: Record<string, number> = {};
    const otherCSVStatuses: Record<string, number> = {};

    // We'll analyze each Firestore document
    coopSnap.docs.forEach(doc => {
        const data = doc.data();
        const status = data.membershipStatus || data.status || "";
        const userId = data.userId || doc.id;

        const isActive = (status === "active" || status === "approved");
        if (isActive) {
            dbActiveCount++;
            
            const isHealed = data._system_healed || data.healedByScript || data._system_healed_recovery;
            const isManual = data.approvedBy || data.approvedAt;

            const csvData = csvMap.get(userId);

            if (isHealed) {
                healedCount++;
                if (csvData) {
                    healedInCSV++;
                    healedCSVStatuses[csvData.status] = (healedCSVStatuses[csvData.status] || 0) + 1;
                }
            } else if (isManual) {
                manualApprovedCount++;
                if (csvData) {
                    manualApprovedInCSV++;
                    manualCSVStatuses[csvData.status] = (manualCSVStatuses[csvData.status] || 0) + 1;
                }
            } else {
                otherActiveCount++;
                if (csvData) {
                    otherActiveInCSV++;
                    otherCSVStatuses[csvData.status] = (otherCSVStatuses[csvData.status] || 0) + 1;
                }
            }
        }
    });

    // We'll analyze each CSV document with status "active"
    let csvActiveTotal = 0;
    for (const [userId, csvData] of csvMap.entries()) {
        if (csvData.status === "active") {
            csvActiveTotal++;
            const dbDoc = coopSnap.docs.find(d => (d.data().userId || d.id) === userId);
            if (dbDoc) {
                const dbStatus = dbDoc.data().membershipStatus || dbDoc.data().status || "";
                if (dbStatus === "active" || dbStatus === "approved") {
                    csvActiveInDBActive++;
                } else {
                    csvActiveInDBPending++;
                }
            } else {
                csvActiveNotInDB++;
            }
        }
    }

    console.log("\n=== Cross-Reference Summary ===");
    console.log(`Firestore Active/Approved: ${dbActiveCount}`);
    console.log(`  - Healed / Recovered: ${healedCount} (${healedInCSV} in CSV, ${healedCount - healedInCSV} NOT in CSV)`);
    if (healedInCSV > 0) console.log(`    CSV Statuses for Healed:`, healedCSVStatuses);
    console.log(`  - Manually Approved: ${manualApprovedCount} (${manualApprovedInCSV} in CSV, ${manualApprovedCount - manualApprovedInCSV} NOT in CSV)`);
    if (manualApprovedInCSV > 0) console.log(`    CSV Statuses for Manual:`, manualCSVStatuses);
    console.log(`  - Other Active: ${otherActiveCount} (${otherActiveInCSV} in CSV, ${otherActiveCount - otherActiveInCSV} NOT in CSV)`);
    if (otherActiveInCSV > 0) console.log(`    CSV Statuses for Other:`, otherCSVStatuses);
    
    console.log(`\nCSV Active Members: ${csvActiveTotal}`);
    console.log(`  - Active in Firestore: ${csvActiveInDBActive}`);
    console.log(`  - Pending/Other in Firestore: ${csvActiveInDBPending}`);
    console.log(`  - Not in Firestore at all: ${csvActiveNotInDB}`);
}

main().catch(console.error).finally(() => process.exit(0));
