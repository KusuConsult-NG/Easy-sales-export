import { config } from "dotenv";
config({ path: ".env.local" });
import { db } from "../src/lib/firebase-admin";

async function main() {
    const snap = await db.collection("cooperative_members").get();
    
    let withApprovedAt = 0;
    let withApprovedBy = 0;
    let withReviewedAt = 0;
    let justApproved = 0;

    snap.docs.forEach(doc => {
        const data = doc.data();
        if (data.status === "approved" || data.membershipStatus === "approved" || data.membershipStatus === "active" || data.status === "active") {
            justApproved++;
            if (data.approvedAt) withApprovedAt++;
            if (data.approvedBy) withApprovedBy++;
            if (data.reviewedAt) withReviewedAt++;
        }
    });
    
    console.log(`Total Approved: ${justApproved}`);
    console.log(`With approvedAt: ${withApprovedAt}`);
    console.log(`With approvedBy: ${withApprovedBy}`);
    console.log(`With reviewedAt: ${withReviewedAt}`);
}
main();
