
import * as admin from 'firebase-admin';

// Initialize Firebase Admin (Standalone)
require('dotenv').config({ path: '.env.local' });

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        })
    });
}

const db = admin.firestore();

interface StandardizationReport {
    collection: string;
    scanned: number;
    updated: number;
    details: string[];
}

async function runSchemaStandardization(dryRun: boolean = true) {
    const reports: StandardizationReport[] = [];
    console.log(`[SCHEMA FIX] Starting Standardization (DryRun: ${dryRun})...`);

    try {
        // ============================================================================
        // 1. USERS COLLECTION
        // ============================================================================
        const usersReport: StandardizationReport = { collection: "users", scanned: 0, updated: 0, details: [] };
        const usersSnapshot = await db.collection("users").get();
        usersReport.scanned = usersSnapshot.size;
        const userUpdates: Promise<any>[] = [];

        for (const doc of usersSnapshot.docs) {
            const data = doc.data();
            const updates: Record<string, any> = {};
            const missingFields: string[] = [];

            if (!data.roles || !Array.isArray(data.roles)) {
                updates.roles = ["general_user"];
                missingFields.push("roles");
            }
            if (typeof data.isVerified === 'undefined') {
                updates.isVerified = false;
                missingFields.push("isVerified");
            }
            if (!data.createdAt) {
                updates.createdAt = admin.firestore.FieldValue.serverTimestamp();
                missingFields.push("createdAt");
            }
            if (!data.updatedAt) {
                updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();
                missingFields.push("updatedAt");
            }

            if (Object.keys(updates).length > 0) {
                usersReport.details.push(`User ${doc.id}: Missing [${missingFields.join(", ")}]`);
                if (!dryRun) userUpdates.push(doc.ref.update(updates));
                usersReport.updated++;
            }
        }
        if (!dryRun) await Promise.all(userUpdates);
        reports.push(usersReport);

        // ============================================================================
        // 2. PRODUCTS COLLECTION
        // ============================================================================
        const productsReport: StandardizationReport = { collection: "products", scanned: 0, updated: 0, details: [] };
        const productSnapshot = await db.collection("products").get();
        productsReport.scanned = productSnapshot.size;
        const productUpdates: Promise<any>[] = [];

        for (const doc of productSnapshot.docs) {
            const data = doc.data();
            const updates: Record<string, any> = {};
            const missingFields: string[] = [];

            if (!data.status) {
                updates.status = "draft";
                missingFields.push("status");
            }
            if (typeof data.price === 'undefined') {
                updates.price = 0;
                missingFields.push("price");
            }
            if (typeof data.quantity === 'undefined' && typeof data.availableQuantity === 'undefined') {
                updates.availableQuantity = 0; // Standardize?
                missingFields.push("availableQuantity");
            }

            if (Object.keys(updates).length > 0) {
                productsReport.details.push(`Product ${doc.id}: Missing [${missingFields.join(", ")}]`);
                if (!dryRun) productUpdates.push(doc.ref.update(updates));
                productsReport.updated++;
            }
        }
        if (!dryRun) await Promise.all(productUpdates);
        reports.push(productsReport);

        // ============================================================================
        // 3. EXPORT WINDOWS
        // ============================================================================
        const exportReport: StandardizationReport = { collection: "export_windows", scanned: 0, updated: 0, details: [] };
        const exportSnapshot = await db.collection("export_windows").get();
        exportReport.scanned = exportSnapshot.size;
        const exportUpdates: Promise<any>[] = [];

        for (const doc of exportSnapshot.docs) {
            const data = doc.data();
            const updates: Record<string, any> = {};
            const missingFields: string[] = [];

            if (!data.status) {
                updates.status = "pending";
                missingFields.push("status");
            }
            if (!data.participants) {
                updates.participants = [];
                missingFields.push("participants");
            }
            if (typeof data.totalInvested === 'undefined') {
                updates.totalInvested = 0;
                missingFields.push("totalInvested");
            }

            if (Object.keys(updates).length > 0) {
                exportReport.details.push(`ExportWindow ${doc.id}: Missing [${missingFields.join(", ")}]`);
                if (!dryRun) exportUpdates.push(doc.ref.update(updates));
                exportReport.updated++;
            }
        }
        if (!dryRun) await Promise.all(exportUpdates);
        reports.push(exportReport);

        // ============================================================================
        // 4. COOPERATIVES
        // ============================================================================
        const coopReport: StandardizationReport = { collection: "cooperatives", scanned: 0, updated: 0, details: [] };
        const coopSnapshot = await db.collection("cooperatives").get();
        coopReport.scanned = coopSnapshot.size;
        const coopUpdates: Promise<any>[] = [];

        for (const doc of coopSnapshot.docs) {
            const data = doc.data();
            const updates: Record<string, any> = {};
            const missingFields: string[] = [];

            if (!data.status) {
                updates.status = "pending";
                missingFields.push("status");
            }
            if (!data.members) {
                updates.members = [];
                missingFields.push("members");
            }
            if (typeof data.totalSavings === 'undefined') {
                updates.totalSavings = 0;
                missingFields.push("totalSavings");
            }

            if (Object.keys(updates).length > 0) {
                coopReport.details.push(`Cooperative ${doc.id}: Missing [${missingFields.join(", ")}]`);
                if (!dryRun) coopUpdates.push(doc.ref.update(updates));
                coopReport.updated++;
            }
        }
        if (!dryRun) await Promise.all(coopUpdates);
        reports.push(coopReport);

        // ============================================================================
        // 5. WAVE APPLICATIONS
        // ============================================================================
        const waveReport: StandardizationReport = { collection: "wave_applications", scanned: 0, updated: 0, details: [] };
        const waveSnapshot = await db.collection("wave_applications").get();
        waveReport.scanned = waveSnapshot.size;
        const waveUpdates: Promise<any>[] = [];

        for (const doc of waveSnapshot.docs) {
            const data = doc.data();
            const updates: Record<string, any> = {};
            const missingFields: string[] = [];

            if (!data.status && !data.applicationStatus) {
                updates.status = "pending";
                missingFields.push("status");
            }

            if (Object.keys(updates).length > 0) {
                waveReport.details.push(`WaveApp ${doc.id}: Missing [${missingFields.join(", ")}]`);
                if (!dryRun) waveUpdates.push(doc.ref.update(updates));
                waveReport.updated++;
            }
        }
        if (!dryRun) await Promise.all(waveUpdates);
        reports.push(waveReport);

        // REPORT
        console.log("\n[SCHEMA FIX REPORT]");
        reports.forEach(r => {
            console.log(`\nCollection: ${r.collection}`);
            console.log(`  Scanned: ${r.scanned}`);
            console.log(`  Updated: ${r.updated} (DryRun: ${dryRun})`);
            if (r.details.length > 0) {
                console.log("  Details:");
                r.details.forEach(d => console.log(`    - ${d}`));
            } else {
                console.log("  Status: Clean");
            }
        });

    } catch (error) {
        console.error("Migration failed:", error);
    }
}

// Check for --wet-run flag
const args = process.argv.slice(2);
const dryRun = !args.includes('--wet-run');

runSchemaStandardization(dryRun)
    .then(() => process.exit(0))
    .catch(e => {
        console.error(e);
        process.exit(1);
    });
