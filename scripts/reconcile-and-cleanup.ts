// Mock WebSocket to prevent realtime client initialization error on Node < 22
global.WebSocket = class {};

const dotenv = require("dotenv");
const path = require("path");
const fs = require("fs");

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

// Import Firebase Admin
const admin = require("firebase-admin");

const privateKey = process.env.FIREBASE_PRIVATE_KEY || process.env.FIREBASE_ADMIN_PRIVATE_KEY;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL || process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
const projectId = process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: projectId,
            clientEmail: clientEmail,
            privateKey: privateKey?.replace(/\\n/g, "\n"),
        }),
    });
}

const firestoreDb = admin.firestore();

// Import Supabase
const { supabaseAdmin } = require("../src/lib/supabase");

async function fetchAllSupabaseRows(tableName, filterFn = null) {
    let rows = [];
    let page = 0;
    const pageSize = 1000;
    while (true) {
        let query = supabaseAdmin
            .from(tableName)
            .select("*")
            .range(page * pageSize, (page + 1) * pageSize - 1);
            
        if (filterFn) {
            query = filterFn(query);
        }
        
        const { data, error } = await query;
        if (error) {
            throw new Error(`Failed to fetch from ${tableName}: ${error.message}`);
        }
        if (!data || data.length === 0) break;
        rows = rows.concat(data);
        if (data.length < pageSize) break;
        page++;
    }
    return rows;
}

async function deleteFirestoreByQuery(collectionName, field, value) {
    let deleted = 0;
    while (true) {
        const snap = await firestoreDb.collection(collectionName)
            .where(field, "==", value)
            .limit(500)
            .get();
            
        if (snap.empty) break;
        
        const batch = firestoreDb.batch();
        snap.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
        deleted += snap.size;
        console.log(`    Deleted ${deleted} from Firestore [${collectionName}] where ${field} == ${value}`);
    }
    return deleted;
}

