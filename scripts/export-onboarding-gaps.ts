
import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import { db } from "../src/lib/firebase-admin";

async function exportGaps() {
    console.log("📂 Preparing Communication Exports...");
    
    const snapshot = await db.collection("users").get();
    
    let stalledCsv = "Email,Phone,FullName,StartedModules\n";
    let ghostCsv = "Email,Phone,FullName\n";

    let stalledCount = 0;
    let ghostCount = 0;

    snapshot.docs.forEach(doc => {
        const data = doc.data();
        const email = data.email || "N/A";
        const phone = data.phone || data.phoneNumber || "N/A";
        const name = data.fullName || "Unknown User";
        const regs = data.serviceRegistrations || {};
        
        const startedModules = Object.entries(regs)
            .filter(([_, r]: [any, any]) => r.status && r.status !== "not_started")
            .map(([k, _]) => k)
            .join("; ");

        const hasStartedAny = startedModules.length > 0;
        const hasBank = data.verificationProfile?.bankDetails?.bankName && data.verificationProfile?.bankDetails?.bankName !== "N/A";
        const hasAddress = data.verificationProfile?.address?.state && data.verificationProfile?.address?.state !== "N/A";
        
        if (!hasStartedAny) {
            ghostCsv += `${email},${phone},"${name}"\n`;
            ghostCount++;
        } else if (!hasBank || !hasAddress) {
            stalledCsv += `${email},${phone},"${name}","${startedModules}"\n`;
            stalledCount++;
        }
    });

    fs.writeFileSync("stalled_users.csv", stalledCsv);
    fs.writeFileSync("ghost_users.csv", ghostCsv);

    console.log("\n=========================================");
    console.log("✅ EXPORT COMPLETE");
    console.log("=========================================");
    console.log(`📄 stalled_users.csv: ${stalledCount} records`);
    console.log(`📄 ghost_users.csv:   ${ghostCount} records`);
    console.log("=========================================\n");
}

exportGaps().catch(console.error);
