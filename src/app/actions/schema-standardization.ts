"use server";

import { logger } from "@/lib/logger";
import { adminAuth } from "@/lib/firebase-admin";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue } from "@/lib/firestore-compat";

interface StandardizationReport { collection: string;
    scanned: number;
    /** Documents that NEED a change. Named for what it counts. */
    needingUpdate: number;
    /** Writes that actually landed. Zero on a dry run, by definition. */
    updated: number;
    /** Writes that were attempted and failed. */
    failed: number;
    details: string[]; }

/**
 * Apply pending writes in bounded batches, and report what actually landed.
 *
 * Every collection here used to do `await Promise.all(updates)` over one array.
 * On the users collection that is up to 41,105 concurrent HTTP updates fired at
 * once — the file's own comment assumed "< 10k users ... otherwise paginate",
 * and the production export counted 41,105.
 *
 * Promise.all also rejects on the FIRST failure, so one bad write aborted the
 * whole run into the catch block, which returns a generic error and discards
 * every report. A half-applied migration with no record of where it stopped is
 * the worst outcome available to a tool like this.
 *
 * allSettled in chunks: the run finishes, failures are counted rather than
 * thrown, and the report says how many of each.
 */
const WRITE_CHUNK_SIZE = 25;

async function applyUpdates(
    writes: Array<() => Promise<unknown>>,
    report: StandardizationReport
): Promise<void> {
    for (let i = 0; i < writes.length; i += WRITE_CHUNK_SIZE) {
        const chunk = writes.slice(i, i + WRITE_CHUNK_SIZE);
        const settled = await Promise.allSettled(chunk.map((run) => run()));
        for (const outcome of settled) {
            if (outcome.status === "fulfilled") {
                report.updated++;
            } else {
                report.failed++;
                logger.error(`[SCHEMA FIX] ${report.collection} write failed:`, outcome.reason);
            }
        }
    }
}

/**
 * Run Schema Standardization
 * 
 * Scans core collections and applies default values to missing fields.
 * 
 * @param dryRun If true, only logs changes without writing to DB.
 */
import { requireSession } from "@/lib/session-guard";
import { hasAdminPermission } from "@/lib/admin-permissions";
import { recordAdminAction } from "@/lib/audit-log";

