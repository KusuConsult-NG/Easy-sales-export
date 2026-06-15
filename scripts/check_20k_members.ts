import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { db } from "../src/lib/firebase-admin";

async function main() {
    const coopSnap = await db.collection("cooperative_members").get();
    
    let count20k = 0;
    const samples20k: any[] = [];
    
    coopSnap.docs.forEach(doc => {
        const data = doc.data();
        if (data.registrationFee === 20000) {
            count20k++;
            if (samples20k.length < 5) {
                samples20k.push({
                    id: doc.id,
                    email: data.email || "",
                    fullName: `${data.firstName || ""} ${data.lastName || ""}`.trim(),
                    registrationFee: data.registrationFee,
                    paymentStatus: data.paymentStatus || null,
                    membershipStatus: data.membershipStatus || null
                });
            }
        }
    });

    console.log(`Found ${count20k} members with registrationFee === 20000.`);
    if (count20k > 0) {
        console.log("Samples:", JSON.stringify(samples20k, null, 2));
    }
}

main().catch(console.error).finally(() => process.exit(0));
