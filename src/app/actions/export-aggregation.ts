"use server";

import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { exportWindowAcceptsInvestment } from "@/lib/export-window-status";
import { logger } from '@/lib/logger';
import { FieldValue } from "@/lib/firestore-compat";
import { Timestamp } from "@/lib/firestore-compat";
import { createAdminAuditLog } from "@/lib/audit-log";
import { incrementWithinCeiling } from "@/lib/wallet-ledger";
import { serializeDocs } from "@/lib/firestore-serialize";
import { requireAdmin } from "@/lib/require-admin";
import { requireSession } from "@/lib/session-guard";

/**
 * Export Aggregation System
 * Slot-based export booking with countdown timers
 */

export interface ExportWindow { id?: string;
    /**
     * Always "aggregation" for a window this file creates. export_windows holds
     * a second entity — private export SHIPMENTS — and nothing on the row said
     * which, so the status vocabulary was one-way: an aggregation window moved
     * onto a shipment status could never be set back to "open" and left the
     * investor browse query for good. See lib/export-window-status.ts.
     */
    windowKind?: "shipment" | "aggregation";
    /** What this window is raising: targetVolume x slotPrice. */
    fundingGoal?: number;
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
        const sessionResult = await requireAdmin("export:approve_applications");
        if ('error' in sessionResult) return { success: false as const, error: sessionResult.error, data: null };

        // The creator is who called, not who the call says.
        //
        // `data.adminId` is a caller parameter and was written as createdBy AND
        // as the audit log's userId, while requireAdmin() had just returned the
        // real actor and it was discarded. So one admin could create a window
        // attributed to another, and the audit entry would corroborate it.
        //
        // Same shape as the dispute assignee in #122 and the property seller in
        // #103: a value the server already holds, taken from the client instead.
        const actingAdminId = (sessionResult as { userId: string }).userId;

        // slotPrice is what a booking is priced from — #127 made it the
        // authoritative figure for createBookingAction, which multiplies it by
        // the tonnage. A window created at zero or below produces bookings that
        // path now refuses, so this is the source side of the same check.
        const slotPrice = Number(data.slotPrice);
        if (!Number.isFinite(slotPrice) || slotPrice <= 0) {
            return { success: false as const, error: "Slot price must be greater than zero", data: null };
        }

        const targetVolume = Number(data.targetVolume);
        if (!Number.isFinite(targetVolume) || targetVolume <= 0) {
            return { success: false as const, error: "Target volume must be greater than zero", data: null };
        }

        const window: Omit<ExportWindow, "id"> = { title: data.title,
            // The AGGREGATION entity — a crowdfunded opportunity, browsed by
            // investors through `where status == "open"`. Stamped so the status
            // rule knows "open" is legal here and "in_transit" is not.
            windowKind: "aggregation" as const,
            // What this window is raising, RECORDED rather than left derivable.
            //
            // Nothing wrote fundingGoal onto a window, so the overfunding
            // machinery in all three fulfilment paths was inert:
            // incrementWithinCeiling treats a missing ceiling field as
            // unbounded, and it reads a STORED field through a Postgres
            // function, so deriving it in JavaScript would not cap anything.
            // admin/_exports.ts already computed this exact number for display
            // and threw it away.
            fundingGoal: targetVolume * slotPrice,
            commodity: data.commodity,
            targetVolume,
            currentVolume: 0,
            slotPrice,
            startDate: new Date(data.startDate),
            endDate: new Date(data.endDate),
            destination: data.destination,
            status: "open",
            createdAt: FieldValue.serverTimestamp(),
            createdBy: actingAdminId };

        const docRef = await db.collection(COLLECTIONS.EXPORT_WINDOWS).add(window);

