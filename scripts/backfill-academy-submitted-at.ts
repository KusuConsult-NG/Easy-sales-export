import * as admin from 'firebase-admin';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        }),
    });
}

const db = admin.firestore();

async function backfill() {
    console.log("Starting backfill for academy_applications missing submittedAt...");
    const snapshot = await db.collection("academy_applications").get();
    let updatedCount = 0;

    for (const doc of snapshot.docs) {
        const data = doc.data();
        if (!data.submittedAt) {
            console.log(`Document ${doc.id} is missing submittedAt. Backfilling...`);
            const fallbackDate = data.createdAt || admin.firestore.FieldValue.serverTimestamp();
            await doc.ref.update({
                submittedAt: fallbackDate
            });
            updatedCount++;
        }
    }
    
    console.log(`Done! Updated ${updatedCount} documents.`);
}

backfill().catch(console.error).finally(() => process.exit(0));
