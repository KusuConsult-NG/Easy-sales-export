
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import { db } from "../src/lib/firebase-admin";

async function verifyCounts() {
    const snapshot = await db.collection("users").get();
    
    const stalledEmails = new Set();
    const ghostEmails = new Set();

    snapshot.docs.forEach(doc => {
        const data = doc.data();
        const regs = data.serviceRegistrations || {};
        const hasStartedAny = Object.values(regs).some((r: any) => r.status && r.status !== "not_started");
        const hasBank = data.verificationProfile?.bankDetails?.bankName && data.verificationProfile?.bankDetails?.bankName !== "N/A";
        const hasAddress = data.verificationProfile?.address?.state && data.verificationProfile?.address?.state !== "N/A";

        const email = data.email || data.userEmail;
        if (!email) return;
        const norm = email.toLowerCase().trim();

        if (hasStartedAny && (!hasBank || !hasAddress)) {
            stalledEmails.add(norm);
        } else if (!hasStartedAny) {
            ghostEmails.add(norm);
        }
    });

    console.log(`Unique Stalled: ${stalledEmails.size}`);
    console.log(`Unique Ghost: ${ghostEmails.size}`);
}

verifyCounts().catch(console.error);
