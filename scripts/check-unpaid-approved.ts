import { config } from "dotenv";
config({ path: ".env.local" });
import { db } from "../src/lib/firebase-admin";

async function main() {
    const snap = await db.collection("cooperative_members").get();
    
    let unpaidApproved = 0;
    snap.docs.forEach(doc => {
        const data = doc.data();
        const isActive = data.membershipStatus === "active" || data.membershipStatus === "approved" ||
                         data.status === "active" || data.status === "approved";
        
        if (isActive && data.paymentStatus !== "completed") {
            unpaidApproved++;
            console.log(`User: ${data.userId}, Name: ${data.firstName} ${data.lastName}, membershipStatus: ${data.membershipStatus}, status: ${data.status}, paymentStatus: ${data.paymentStatus}`);
        }
    });
    
    console.log(`Total Unpaid but Approved: ${unpaidApproved}`);
}
main();
