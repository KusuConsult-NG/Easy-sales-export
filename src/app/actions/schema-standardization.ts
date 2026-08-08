"use server";

import { logger } from "@/lib/logger";
import { adminAuth } from "@/lib/firebase-admin";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue } from "@/lib/firestore-compat";

interface StandardizationReport { collection: string;
    scanned: number;
    updated: number;
    details: string[]; }

/**
 * Run Schema Standardization
 * 
 * Scans core collections and applies default values to missing fields.
 * 
 * @param dryRun If true, only logs changes without writing to DB.
 */
import { requireSession } from "@/lib/session-guard";
import { hasAdminPermission } from "@/lib/admin-permissions";

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
        const usersReport: StandardizationReport = { collection: "users", scanned: 0, updated: 0, details: [] };
        // Validating in batches or just all for now (assuming < 10k users for this script run, otherwise paginate)
        const usersSnapshot = await db.collection(COLLECTIONS.USERS).all().get();
        usersReport.scanned = usersSnapshot.size;

        const userUpdates: Promise<any>[] = [];

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
                if (!dryRun) { userUpdates.push(doc.ref.update(updates));
                }
                usersReport.updated++;
            }
        }

        if (!dryRun) await Promise.all(userUpdates);
        reports.push(usersReport);


        // ============================================================================
        // 2. PRODUCTS COLLECTION (Marketplace)
        // ============================================================================
        const productsReport: StandardizationReport = { collection: "products", scanned: 0, updated: 0, details: [] };
        const productSnapshot = await db.collection(COLLECTIONS.PRODUCTS).get();
        productsReport.scanned = productSnapshot.size;
        const productUpdates: Promise<any>[] = [];

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
                if (!dryRun) { productUpdates.push(doc.ref.update(updates));
                }
                productsReport.updated++;
            }
        }
        if (!dryRun) await Promise.all(productUpdates);
        reports.push(productsReport);


        // ============================================================================
        // 3. EXPORT WINDOWS
        // ============================================================================
        const exportReport: StandardizationReport = { collection: "export_windows", scanned: 0, updated: 0, details: [] };
        const exportSnapshot = await db.collection(COLLECTIONS.EXPORT_WINDOWS).get();
        exportReport.scanned = exportSnapshot.size;
        const exportUpdates: Promise<any>[] = [];

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
                if (!dryRun) { exportUpdates.push(doc.ref.update(updates));
                }
                exportReport.updated++;
            }
        }
        if (!dryRun) await Promise.all(exportUpdates);
        reports.push(exportReport);


        // ============================================================================
        // 4. COOPERATIVES
        // ============================================================================
        const coopReport: StandardizationReport = { collection: "cooperatives", scanned: 0, updated: 0, details: [] };
        const coopSnapshot = await db.collection(COLLECTIONS.COOPERATIVES).get();
        coopReport.scanned = coopSnapshot.size;
        const coopUpdates: Promise<any>[] = [];

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
                if (!dryRun) { coopUpdates.push(doc.ref.update(updates));
                }
                coopReport.updated++;
            }
        }
        if (!dryRun) await Promise.all(coopUpdates);
        reports.push(coopReport);

        // ============================================================================
        // 5. WAVE APPLICATIONS
        // ============================================================================
        const waveReport: StandardizationReport = { collection: "wave_applications", scanned: 0, updated: 0, details: [] };
        const waveSnapshot = await db.collection(COLLECTIONS.WAVE_APPLICATIONS).get();
        waveReport.scanned = waveSnapshot.size;
        const waveUpdates: Promise<any>[] = [];

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
                if (!dryRun) { waveUpdates.push(doc.ref.update(updates));
                }
                waveReport.updated++;
            }
        }
        if (!dryRun) await Promise.all(waveUpdates);
        reports.push(waveReport);


        return { error: null, success: true as const, reports , data: null };

    } catch (error: any) { logger.error("[SCHEMA FIX] Failed:", error);
        return { error: "Action failed", success: false as const, reports: [], data: null }; // Should probably return partial reports
    }
}
