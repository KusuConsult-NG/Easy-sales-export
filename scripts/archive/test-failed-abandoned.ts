import { getAdminDb } from "./src/lib/firebase-admin";
import { COLLECTIONS } from "./src/lib/types/firestore";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

async function run() {
    const db = getAdminDb();
    const emailMap = new Map();
    const snap = await db.collection(COLLECTIONS.FAILED_PAYMENTS).get();
    const userIdsToResolve: string[] = [];

    for (const doc of snap.docs) {
        const data = doc.data();
        if (data.email) {
            const normalizedEmail = data.email.toLowerCase().trim();
            if (!emailMap.has(normalizedEmail)) {
                emailMap.set(normalizedEmail, {
                    uid: data.userId || doc.id,
                    email: normalizedEmail,
                    name: data.customerName || data.fullName || "User",
                    state: "Unknown",
                    onboardingCompleted: false,
                    lastActive: new Date()
                });
            }
        } else if (data.userId) {
            userIdsToResolve.push(data.userId);
        }
    }

    if (userIdsToResolve.length > 0) {
        const uniqueIds = Array.from(new Set(userIdsToResolve));
        for (let i = 0; i < uniqueIds.length; i += 100) {
            const chunk = uniqueIds.slice(i, i + 100);
            const snaps = await db.getAll(...chunk.map(id => db.collection(COLLECTIONS.USERS).doc(id)));
            snaps.forEach((userSnap: any) => {
                if (userSnap.exists) {
                    const u = userSnap.data();
                    const rawEmail = u?.email || u?.userEmail;
                    if (rawEmail) {
                        const normalizedEmail = rawEmail.toLowerCase().trim();
                        if (!emailMap.has(normalizedEmail)) {
                            emailMap.set(normalizedEmail, {
                                uid: userSnap.id,
                                email: normalizedEmail,
                                name: u?.fullName || u?.name || "User",
                                state: u?.state || u?.stateOfOrigin || u?.address?.state || "Unknown",
                                onboardingCompleted: false,
                                lastActive: new Date()
                            });
                        }
                    }
                }
            });
        }
    }

    console.log("Email Map Size:", emailMap.size);
    process.exit(0);
}
run();
