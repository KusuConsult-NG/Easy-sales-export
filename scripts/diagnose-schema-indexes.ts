import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

if (!getApps().length) {
    initializeApp({
        credential: cert({
            projectId: process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL || process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
            privateKey: (process.env.FIREBASE_PRIVATE_KEY || process.env.FIREBASE_ADMIN_PRIVATE_KEY)?.replace(/\\n/g, "\n"),
        }),
    });
}

const db = getFirestore();

// Add new collections here to test their schema consistency and index requirements
const COLLECTIONS_TO_CHECK = [
    "users",
    "export_windows",
    "cooperatives",
    "products",
    "wave_applications",
    "transactions"
];

// Define common queries that require composite indexes
const COMPLEX_QUERIES = {
    users: [
        { field: "role", op: "==", value: "member", order: "createdAt", dir: "desc" },
        { field: "status", op: "==", value: "active", order: "updatedAt", dir: "desc" }
    ],
    export_windows: [
        { field: "status", op: "==", value: "open", order: "createdAt", dir: "desc" },
        { field: "isActive", op: "==", value: true, order: "endDate", dir: "asc" }
    ],
    wave_applications: [
        { field: "status", op: "==", value: "pending", order: "createdAt", dir: "desc" }
    ],
    transactions: [
        { field: "status", op: "==", value: "completed", order: "timestamp", dir: "desc" },
        { field: "userId", op: "==", value: "test", order: "createdAt", dir: "desc" }
    ]
};

async function checkMissingIndexes() {
    console.log("\n🔍 ================== CHECKING MISSING COMPOSITE INDEXES ==================");
    const missingIndexes = [];

    for (const [collection, queries] of Object.entries(COMPLEX_QUERIES)) {
        for (const q of queries) {
            try {
                // Execute a limit 1 query just to test if the index exists
                // If it doesn't, Firebase admin will throw a FAILED_PRECONDITION
                await db.collection(collection)
                    .where(q.field, q.op as any, q.value)
                    .orderBy(q.order, q.dir as any)
                    .limit(1)
                    .get();
                console.log(`  ✅ Index exists: ${collection} -> query [${q.field} ${q.op} ${q.value}, orderBy ${q.order} ${q.dir}]`);
            } catch (error: any) {
                if (error.message && error.message.includes("FAILED_PRECONDITION") && error.message.includes("index")) {
                    console.log(`  ❌ MISSING INDEX: ${collection} -> query [${q.field} ${q.op} ${q.value}, orderBy ${q.order} ${q.dir}]`);
                    
                    // Extract the Firebase URL block
                    const urlMatch = error.message.match(/https:\/\/console\.firebase\.google\.com[^\s]+/);
                    if (urlMatch) {
                        missingIndexes.push(`Collection: ${collection}\nQuery: where(${q.field} ${q.op} ${q.value}).orderBy(${q.order} ${q.dir})\nCreate URL -> ${urlMatch[0]}`);
                    }
                } else if (error.message && error.message.includes("undefined")) {
                     console.log(`  ⚠️ Schema Warning in query ${collection}: You tried to order by a field that is undefined in some documents (${error.message})`);
                } else {
                     console.log(`  ⚠️ Unknown error in index check for ${collection}:`, error.message);
                }
            }
        }
    }

    if (missingIndexes.length > 0) {
        console.log("\n🚨 ACTION REQUIRED: Please create the following missing indexes:");
        missingIndexes.forEach(mi => console.log(`\n${mi}`));
    } else {
        console.log("\n✅ All tested composite indexes are present and valid.");
    }
}

async function checkSchemaProperties() {
    console.log("\n🔍 ================== CHECKING SCHEMA PROPERTIES (UNDEFINED FIELDS) ==================");
    
    for (const collectionName of COLLECTIONS_TO_CHECK) {
        try {
            const snapshot = await db.collection(collectionName).limit(50).get();
            if (snapshot.empty) {
                console.log(`  ➖ ${collectionName}: Collection is empty.`);
                continue;
            }

            let missingCreatedAt = 0;
            let missingUpdatedAt = 0;
            let undefinedVals = 0;

            snapshot.forEach(doc => {
                const data = doc.data();
                if (data.createdAt === undefined) missingCreatedAt++;
                if (data.updatedAt === undefined) missingUpdatedAt++;
                
                // Deep check for explicitly 'undefined' fields which crash firestore cursors
                for (const [key, value] of Object.entries(data)) {
                     if (value === undefined) {
                         undefinedVals++;
                         // console.log(`Doc ${doc.id} in ${collectionName} has explictly undefined value for ${key}`);
                     }
                }
            });

            console.log(`  📊 ${collectionName} (Checked ${snapshot.size} docs):`);
            if (missingCreatedAt > 0 || missingUpdatedAt > 0) {
                console.log(`     ❌ Missing 'createdAt': ${missingCreatedAt} | Missing 'updatedAt': ${missingUpdatedAt} (This causes cursor pagination crashes!)`);
            } else {
                console.log(`     ✅ All docs have standard timestamp fields.`);
            }

            if (undefinedVals > 0) {
                console.log(`     ⚠️ Found ${undefinedVals} fields with EXPLICIT undefined values (Firebase admin discards them but structured inputs might crash it).`);
            }
        } catch (e: any) {
            console.log(`  ⚠️ Error reading ${collectionName}: ${e.message}`);
        }
    }
}


async function main() {
    await checkSchemaProperties();
    await checkMissingIndexes();
    process.exit(0);
}

main();
