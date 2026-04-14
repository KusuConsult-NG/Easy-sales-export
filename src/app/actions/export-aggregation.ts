"use server";

import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from '@/lib/logger';
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { createAdminAuditLog } from "@/lib/audit-log-admin";
import { serializeDocs } from "@/lib/firestore-serialize";

/**
 * Export Aggregation System
 * Slot-based export booking with countdown timers
 */

export interface ExportWindow {
    id?: string;
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
    createdBy: string;
}

export interface ExportSlot {
    id?: string;
    windowId: string;
    userId: string;
    userEmail: string;
    fullName: string;
    volume: number; // in kg
    totalCost: number;
    status: "pending" | "confirmed" | "paid" | "shipped";
    bookedAt: FieldValue | Timestamp;
    paidAt?: FieldValue | Timestamp;
}

/**
 * Admin: Create export window
 */
export async function createExportWindowAction(data: {
    title: string;
    commodity: string;
    targetVolume: number;
    slotPrice: number;
    startDate: string;
    endDate: string;
    destination: string;
    adminId: string;
}) {
    try {
        const window: Omit<ExportWindow, "id"> = {
            title: data.title,
            commodity: data.commodity,
            targetVolume: data.targetVolume,
            currentVolume: 0,
            slotPrice: data.slotPrice,
            startDate: new Date(data.startDate),
            endDate: new Date(data.endDate),
            destination: data.destination,
            status: "open",
            createdAt: FieldValue.serverTimestamp(),
            createdBy: data.adminId,
        };

        const docRef = await db.collection(COLLECTIONS.EXPORT_WINDOWS).add(window);

        await createAdminAuditLog({
            action: "user_update",
            userId: data.adminId,
            targetId: docRef.id,
            targetType: "export_window_creation",
            metadata: {
                commodity: data.commodity,
                targetVolume: data.targetVolume,
                destination: data.destination,
            },
        });

        return { success: true, data: { windowId: docRef.id }, meta: null };
    } catch (error) {
        logger.error("Export window creation error:", error);
        return { success: false, data: null, error: "Failed to create export window", meta: null };
    }
}

/**
 * Get active export windows
 */
export async function getActiveExportWindowsAction() {
    try {
        const q = db.collection(COLLECTIONS.EXPORT_WINDOWS).where("status", "==", "open");

        const snapshot = await q.get();

        const windows = serializeDocs(snapshot.docs) as unknown as ExportWindow[];
        return { success: true, data: windows, meta: null };
    } catch (error) {
        logger.error("Failed to fetch export windows:", error);
        return { success: false, data: [], meta: null, error: "Failed to fetch" };
    }
}

/**
 * Book export slot
 */
export async function bookExportSlotAction(data: {
    windowId: string;
    userId: string;
    userEmail: string;
    fullName: string;
    volume: number;
}) {
    try {
        const windowRef = db.collection(COLLECTIONS.EXPORT_WINDOWS).doc(data.windowId);
        const windowDoc = await windowRef.get();

        if (!windowDoc.exists) {
            return { success: false, data: null, error: "Export window not found", meta: null };
        }

        const windowData = windowDoc.data() as ExportWindow;

        if (windowData.status !== "open") {
            return { success: false, data: null, error: "Export window is closed", meta: null };
        }

        if (new Date() > new Date(windowData.endDate)) {
            return { success: false, data: null, error: "Export window has expired", meta: null };
        }

        if (windowData.currentVolume + data.volume > windowData.targetVolume) {
            return {
                success: false,
                data: null,
                meta: null,
                error: `Only ${windowData.targetVolume - windowData.currentVolume}kg available`,
            };
        }

        const totalCost = data.volume * windowData.slotPrice;

        const slot: Omit<ExportSlot, "id"> = {
            windowId: data.windowId,
            userId: data.userId,
            userEmail: data.userEmail,
            fullName: data.fullName,
            volume: data.volume,
            totalCost,
            status: "pending",
            bookedAt: FieldValue.serverTimestamp(),
        };

        const slotRef = await db.collection(COLLECTIONS.EXPORT_SLOTS).add(slot);

        // Update window volume
        await windowRef.update({
            currentVolume: windowData.currentVolume + data.volume,
            updatedAt: FieldValue.serverTimestamp(),
        });

        await createAdminAuditLog({
            action: "user_update",
            userId: data.userId,
            targetId: slotRef.id,
            targetType: "export_slot_booking",
            metadata: {
                windowId: data.windowId,
                volume: data.volume,
                totalCost,
            },
        });

        return { success: true, data: { slotId: slotRef.id }, meta: null };
    } catch (error) {
        logger.error("Slot booking error:", error);
        return { success: false, data: null, error: "Failed to book export slot", meta: null };
    }
}

/**
 * Get user export slots
 */
export async function getUserExportSlotsAction(userId: string) {
    try {
        const q = db.collection(COLLECTIONS.EXPORT_SLOTS).where("userId", "==", userId);

        const snapshot = await q.get();

        const slots = serializeDocs(snapshot.docs) as unknown as ExportSlot[];
        return { success: true, data: slots, meta: null };
    } catch (error) {
        logger.error("Failed to fetch export slots:", error);
        return { success: false, data: [], error: "Fetch failed", meta: null };
    }
}

/**
 * Calculate time remaining for export window
 */
export function calculateTimeRemaining(endDate: Date): {
    days: number;
    hours: number;
    minutes: number;
    seconds: number;
    expired: boolean;
} {
    const now = new Date().getTime();
    const end = new Date(endDate).getTime();
    const diff = end - now;

    if (diff <= 0) {
        return { days: 0, hours: 0, minutes: 0, seconds: 0, expired: true };
    }

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);

    return { days, hours, minutes, seconds, expired: false };
}
