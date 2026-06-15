import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { db } from "../src/lib/firebase-admin";

async function main() {
    const coopSnap = await db.collection("cooperative_members").get();
    
    let total = 0;
    let active = 0;
    let manualActive = 0;
    let csvActive = 0;
    let both = 0;

    // Load CSV
    const fs = require("fs");
    const path = require("path");
    const csvPath = path.join(process.cwd(), "cooperative_member_reconciliation.csv");
    const csvContent = fs.readFileSync(csvPath, "utf8");
    const csvLines = csvContent.split("\n");
    const csvMap = new Map();
    for (let i = 1; i < csvLines.length; i++) {
        const line = csvLines[i].trim();
        if (!line) continue;
        const parts = line.split(",").map(p => p.replace(/"/g, "").trim());
        if (parts.length >= 8) {
            csvMap.set(parts[0], parts[7]);
        }
    }
    
    coopSnap.docs.forEach(doc => {
        total++;
        const data = doc.data();
        const status = data.membershipStatus || data.status || "";
        const isActive = (status === "active" || status === "approved");
        
        if (isActive) {
            active++;
            const isManual = data.approvedBy || data.approvedAt;
            const isCsvActive = csvMap.get(data.userId || doc.id) === "active";
            
            if (isManual) manualActive++;
            if (isCsvActive) csvActive++;
            if (isManual && isCsvActive) both++;
        }
    });
    
    console.log(`Total members: ${total}`);
    console.log(`Active members: ${active}`);
    console.log(`Manually approved active: ${manualActive}`);
    console.log(`CSV active: ${csvActive}`);
    console.log(`Both (overlap): ${both}`);
    console.log(`Unique Active = Manual (${manualActive}) + CSV (${csvActive}) - Overlap (${both}) = ${manualActive + csvActive - both}`);
}

main().catch(console.error).finally(() => process.exit(0));
