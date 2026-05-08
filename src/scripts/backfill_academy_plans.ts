
import { db } from "../lib/firebase-admin";
import { COLLECTIONS } from "../lib/types/firestore";
import * as dotenv from "dotenv";
import path from "path";

// Load .env.local
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

async function backfillAcademyPlans() {
    console.log("Starting Academy Plan Backfill...");
    
    const usersSnap = await db.collection(COLLECTIONS.USERS)
        .where("serviceRegistrations.academy.status", "==", "approved")
        .get();
        
    console.log(`Found ${usersSnap.size} approved Academy users.`);
    
    let updated = 0;
    let skipped = 0;
    
    for (const doc of usersSnap.docs) {
        const data = doc.data();
        const academy = data.serviceRegistrations?.academy;
        
        if (academy && !academy.plan) {
            console.log(`Updating user ${doc.id} (${data.email}) to 'elite' plan...`);
            await doc.ref.update({
                "serviceRegistrations.academy.plan": "elite",
                "updatedAt": new Date()
            });
            updated++;
        } else {
            skipped++;
        }
    }
    
    console.log(`Backfill complete. Updated: ${updated}, Skipped: ${skipped}`);
    process.exit(0);
}

backfillAcademyPlans().catch(err => {
    console.error("Backfill failed:", err);
    process.exit(1);
});
