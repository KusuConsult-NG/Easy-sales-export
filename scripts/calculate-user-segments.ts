
import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import { db } from "../src/lib/firebase-admin";
import { COLLECTIONS } from "../src/lib/types/firestore";

async function calculateSegmentation() {
    console.log("📊 Calculating User Segmentation (Mutually Exclusive)...");
    
    const snapshot = await db.collection(COLLECTIONS.USERS).get();
    const totalAccounts = snapshot.size;

    const segments = {
        active_participants: 0, // Has at least one approved/active module
        pending_applicants: 0, // Has at least one pending application, none approved
        stalled_users: 0,      // Has started profile but missing KYC/Bank, no applications
        ghost_users: 0         // No activity, no profile started
    };

    snapshot.docs.forEach(doc => {
        const data = doc.data();
        const regs = data.serviceRegistrations || {};
        
        const hasApproved = Object.values(regs).some((r: any) => 
            r.status === "approved" || r.status === "active" || r.status === "paid" || r.status === "completed"
        );
        
        const hasPending = Object.values(regs).some((r: any) => 
            r.status === "pending" || r.status === "submitted" || r.status === "under_review" || r.status === "briefing"
        );

        const hasStartedAny = Object.values(regs).some((r: any) => r.status && r.status !== "not_started");
        const hasBank = data.verificationProfile?.bankDetails?.bankName && data.verificationProfile?.bankDetails?.bankName !== "N/A";
        const hasAddress = (data.verificationProfile?.address?.state && data.verificationProfile?.address?.state !== "N/A") || (data.address?.state);

        if (hasApproved) {
            segments.active_participants++;
        } else if (hasPending) {
            segments.pending_applicants++;
        } else if (hasStartedAny || hasBank || hasAddress) {
            segments.stalled_users++;
        } else {
            segments.ghost_users++;
        }
    });

    console.log("\n--- USER SEGMENTATION BREAKDOWN ---");
    console.log(`Total Unique Accounts: ${totalAccounts}`);
    console.log("");
    
    Object.entries(segments).forEach(([key, value]) => {
        const percentage = ((value / totalAccounts) * 100).toFixed(1);
        console.log(`${key.replace(/_/g, ' ').toUpperCase()}: ${value} (${percentage}%)`);
    });
}

calculateSegmentation().catch(console.error);
