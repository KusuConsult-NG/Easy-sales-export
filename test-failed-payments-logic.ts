import { getAdminDb } from "./src/lib/firebase-admin";
import { COLLECTIONS } from "./src/lib/types/firestore";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

async function run() {
    const db = getAdminDb();
    const snap = await db.collection(COLLECTIONS.FAILED_PAYMENTS).get();
    const emailMap = new Map();
    const userIdsToResolve: string[] = [];

    for (const doc of snap.docs) {
        const data = doc.data();
        let rawEmail = data.customerEmail || data.email;
        let name = data.customerName || data.name || "User";
        
        if (data.metadata?.email) {
            rawEmail = rawEmail || data.metadata.email;
            name = name !== "User" ? name : (data.metadata.name || "User");
        }

        if (rawEmail) {
            const normalizedEmail = rawEmail.toLowerCase().trim();
            if (!emailMap.has(normalizedEmail)) {
                emailMap.set(normalizedEmail, {
                    uid: data.userId || doc.id,
                    email: normalizedEmail,
                    name,
                    state: "Unknown",
                    onboardingCompleted: false,
                    lastActive: data.failedAt ? (data.failedAt.toDate ? data.failedAt.toDate() : new Date(data.failedAt)) : new Date()
                });
            }
        } else if (data.userId) {
            userIdsToResolve.push(data.userId);
        }
    }

    console.log("Email Map Size:", emailMap.size);
    console.log("User IDs to Resolve:", userIdsToResolve.length);
    process.exit(0);
}
run();
