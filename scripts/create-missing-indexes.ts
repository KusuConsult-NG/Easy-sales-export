import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { initializeApp, cert } from "firebase-admin/app";

const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

if (!privateKey) throw new Error("Missing FIREBASE_PRIVATE_KEY");

const projectId = process.env.FIREBASE_PROJECT_ID;

const app = initializeApp({
    credential: cert({
        projectId: projectId,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: privateKey,
    }),
});

const missingIndexes = [
    {
        collectionGroup: "transactions",
        fields: [
            { fieldPath: "status", order: "ASCENDING" },
            { fieldPath: "amount", order: "ASCENDING" }
        ]
    },
    {
        collectionGroup: "transactions",
        fields: [
            { fieldPath: "status", order: "ASCENDING" },
            { fieldPath: "date", order: "ASCENDING" },
            { fieldPath: "amount", order: "ASCENDING" }
        ]
    },
    {
        collectionGroup: "cooperative_members",
        fields: [
            { fieldPath: "paymentStatus", order: "ASCENDING" },
            { fieldPath: "registrationFee", order: "ASCENDING" }
        ]
    },
    {
        collectionGroup: "withdrawal_requests",
        fields: [
            { fieldPath: "status", order: "ASCENDING" },
            { fieldPath: "amount", order: "ASCENDING" }
        ]
    },
    {
        collectionGroup: "wave_withdrawals",
        fields: [
            { fieldPath: "status", order: "ASCENDING" },
            { fieldPath: "amount", order: "ASCENDING" }
        ]
    }
];

async function run() {
    console.log("Retrieving administrative access token...");
    const cred = app.options.credential;
    const tokenObj = await (cred as any).getAccessToken();
    const token = tokenObj.access_token;

    console.log(`Successfully obtained token. Deploying ${missingIndexes.length} Composite Indexes to Firestore...\n`);

    for (const index of missingIndexes) {
        const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/collectionGroups/${index.collectionGroup}/indexes`;
        
        try {
            console.log(`Creating index for ${index.collectionGroup}...`);
            const reqUrl = url;
            const res = await fetch(reqUrl, {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${token}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    queryScope: "COLLECTION",
                    fields: index.fields
                })
            });

            const data = await res.json();
            
            if (res.ok) {
                console.log(`✅ Index initiated! (Name: ${data.name})`);
            } else if (data.error && data.error.message && data.error.message.includes("already exists")) {
                console.log(`⚡ Index already exists for ${index.collectionGroup}.`);
            } else if (data.error && data.error.message && data.error.message.includes("already being created")) {
                console.log(`⏳ Index is currently building for ${index.collectionGroup}.`);
            } else {
                console.error(`❌ Failed: ${JSON.stringify(data.error)}`);
            }
        } catch (error: any) {
            console.error(`❌ Error request: ${error.message}`);
        }
    }

    console.log("\nAll index requests have been pushed to Google Cloud.");
    console.log("Note: Firestore takes approximately 1-3 minutes to physically build the indexes in the background.");
}

run().catch(console.error);