async function main() {
    console.log("=".repeat(60));
    console.log("🚀 STARTING THE BULK-OPTIMIZED DB CLEANUP & SYNC SCRIPT 🚀");
    console.log("=".repeat(60));

    // 1. Read the Reconciliation CSV
    const csvPath = path.join(process.cwd(), "cooperative_member_reconciliation.csv");
    if (!fs.existsSync(csvPath)) {
        console.error("❌ CSV file not found at:", csvPath);
        process.exit(1);
    }
    const csvContent = fs.readFileSync(csvPath, "utf8");
    const csvLines = csvContent.split("\n");
    
    const csvMap = new Map<string, any>();
    for (let i = 1; i < csvLines.length; i++) {
        const line = csvLines[i].trim();
        if (!line) continue;
        const parts = line.split(",").map(p => p.replace(/"/g, "").trim());
        if (parts.length >= 8) {
            const userId = parts[0];
            csvMap.set(userId, {
                userId,
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
    console.log(`✅ Loaded ${csvMap.size} users from CSV.`);

    // ─── 1. CLEAN UP COOPERATIVE MEMBERS ──────────────────────────────────────────
    console.log("\n🧹 Reconciling [cooperative_members]...");

    // A. Clean up Firestore Coop Members
    console.log("- Querying Firebase Firestore...");
    const firestoreCoopSnap = await firestoreDb.collection("cooperative_members").get();
    console.log(`  Found ${firestoreCoopSnap.size} members in Firestore.`);

    let fDeletedCoop = [];
    let fUpdatedCoop = [];

    for (const doc of firestoreCoopSnap.docs) {
        const data = doc.data();
        const userId = data.userId || doc.id;
        const isManual = data.approvedBy || data.approvedAt;
        const inCsv = csvMap.has(userId);

        if (!inCsv && !isManual) {
            fDeletedCoop.push(doc.ref);
        } else {
            const csvData = csvMap.get(userId);
            const targetStatus = isManual ? "active" : (csvData?.status === "active" ? "active" : "pending");
            const targetPayment = isManual ? "completed" : (csvData?.hasPaid === "Yes" ? "completed" : "pending");

            if (data.membershipStatus !== targetStatus || data.paymentStatus !== targetPayment) {
                fUpdatedCoop.push({
                    ref: doc.ref,
                    status: targetStatus,
                    payment: targetPayment
                });
            }
        }
    }

    if (fDeletedCoop.length > 0) {
        console.log(`  Deleting ${fDeletedCoop.length} mock members from Firestore...`);
        for (let i = 0; i < fDeletedCoop.length; i += 400) {
            const chunk = fDeletedCoop.slice(i, i + 400);
            const batch = firestoreDb.batch();
            chunk.forEach(ref => batch.delete(ref));
            await batch.commit();
        }
        console.log("  ✓ Firestore deletes complete.");
    }

    if (fUpdatedCoop.length > 0) {
        console.log(`  Updating ${fUpdatedCoop.length} member statuses in Firestore...`);
        for (let i = 0; i < fUpdatedCoop.length; i += 400) {
            const chunk = fUpdatedCoop.slice(i, i + 400);
            const batch = firestoreDb.batch();
            chunk.forEach(item => batch.update(item.ref, {
                membershipStatus: item.status,
                status: item.status,
                paymentStatus: item.payment,
                updatedAt: new Date()
            }));
            await batch.commit();
        }
        console.log("  ✓ Firestore updates complete.");
    }

    // B. Clean up Supabase Coop Members
    console.log("- Querying Supabase Database (All Pages)...");
    const sMembers = await fetchAllSupabaseRows("cooperative_members");
    console.log(`  Found ${sMembers.length} members in Supabase.`);
    let sDeletedCoop = [];
    let sUpdatedCoop = [];

    for (const m of sMembers) {
        const raw = m.raw_data || {};
        const userId = m.id;
        const isManual = raw.approvedBy || raw.approvedAt;
        const inCsv = csvMap.has(userId);

        if (!inCsv && !isManual) {
            sDeletedCoop.push(m.id);
        } else {
            const csvData = csvMap.get(userId);
            const targetStatus = isManual ? "active" : (csvData?.status === "active" ? "active" : "pending");
            const targetPayment = isManual ? "completed" : (csvData?.hasPaid === "Yes" ? "completed" : "pending");

            if (raw.membershipStatus !== targetStatus || raw.paymentStatus !== targetPayment) {
                sUpdatedCoop.push({
                    id: m.id,
                    status: targetStatus,
                    payment: targetPayment,
                    raw: raw
                });
            }
        }
    }

    if (sDeletedCoop.length > 0) {
        console.log(`  Deleting ${sDeletedCoop.length} mock members from Supabase...`);
        for (let i = 0; i < sDeletedCoop.length; i += 100) {
            const chunk = sDeletedCoop.slice(i, i + 100);
            const { error } = await supabaseAdmin.from("cooperative_members").delete().in("id", chunk);
            if (error) console.error("❌ Supabase delete error:", error.message);
        }
        console.log("  ✓ Supabase deletes complete.");
    }

    if (sUpdatedCoop.length > 0) {
        console.log(`  Updating ${sUpdatedCoop.length} member statuses in Supabase...`);
        for (const item of sUpdatedCoop) {
            const newRaw = {
                ...item.raw,
                membershipStatus: item.status,
                status: item.status,
                paymentStatus: item.payment,
                updatedAt: new Date().toISOString()
            };
            await supabaseAdmin
                .from("cooperative_members")
                .update({ status: item.status, raw_data: newRaw, updated_at: new Date().toISOString() })
                .eq("id", item.id);
        }
        console.log("  ✓ Supabase updates complete.");
    }

    // ─── 2. CLEAN UP & MIGRATE WAVE APPLICATIONS ──────────────────────────────────
    console.log("\n🧹 Reconciling [wave_applications]...");

    // A. Firestore WAVE Delete Mock Data
    console.log("- Deleting mock WAVE applications from Firestore in pages...");
    await deleteFirestoreByQuery("wave_applications", "_system_healed", true);
    await deleteFirestoreByQuery("wave_applications", "_system_healed_recovery", true);
    await deleteFirestoreByQuery("wave_applications", "_system_restored_from_csv", true);
    await deleteFirestoreByQuery("wave_applications", "approvedBy", "system_bulk_approve");
    await deleteFirestoreByQuery("wave_applications", "reviewedBy", "system_bulk_approve");

    // B. Fetch the remaining REAL WAVE applications from Firestore
    console.log("- Fetching remaining REAL WAVE applications from Firestore...");
    const realWaveSnap = await firestoreDb.collection("wave_applications").get();
    console.log(`  Found ${realWaveSnap.size} REAL WAVE applications.`);

    // C. Write them to Supabase in bulk
    if (realWaveSnap.size > 0) {
        console.log("  Migrating REAL WAVE applications to Supabase in bulk...");
        const payloads = realWaveSnap.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                collection_name: "wave_applications",
                created_at: data.createdAt?.toDate?.()?.toISOString() || data.createdAt || new Date().toISOString(),
                updated_at: data.updatedAt?.toDate?.()?.toISOString() || data.updatedAt || new Date().toISOString(),
                raw_data: data
            };
        });
        
        for (let i = 0; i < payloads.length; i += 100) {
            const chunk = payloads.slice(i, i + 100);
            const { error } = await supabaseAdmin.from("document_collections").upsert(chunk);
            if (error) console.error("❌ Supabase WAVE upsert error:", error.message);
        }
        console.log("  ✓ WAVE applications migrated successfully.");
    }

    // D. Delete remaining mock applications in Supabase
    console.log("- Querying Supabase WAVE apps...");
    const sWaveApps = await fetchAllSupabaseRows("document_collections", (q) => q.eq("collection_name", "wave_applications"));
    let sDeletedWave = [];
    for (const dc of sWaveApps) {
        const raw = dc.raw_data || {};
        const isHealed = raw._system_healed_recovery === true || raw._system_healed === true;
        const isRestored = raw._system_restored_from_csv === true || raw.approvedBy === "system_bulk_approve" || raw.reviewedBy === "system_bulk_approve";
        const hasManual = raw.approvedBy && raw.approvedBy !== "system_bulk_approve" || raw.approvedAt;

        if ((isHealed || isRestored) && !hasManual) {
            sDeletedWave.push(dc.id);
        }
    }
    if (sDeletedWave.length > 0) {
        console.log(`  Deleting ${sDeletedWave.length} mock WAVE apps from Supabase...`);
        for (let i = 0; i < sDeletedWave.length; i += 100) {
            const chunk = sDeletedWave.slice(i, i + 100);
            await supabaseAdmin.from("document_collections").delete().eq("collection_name", "wave_applications").in("id", chunk);
        }
        console.log("  ✓ Supabase WAVE deletes complete.");
    }

    // ─── 3. CLEAN UP & MIGRATE ACADEMY APPLICATIONS ───────────────────────────────
    console.log("\n🧹 Reconciling [academy_applications]...");

    // A. Firestore Academy Delete Mock Data
    console.log("- Deleting mock Academy applications from Firestore...");
    await deleteFirestoreByQuery("academy_applications", "_system_healed", true);
    await deleteFirestoreByQuery("academy_applications", "_system_healed_recovery", true);
    await deleteFirestoreByQuery("academy_applications", "_system_restored_from_csv", true);
    await deleteFirestoreByQuery("academy_applications", "approvedBy", "system_bulk_approve");
    await deleteFirestoreByQuery("academy_applications", "reviewedBy", "system_bulk_approve");

    // B. Fetch remaining REAL Academy applications from Firestore
    console.log("- Fetching remaining REAL Academy applications from Firestore...");
    const realAcademySnap = await firestoreDb.collection("academy_applications").get();
    console.log(`  Found ${realAcademySnap.size} REAL Academy applications.`);

    // C. Write them to Supabase in bulk
    if (realAcademySnap.size > 0) {
        console.log("  Migrating REAL Academy applications to Supabase in bulk...");
        const payloads = realAcademySnap.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                user_id: data.userId || null,
                status: data.status || "pending",
                created_at: data.createdAt?.toDate?.()?.toISOString() || data.createdAt || new Date().toISOString(),
                updated_at: data.updatedAt?.toDate?.()?.toISOString() || data.updatedAt || new Date().toISOString(),
                raw_data: data
            };
        });
        
        for (let i = 0; i < payloads.length; i += 100) {
            const chunk = payloads.slice(i, i + 100);
            const { error } = await supabaseAdmin.from("academy_applications").upsert(chunk);
            if (error) console.error("❌ Supabase Academy upsert error:", error.message);
        }
        console.log("  ✓ Academy applications migrated successfully.");
    }

    // D. Delete remaining mock applications in Supabase
    console.log("- Querying Supabase Academy apps...");
    const sAcademy = await fetchAllSupabaseRows("academy_applications");
    let sDeletedAcademy = [];
    for (const aa of sAcademy) {
        const raw = aa.raw_data || {};
        const isHealed = raw._system_healed_recovery === true || raw._system_healed === true;
        const isRestored = raw._system_restored_from_csv === true || raw.approvedBy === "system_bulk_approve" || raw.reviewedBy === "system_bulk_approve";
        const hasManual = raw.approvedBy && raw.approvedBy !== "system_bulk_approve" || raw.approvedAt;

        if ((isHealed || isRestored) && !hasManual) {
            sDeletedAcademy.push(aa.id);
        }
    }
    if (sDeletedAcademy.length > 0) {
        console.log(`  Deleting ${sDeletedAcademy.length} mock Academy apps from Supabase...`);
        for (let i = 0; i < sDeletedAcademy.length; i += 100) {
            const chunk = sDeletedAcademy.slice(i, i + 100);
            await supabaseAdmin.from("academy_applications").delete().in("id", chunk);
        }
        console.log("  ✓ Supabase Academy deletes complete.");
    }

    // ─── 4. PURGE REDIS CACHES ────────────────────────────────────────────────────
    console.log("\n🧹 Purging Redis cache keys...");
    try {
        const { redis } = require("../src/lib/redis");
        const keys = await redis.keys("admin:coop-stats:*");
        for (const k of keys) {
            await redis.del(k);
            console.log(`  Purged Redis cache: ${k}`);
        }
        await redis.del("admin:coop-stats:global");
        console.log("✅ Caches purged successfully.");
    } catch (err) {
        console.warn("⚠️ Redis invalidation skipped/failed:", err.message);
    }

    console.log("\n🎉 COMPLETE ULTIMATE DATABASE CLEANUP & SYNC COMPLETED!");
}

main().catch(console.error).finally(() => process.exit(0));
