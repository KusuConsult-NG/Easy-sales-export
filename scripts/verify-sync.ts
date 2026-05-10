import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { db, adminAuth } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";

async function verifySync() {
    console.log("Starting Data Synchronization Verification...");
    let synced = 0;
    let outOfSync = 0;

    // Get all Auth users
    let nextPageToken: string | undefined;
    do {
        const listUsersResult = await adminAuth.listUsers(1000, nextPageToken);
        const users = listUsersResult.users;

        const chunks = [];
        for (let i = 0; i < users.length; i += 50) {
            chunks.push(users.slice(i, i + 50));
        }

        for (const chunk of chunks) {
            const refs = chunk.map(u => db.collection(COLLECTIONS.USERS).doc(u.uid));
            const docs = await db.getAll(...refs);

            for (let i = 0; i < docs.length; i++) {
                const doc = docs[i];
                const authUser = chunk[i];

                if (!doc.exists) {
                    console.log(`[OUT OF SYNC] Missing Firestore document for Auth UID: ${authUser.uid} (${authUser.email})`);
                    outOfSync++;
                } else {
                    const data = doc.data();
                    if (!data?.email) {
                        console.log(`[OUT OF SYNC] Missing email field in Firestore for Auth UID: ${authUser.uid}`);
                        outOfSync++;
                    } else if (data.email !== authUser.email) {
                        console.log(`[OUT OF SYNC] Email mismatch for UID: ${authUser.uid} (Auth: ${authUser.email}, DB: ${data.email})`);
                        outOfSync++;
                    } else {
                        synced++;
                    }
                }
            }
        }

        nextPageToken = listUsersResult.pageToken;
    } while (nextPageToken);

    console.log("--- Sync Verification Complete ---");
    console.log(`Synced Users: ${synced}`);
    console.log(`Out of Sync Users: ${outOfSync}`);

    if (outOfSync > 0) {
        console.error("WARNING: Data desynchronization detected!");
        process.exit(1);
    }
}

verifySync().catch(console.error);