export async function runSchemaStandardizationAction(dryRun: boolean = true): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> {
    const { session } = await requireSession();
    if (!session?.user || !hasAdminPermission(session.user.roles, "config:update")) {
        return { success: false, error: "Unauthorized: Admin permission 'config:update' required.", data: null };
    }

    const reports: StandardizationReport[] = [];

    try {
        logger.info(`[SCHEMA FIX] Starting Standardization (DryRun: ${dryRun})...`);

        // ============================================================================
        // 1. USERS COLLECTION
        // ============================================================================
        const usersReport: StandardizationReport = { collection: "users", scanned: 0, needingUpdate: 0, updated: 0, failed: 0, details: [] };
        // Validating in batches or just all for now (assuming < 10k users for this script run, otherwise paginate)
        const usersSnapshot = await db.collection(COLLECTIONS.USERS).all().get();
        usersReport.scanned = usersSnapshot.size;

        const userUpdates: Array<() => Promise<unknown>> = [];

        for (const doc of usersSnapshot.docs) {
            const data = doc.data();
            const updates: Record<string, any> = {};
            const missingFields: string[] = [];

            // 1.1 Roles
            if (!data.roles || !Array.isArray(data.roles)) { updates.roles = ["general_user"];
                missingFields.push("roles");
            }

            // 1.2 isVerified
            if (typeof data.isVerified === 'undefined') { updates.isVerified = false;
                missingFields.push("isVerified");
            }

            // 1.3 Timestamps
            if (!data.createdAt) { updates.createdAt = FieldValue.serverTimestamp();
                missingFields.push("createdAt");
            }
            if (!data.updatedAt) { updates.updatedAt = FieldValue.serverTimestamp();
                missingFields.push("updatedAt");
            }

            // 1.4 Profile Basics
            if (!data.email) { // Try to fetch from Auth? Too expensive here. Just flag.
                // updates.email = "missing@fixme.com"; // Dangerous to guess
            }

            if (Object.keys(updates).length > 0) {
                usersReport.details.push(`User ${doc.id}: Missing [${missingFields.join(", ")}]`);
                if (!dryRun) { userUpdates.push(() => doc.ref.update(updates));
                }
                usersReport.needingUpdate++;
            }
        }

        if (!dryRun) await applyUpdates(userUpdates, usersReport);
        reports.push(usersReport);


        // ============================================================================
        // 2. PRODUCTS COLLECTION (Marketplace)
        // ============================================================================
        const productsReport: StandardizationReport = { collection: "products", scanned: 0, needingUpdate: 0, updated: 0, failed: 0, details: [] };
        const productSnapshot = await db.collection(COLLECTIONS.PRODUCTS).get();
        productsReport.scanned = productSnapshot.size;
        const productUpdates: Array<() => Promise<unknown>> = [];

        for (const doc of productSnapshot.docs) {
            const data = doc.data();
            const updates: Record<string, any> = {};
            const missingFields: string[] = [];

            // 2.1 Status
            if (!data.status) { updates.status = "draft"; // Safe default
                missingFields.push("status");
            }

            // 2.2 Price
            if (typeof data.price === 'undefined') { updates.price = 0;
                missingFields.push("price");
            }

            // 2.3 Stock/Inventory
            // Some implementation might use 'inventory', some 'stock'. Let's standardize on 'quantity' or ensure existing one is set.
            // Assuming 'quantity' or 'availableQuantity' based on previous files seen.
            if (typeof data.quantity === 'undefined' && typeof data.availableQuantity === 'undefined') { updates.availableQuantity = 0;
                missingFields.push("availableQuantity");
            }

            if (Object.keys(updates).length > 0) {
                productsReport.details.push(`Product ${doc.id}: Missing [${missingFields.join(", ")}]`);
                if (!dryRun) { productUpdates.push(() => doc.ref.update(updates));
                }
                productsReport.needingUpdate++;
            }
        }
        if (!dryRun) await applyUpdates(productUpdates, productsReport);
        reports.push(productsReport);


        // ============================================================================
        // 3. EXPORT WINDOWS
        // ============================================================================
        const exportReport: StandardizationReport = { collection: "export_windows", scanned: 0, needingUpdate: 0, updated: 0, failed: 0, details: [] };
        const exportSnapshot = await db.collection(COLLECTIONS.EXPORT_WINDOWS).get();
        exportReport.scanned = exportSnapshot.size;
        const exportUpdates: Array<() => Promise<unknown>> = [];

        for (const doc of exportSnapshot.docs) {
            const data = doc.data();
            const updates: Record<string, any> = {};
            const missingFields: string[] = [];

            if (!data.status) { updates.status = "pending";
                missingFields.push("status");
            }
            if (!data.participants) { updates.participants = [];
                missingFields.push("participants");
            }
            if (typeof data.totalInvested === 'undefined') { updates.totalInvested = 0;
                missingFields.push("totalInvested");
            }

            if (Object.keys(updates).length > 0) {
                exportReport.details.push(`ExportWindow ${doc.id}: Missing [${missingFields.join(", ")}]`);
                if (!dryRun) { exportUpdates.push(() => doc.ref.update(updates));
                }
                exportReport.needingUpdate++;
            }
        }
        if (!dryRun) await applyUpdates(exportUpdates, exportReport);
        reports.push(exportReport);


        // ============================================================================
        // 4. COOPERATIVES
        // ============================================================================
        const coopReport: StandardizationReport = { collection: "cooperatives", scanned: 0, needingUpdate: 0, updated: 0, failed: 0, details: [] };
        const coopSnapshot = await db.collection(COLLECTIONS.COOPERATIVES).get();
        coopReport.scanned = coopSnapshot.size;
        const coopUpdates: Array<() => Promise<unknown>> = [];

        for (const doc of coopSnapshot.docs) {
            const data = doc.data();
            const updates: Record<string, any> = {};
            const missingFields: string[] = [];

            if (!data.status) { updates.status = "pending";
                missingFields.push("status");
            }
            if (!data.members) { updates.members = [];
                missingFields.push("members");
            }
            if (typeof data.totalSavings === 'undefined') { updates.totalSavings = 0;
                missingFields.push("totalSavings");
            }

            if (Object.keys(updates).length > 0) {
                coopReport.details.push(`Cooperative ${doc.id}: Missing [${missingFields.join(", ")}]`);
                if (!dryRun) { coopUpdates.push(() => doc.ref.update(updates));
                }
                coopReport.needingUpdate++;
            }
        }
        if (!dryRun) await applyUpdates(coopUpdates, coopReport);
        reports.push(coopReport);

        // ============================================================================
        // 5. WAVE APPLICATIONS
        // ============================================================================
        const waveReport: StandardizationReport = { collection: "wave_applications", scanned: 0, needingUpdate: 0, updated: 0, failed: 0, details: [] };
        const waveSnapshot = await db.collection(COLLECTIONS.WAVE_APPLICATIONS).get();
        waveReport.scanned = waveSnapshot.size;
        const waveUpdates: Array<() => Promise<unknown>> = [];

        for (const doc of waveSnapshot.docs) {
            const data = doc.data();
            const updates: Record<string, any> = {};
            const missingFields: string[] = [];

            // The main field is status.
            if (!data.status && !data.applicationStatus) { updates.status = "pending";
                missingFields.push("status");
            }
            // Some logic uses applicationStatus, some uses status. Let's fix 'status' as primary if missing.

            if (Object.keys(updates).length > 0) {
                waveReport.details.push(`WaveApp ${doc.id}: Missing [${missingFields.join(", ")}]`);
                if (!dryRun) { waveUpdates.push(() => doc.ref.update(updates));
                }
                waveReport.needingUpdate++;
            }
        }
        if (!dryRun) await applyUpdates(waveUpdates, waveReport);
        reports.push(waveReport);


        await recordAdminAction({
            action: 'system_cleanup',
            userId: session.user.id,
            targetType: 'schema_standardization',
            metadata: { dryRun },
        });
        return { error: null, success: true as const, reports , data: null };

    } catch (error: any) { logger.error("[SCHEMA FIX] Failed:", error);
        return { error: "Action failed", success: false as const, reports: [], data: null }; // Should probably return partial reports
    }
}