        await createAdminAuditLog({ action: "user_update",
            userId: actingAdminId,
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

        // WHAT WAS WRONG HERE
        // -------------------
        // requireSession() was called and the result never used again. The slot
        // was booked for `data.userId` — a caller-supplied id — so any
        // authenticated user could book an export slot in anyone's name, and
        // the audit row and notification below both named the nominated user
        // rather than the actor.
        //
        // Authentication standing in for authorisation: the same defect as the
        // vendor writers, _createDisputeAction, and the land listings.
        //
        // Every use in this function is replaced, not just the first. Fixing
        // one copy and leaving its siblings is how this class keeps surviving —
        // it is the mistake made in _submitLandListingAction earlier today,
        // where the write was corrected and the audit log and notification were
        // left reading the request.
        const bookingUserId = sessionResult.session?.user?.id;
        if (!bookingUserId) {
            return { success: false as const, error: "Authentication required", data: null };
        }

        const windowRef = db.collection(COLLECTIONS.EXPORT_WINDOWS).doc(data.windowId);
        const windowDoc = await windowRef.get();

        if (!windowDoc.exists) { return { success: false as const, data: null, error: "Export window not found", meta: null };
        }

        const windowData = windowDoc.data() as ExportWindow;

        // #275 The rule this path already had, now shared — the other two
        // investment doors checked the status and not the deadline, and nothing
        // ever moves a window off "open", so the deadline was the only thing
        // that could refuse an ended window. It only ever refused here.
        const investable = exportWindowAcceptsInvestment(windowData);
        if (!investable.ok) {
            return { success: false as const, data: null, error: investable.message, meta: null };
        }

        // Reserve the volume under a row lock, BEFORE the slot is written.
        //
        // This is the second door onto currentVolume — export-booking.ts
        // createBookingAction is the other — and it was the worse of the two.
        // It checked the ceiling and then wrote:
        //
        //     currentVolume: windowData.currentVolume + data.volume
        //
        // an ABSOLUTE write computed from a read taken moments earlier, not
        // FieldValue.increment. Migration 010 cannot help that: 010 only makes
        // the sentinel atomic, and no sentinel was used. An absolute write does
        // not merely overbook on a concurrent booking — it ERASES any other
        // write to currentVolume in between, including the other door's
        // increment. The window then believes less volume is taken than really
        // is, and the next booking oversells further.
        //
        // Reserve first, write the slot second: the loser is told the volume is
        // gone rather than holding a slot against capacity that does not exist.
        const reserved = await incrementWithinCeiling({
            collection: COLLECTIONS.EXPORT_WINDOWS,
            id: data.windowId,
            field: "currentVolume",
            amount: data.volume,
            ceilingField: "targetVolume",
        });

        if (!reserved.ok) {
            const available = reserved.reason === "at_capacity"
                ? Math.max(0, Number(windowData.targetVolume ?? 0) - Number(reserved.value ?? 0))
                : 0;
            return {
                success: false as const,
                data: null,
                meta: null,
                error: reserved.reason === "at_capacity"
                    ? `Only ${available}kg available`
                    : "Export window not found",
            };
        }

        const totalCost = data.volume * windowData.slotPrice;

        const slot: Omit<ExportSlot, "id"> = { windowId: data.windowId,
            userId: bookingUserId,
            userEmail: data.userEmail,
            fullName: data.fullName,
            volume: data.volume,
            totalCost,
            status: "pending",
            bookedAt: FieldValue.serverTimestamp() };

        const slotRef = await db.collection(COLLECTIONS.EXPORT_SLOTS).add(slot);

        await windowRef.update({ updatedAt: FieldValue.serverTimestamp() });

        await createAdminAuditLog({ action: "user_update",
            userId: bookingUserId,
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

        // requireSession() was called and the result never used again, and the
        // query ran on the CALLER-SUPPLIED userId — so any authenticated user
        // could read anyone's export slots, which carry the booker's name,
        // email and volume.
        //
        // That is the exact defect the comment in bookExportSlotAction, a
        // hundred lines above, describes as fixed — including its warning that
        // "fixing one copy and leaving its siblings is how this class keeps
        // surviving". The sibling was left.
        const viewerId = sessionResult.session?.user?.id;
        if (!viewerId) {
            return { success: false as const, error: "Authentication required", data: null };
        }

        const viewerRoles = sessionResult.session?.user?.roles ?? [];
        const viewerIsAdmin = viewerRoles.some(
            (r: string) => r === "admin" || r === "super_admin" || r === "export_admin"
        );
        if (viewerId !== userId && !viewerIsAdmin) {
            return { success: false as const, error: "Unauthorized", data: null };
        }

        const q = db.collection(COLLECTIONS.EXPORT_SLOTS).where("userId", "==", userId);

        const snapshot = await q.get();

        const slots = serializeDocs(snapshot.docs) as unknown as ExportSlot[];
        return { error: null, success: true as const, data: slots, meta: null };
    } catch (error) { logger.error("Failed to fetch export slots:", error);
        return { success: false as const, data: [], error: "Fetch failed", meta: null };
    }
}

