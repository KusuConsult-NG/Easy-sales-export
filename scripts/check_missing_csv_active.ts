import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { db } from "../src/lib/firebase-admin";
import * as fs from "fs";
import * as path from "path";

async function main() {
    const csvPath = path.join(process.cwd(), "cooperative_member_reconciliation.csv");
    if (!fs.existsSync(csvPath)) {
        console.error("CSV file not found!");
        process.exit(1);
    }
    const csvContent = fs.readFileSync(csvPath, "utf8");
    const csvLines = csvContent.split("\n");
    const csvActiveUsers: any[] = [];
    for (let i = 1; i < csvLines.length; i++) {
        const line = csvLines[i].trim();
        if (!line) continue;
        const parts = line.split(",").map(p => p.replace(/"/g, "").trim());
        if (parts.length >= 8 && parts[7] === "active") {
            csvActiveUsers.push({
                userId: parts[0],
                firstName: parts[1],
                lastName: parts[2],
                email: parts[3],
                phone: parts[4],
                hasSubmitted: parts[5],
                hasPaid: parts[6],
                status: parts[7],
                ref: parts[8] || ""
            });
        }
    }

    console.log(`Found ${csvActiveUsers.length} active users in CSV.`);

    const coopSnap = await db.collection("cooperative_members").get();
    const coopUserIds = new Set(coopSnap.docs.map(doc => doc.data().userId || doc.id));

    const missingUsers: any[] = [];

    for (const user of csvActiveUsers) {
        if (!coopUserIds.has(user.userId)) {
            // Check if user doc exists
            const userDoc = await db.collection("users").doc(user.userId).get();
            missingUsers.push({
                ...user,
                userDocExists: userDoc.exists,
                userDocEmail: userDoc.exists ? userDoc.data()?.email : null
            });
        }
    }

    console.log(`\nMissing ${missingUsers.length} users in Firestore cooperative_members:`);
    console.log(JSON.stringify(missingUsers, null, 2));
}

main().catch(console.error).finally(() => process.exit(0));
