import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import { db } from "../src/lib/firebase-admin";
import { COLLECTIONS } from "../src/lib/types/firestore";
import { supabaseAdmin } from "../src/lib/supabase";

async function runMigration() {
    console.log("🚀 Starting Firebase to Supabase Data Migration...");

    // 1. Migrate Users
    await migrateCollection(COLLECTIONS.USERS, "users", (data, id) => ({
        id,
        email: data.email || null,
        roles: data.roles || [],
        raw_data: data
    }));

    // 2. Migrate Cooperative Members
    await migrateCollection(COLLECTIONS.COOPERATIVE_MEMBERS, "cooperative_members", (data, id) => ({
        id,
        user_id: data.uid || data.userId || id || null,
        status: data.status || null,
        raw_data: data
    }));

    // 3. Migrate Cooperative Loans
    await migrateCollection(COLLECTIONS.COOPERATIVE_LOANS, "cooperative_loans", (data, id) => ({
        id,
        user_id: data.userId || null,
        amount: typeof data.amount === "number" ? data.amount : 0.00,
        status: data.status || null,
        raw_data: data
    }));

    // 4. Migrate Transactions
    await migrateCollection(COLLECTIONS.TRANSACTIONS, "transactions", (data, id) => ({
        id,
        user_id: data.userId || null,
        amount: typeof data.amount === "number" ? data.amount : 0.00,
        type: data.type || null,
        status: data.status || null,
        raw_data: data
    }));

    // 5. Migrate Processed Payments
    await migrateCollection(COLLECTIONS.PROCESSED_PAYMENTS, "processed_payments", (data, id) => ({
        id,
        user_id: data.userId || null,
        amount: typeof data.amount === "number" ? data.amount : 0.00,
        reference: data.reference || id || null,
        raw_data: data
    }));

    // 6. Migrate Marketplace Orders
    await migrateCollection("marketplaceOrders", "marketplace_orders", (data, id) => ({
        id,
        user_id: data.userId || null,
        status: data.status || null,
        total_amount: typeof data.totalAmount === "number" ? data.totalAmount : 0.00,
        raw_data: data
    }));

    // 7. Migrate Wallets
    await migrateCollection(COLLECTIONS.WALLETS, "wallets", (data, id) => ({
        id,
        balance: typeof data.balance === "number" ? data.balance : 0.00,
        raw_data: data
    }));

    // 8. Migrate Academy Applications
    await migrateCollection(COLLECTIONS.ACADEMY_APPLICATIONS, "academy_applications", (data, id) => ({
        id,
        user_id: data.userId || null,
        status: data.status || null,
        raw_data: data
    }));

    console.log("🎉 Data Migration Completed successfully!");
    process.exit(0);
}

async function migrateCollection(
    firestoreCollection: string,
    supabaseTable: string,
    transformer: (data: any, id: string) => any
) {
    console.log(`\n📦 Migrating collection [${firestoreCollection}] to table [${supabaseTable}]...`);
    try {
        let lastDoc = null;
        let totalMigrated = 0;
        const limitSize = 500;

        while (true) {
            let query = db.collection(firestoreCollection).orderBy("__name__").limit(limitSize);
            if (lastDoc) {
                query = query.startAfter(lastDoc);
            }

            const snap = await query.get();
            if (snap.empty) {
                break;
            }

            console.log(`Fetched page of ${snap.size} documents from Firestore.`);
            const rows = snap.docs.map(doc => {
                const row = transformer(doc.data(), doc.id);
                return formatTimestamps(row);
            });

            // Upsert batch to Supabase with automatic retries for transient errors
            await upsertWithRetry(supabaseTable, rows);

            totalMigrated += rows.length;
            console.log(`Upserted ${rows.length} rows to [${supabaseTable}]. Cumulative: ${totalMigrated}`);

            lastDoc = snap.docs[snap.docs.length - 1];
            
            // If the returned batch is smaller than limit size, we reached the end
            if (snap.size < limitSize) {
                break;
            }
        }

        console.log(`✅ Completed migration of [${firestoreCollection}]: ${totalMigrated} rows total.`);
    } catch (err) {
        console.error(`❌ Failed to migrate [${firestoreCollection}]:`, err);
    }
}

async function upsertWithRetry(supabaseTable: string, rows: any[], retries = 3, delay = 1000) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const { error } = await supabaseAdmin
                .from(supabaseTable)
                .upsert(rows, { onConflict: "id" });

            if (!error) {
                return; // Success!
            }

            console.warn(`⚠️ [Supabase Upsert] Attempt ${attempt}/${retries} failed for table [${supabaseTable}]: ${error.message || JSON.stringify(error)}`);
            if (attempt === retries) throw error;
        } catch (err: any) {
            console.warn(`⚠️ [Supabase Upsert] Attempt ${attempt}/${retries} threw error for table [${supabaseTable}]: ${err.message || String(err)}`);
            if (attempt === retries) throw err;
        }

        // Wait before retrying (exponential backoff)
        await new Promise(resolve => setTimeout(resolve, delay * attempt));
    }
}

// Recursively convert Firestore Timestamps to ISO strings in JSON payload
function formatTimestamps(obj: any): any {
    if (obj === null || typeof obj !== "object") return obj;

    // Check if it is a Firestore Timestamp object (has toDate() function or _seconds/seconds keys)
    if (typeof obj.toDate === "function") {
        return obj.toDate().toISOString();
    }
    if (obj.constructor && obj.constructor.name === "Timestamp") {
        return new Date(obj.seconds * 1000 + (obj.nanoseconds || 0) / 1000000).toISOString();
    }

    if (Array.isArray(obj)) {
        return obj.map(formatTimestamps);
    }

    const newObj: any = {};
    for (const key of Object.keys(obj)) {
        newObj[key] = formatTimestamps(obj[key]);
    }
    return newObj;
}

runMigration().catch(console.error);
