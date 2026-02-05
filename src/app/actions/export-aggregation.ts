"use server";

import { doc, setDoc, getDoc, collection, addDoc, query, where, getDocs, updateDoc, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { createAuditLog } from "@/lib/audit-log";

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
    createdAt: Timestamp;
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
    bookedAt: Timestamp;
    paidAt?: Timestamp;
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
}): Promise<{ success: boolean; error?: string; windowId?: string }> {
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
            createdAt: Timestamp.now(),
            createdBy: data.adminId,
        };

        const docRef = await addDoc(collection(db, "export_windows"), window);

        await createAuditLog({
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

        return { success: true, windowId: docRef.id };
    } catch (error) {
        console.error("Export window creation error:", error);
        return { success: false, error: "Failed to create export window" };
    }
}

/**
 * Get active export windows
 */
export async function getActiveExportWindowsAction(): Promise<ExportWindow[]> {
    try {
        const q = query(
            collection(db, "export_windows"),
            where("status", "==", "open")
        );

        const snapshot = await getDocs(q);

        return snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
        })) as ExportWindow[];
    } catch (error) {
        console.error("Failed to fetch export windows:", error);
        return [];
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
}): Promise<{ success: boolean; error?: string; slotId?: string }> {
    try {
        const windowRef = doc(db, "export_windows", data.windowId);
        const windowDoc = await getDoc(windowRef);

        if (!windowDoc.exists()) {
            return { success: false, error: "Export window not found" };
        }

        const windowData = windowDoc.data() as ExportWindow;

        if (windowData.status !== "open") {
            return { success: false, error: "Export window is closed" };
        }

        if (new Date() > new Date(windowData.endDate)) {
            return { success: false, error: "Export window has expired" };
        }

        if (windowData.currentVolume + data.volume > windowData.targetVolume) {
            return {
                success: false,
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
            bookedAt: Timestamp.now(),
        };

        const slotRef = await addDoc(collection(db, "export_slots"), slot);

        // Update window volume
        await updateDoc(windowRef, {
            currentVolume: windowData.currentVolume + data.volume,
        });

        await createAuditLog({
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

        return { success: true, slotId: slotRef.id };
    } catch (error) {
        console.error("Slot booking error:", error);
        return { success: false, error: "Failed to book export slot" };
    }
}

/**
 * Get user export slots
 */
export async function getUserExportSlotsAction(userId: string): Promise<ExportSlot[]> {
    try {
        const q = query(
            collection(db, "export_slots"),
            where("userId", "==", userId)
        );

        const snapshot = await getDocs(q);

        return snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
        })) as ExportSlot[];
    } catch (error) {
        console.error("Failed to fetch export slots:", error);
        return [];
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
