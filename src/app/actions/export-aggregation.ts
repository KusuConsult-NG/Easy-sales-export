"use server";

import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from '@/lib/logger';
import { FieldValue } from "@/lib/firestore-compat";
import { Timestamp } from "@/lib/firestore-compat";
import { createAdminAuditLog } from "@/lib/audit-log";
import { serializeDocs } from "@/lib/firestore-serialize";
import { requireAdmin } from "@/lib/require-admin";
import { requireSession } from "@/lib/session-guard";

/**
 * Export Aggregation System
 * Slot-based export booking with countdown timers
 */

export interface ExportWindow { id?: string;
    title: string;
    commodity: string;
    targetVolume: number; // in kg
    currentVolume: number;
    slotPrice: number; // per kg
    startDate: Date;
    endDate: Date;
    destination: string;
    status: "open" | "closed" | "in_transit" | "completed";
    createdAt: FieldValue | Timestamp;
    createdBy: string; }

export interface ExportSlot { id?: string;
    windowId: string;
    userId: string;
    userEmail: string;
    fullName: string;
    volume: number; // in kg
    totalCost: number;
    status: "pending" | "confirmed" | "paid" | "shipped";
    bookedAt: FieldValue | Timestamp;
    paidAt?: FieldValue | Timestamp; }

/**
 * Admin: Create export window
 */
export async function createExportWindowAction(data: { title: string;
    commodity: string;
    targetVolume: number;
    slotPrice: number;
    startDate: string;
    endDate: string;
    destination: string;
    adminId: string; }) { try {
        const sessionResult = await requireAdmin();
        if ('error' in sessionResult) return { success: false as const, error: sessionResult.error, data: null };

        const window: Omit<ExportWindow, "id"> = { title: data.title,
            commodity: data.commodity,
            targetVolume: data.targetVolume,
            currentVolume: 0,
            slotPrice: data.slotPrice,
            startDate: new Date(data.startDate),
            endDate: new Date(data.endDate),
            destination: data.destination,
            status: "open",
            createdAt: FieldValue.serverTimestamp(),
            createdBy: data.adminId };

        const docRef = await db.collection(COLLECTIONS.EXPORT_WINDOWS).add(window);

        await createAdminAuditLog({ action: "user_update",
            userId: data.adminId,
            targetId: docRef.id,
            targetType: "export_window_creation",
            metadata: {
                commodity: data.commodity,
                targetVolume: data.targetVolume,
                destination: data.destination } });

        return { error: null, success: true as const, data: null, meta: null };
    } catch (error) { logger.error("Export window creation error:", error);
        return { success: false as const, data: null, error: "Failed to create export window", meta: null };
    }
}

/**
 * Get active export windows
 */
export async function getActiveExportWindowsAction() { try {
        const q = db.collection(COLLECTIONS.EXPORT_WINDOWS).where("status", "==", "open");

        const snapshot = await q.get();

        const windows = serializeDocs(snapshot.docs) as unknown as ExportWindow[];
        return { error: null, success: true as const, data: windows, meta: null };
    } catch (error) { logger.error("Failed to fetch export windows:", error);
        return { success: false as const, data: [], meta: null, error: "Failed to fetch" };
    }
}

/**
 * Book export slot
 */
export async function bookExportSlotAction(data: { windowId: string;
    userId: string;
    userEmail: string;
    fullName: string;
    volume: number; }) { try {
        const sessionResult = await requireSession();
        if (sessionResult.error) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };

        const windowRef = db.collection(COLLECTIONS.EXPORT_WINDOWS).doc(data.windowId);
        const windowDoc = await windowRef.get();

        if (!windowDoc.exists) { return { success: false as const, data: null, error: "Export window not found", meta: null };
        }

        const windowData = windowDoc.data() as ExportWindow;

        if (windowData.status !== "open") { return { success: false as const, data: null, error: "Export window is closed", meta: null };
        }

        if (new Date() > new Date(windowData.endDate)) { return { success: false as const, data: null, error: "Export window has expired", meta: null };
        }

        if (windowData.currentVolume + data.volume > windowData.targetVolume) { return { success: false as const, data: null, meta: null, error: `Only ${windowData.targetVolume - windowData.currentVolume }kg available` };
        }

        const totalCost = data.volume * windowData.slotPrice;

        const slot: Omit<ExportSlot, "id"> = { windowId: data.windowId,
            userId: data.userId,
            userEmail: data.userEmail,
            fullName: data.fullName,
            volume: data.volume,
            totalCost,
            status: "pending",
            bookedAt: FieldValue.serverTimestamp() };

        const slotRef = await db.collection(COLLECTIONS.EXPORT_SLOTS).add(slot);

        // Update window volume
        await windowRef.update({ currentVolume: windowData.currentVolume + data.volume,
            updatedAt: FieldValue.serverTimestamp() });

        await createAdminAuditLog({ action: "user_update",
            userId: data.userId,
            targetId: slotRef.id,
            targetType: "export_slot_booking",
            metadata: {
                windowId: data.windowId,
                volume: data.volume,
                totalCost } });

        return { error: null, success: true as const, data: null, meta: null };
    } catch (error) { logger.error("Slot booking error:", error);
        return { success: false as const, data: null, error: "Failed to book export slot", meta: null };
    }
}

/**
 * Get user export slots
 */
export async function getUserExportSlotsAction(userId: string) { try {
        const sessionResult = await requireSession();
        if (sessionResult.error) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };

        const q = db.collection(COLLECTIONS.EXPORT_SLOTS).where("userId", "==", userId);

        const snapshot = await q.get();

        const slots = serializeDocs(snapshot.docs) as unknown as ExportSlot[];
        return { error: null, success: true as const, data: slots, meta: null };
    } catch (error) { logger.error("Failed to fetch export slots:", error);
        return { success: false as const, data: [], error: "Fetch failed", meta: null };
    }
}

