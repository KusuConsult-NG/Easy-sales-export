import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { db } from "../src/lib/firebase-admin";

async function main() {
    const coopSnap = await db.collection("cooperative_members").get();
    
    let activeWithFee = 0;
    let activeZeroOrMissingFee = 0;
    let totalActive = 0;
    
    const sampleMissing: any[] = [];

    coopSnap.docs.forEach(doc => {
        const data = doc.data();
        const status = data.membershipStatus || data.status || "";
        const isActive = (status === "active" || status === "approved");
        
        if (isActive) {
            totalActive++;
            const fee = data.registrationFee;
            if (fee && fee > 0) {
                activeWithFee++;
            } else {
                activeZeroOrMissingFee++;
                if (sampleMissing.length < 5) {
                    sampleMissing.push({
                        id: doc.id,
                        email: data.email || "",
                        fullName: `${data.firstName || ""} ${data.lastName || ""}`.trim(),
                        registrationFee: fee ?? null,
                        amountPaid: data.amountPaid ?? null,
                        paymentStatus: data.paymentStatus ?? null,
                        _importSource: data._importSource ?? null,
                        _created_by_reconcile: data._created_by_reconcile ?? null
                    });
                }
            }
        }
    });

    console.log(`=== Registration Fee Audit ===`);
    console.log(`Total Active Members: ${totalActive}`);
    console.log(`  - Has valid registrationFee > 0: ${activeWithFee}`);
    console.log(`  - Has registrationFee missing, undefined, or 0: ${activeZeroOrMissingFee}`);
    
    console.log("\nSamples of missing/zero registrationFee docs:");
    console.log(JSON.stringify(sampleMissing, null, 2));
}

main().catch(console.error).finally(() => process.exit(0));
