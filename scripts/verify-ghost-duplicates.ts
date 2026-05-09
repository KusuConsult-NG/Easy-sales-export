
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import { db } from "../src/lib/firebase-admin";

async function verifyGhostDiscrepancy() {
    console.log("🔍 Verifying Ghost User Discrepancy...");
    
    const snapshot = await db.collection("users").get();
    
    let totalGhostDocs = 0;
    let ghostsWithNoEmail = 0;
    const emailCounts = new Map();

    snapshot.docs.forEach(doc => {
        const data = doc.data();
        const regs = data.serviceRegistrations || {};
        const hasStartedAny = Object.values(regs).some((r: any) => r.status && r.status !== "not_started");
        
        if (!hasStartedAny) {
            totalGhostDocs++;
            
            const email = data.email || data.userEmail;
            if (!email) {
                ghostsWithNoEmail++;
            } else {
                const norm = email.toLowerCase().trim();
                emailCounts.set(norm, (emailCounts.get(norm) || 0) + 1);
            }
        }
    });

    let duplicateEmailsCount = 0;
    let totalDuplicateDocs = 0;
    const duplicateExamples: string[] = [];

    for (const [email, count] of emailCounts.entries()) {
        if (count > 1) {
            duplicateEmailsCount++;
            totalDuplicateDocs += count;
            if (duplicateExamples.length < 5) {
                duplicateExamples.push(`${email} (${count} accounts)`);
            }
        }
    }

    const uniqueEmailsCount = emailCounts.size;

    console.log("\n=========================================");
    console.log("📊 GHOST USER DISCREPANCY PROOF");
    console.log("=========================================");
    console.log(`Total Ghost Records (CSV):     ${totalGhostDocs}`);
    console.log("-----------------------------------------");
    console.log(`❌ No Email (Skipped):        - ${ghostsWithNoEmail}`);
    console.log(`👯 Duplicate Emails (Merged):  - ${totalDuplicateDocs - duplicateEmailsCount}`);
    console.log("-----------------------------------------");
    console.log(`✅ Unique Recipients (Final):  ${uniqueEmailsCount}`);
    console.log("=========================================");
    
    if (duplicateExamples.length > 0) {
        console.log("\nTop Duplicate Examples:");
        duplicateExamples.forEach(ex => console.log(` - ${ex}`));
    }
}

verifyGhostDiscrepancy().catch(console.error);
