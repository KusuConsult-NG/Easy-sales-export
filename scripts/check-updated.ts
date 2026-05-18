import { config } from "dotenv";
config({ path: ".env.local" });
import { db } from "../src/lib/firebase-admin";

async function main() {
    const snap = await db.collection("cooperative_members").get();
    
    let count = 0;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

    snap.docs.forEach(doc => {
        const data = doc.data();
        if (data.status === "approved" || data.membershipStatus === "approved" || data.membershipStatus === "active" || data.status === "active") {
            // Did I update it? (Check if updatedAt exists and is today)
            // Or maybe there is no updatedAt because my script didn't set it!
            if (!data.updatedAt) {
                // If it has no updatedAt, how do we know when it was updated?
            }
        }
    });
    console.log("Done");
}
main();
