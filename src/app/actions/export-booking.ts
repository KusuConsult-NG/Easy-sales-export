"use server";

import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { auth } from '@/lib/auth';
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue } from "@/lib/firestore-compat";
import { incrementWithinCeiling } from "@/lib/wallet-ledger";
import { serializeDocs } from "@/lib/firestore-serialize";

export interface CreateBookingData { exportWindowId: string;
    quantity: number;
    totalPrice: number; }

/**
 * Create an export booking in Firestore
 */
export async function createBookingAction(data: CreateBookingData) { try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: "Authentication required", data: null as any };
    const { session } = sessionResult;
        if (!session?.user?.id) { return { success: false as const, data: null, error: 'Not authenticated', meta: null };
        }

        // Validate input
        if (!data.exportWindowId || data.quantity <= 0 || data.totalPrice <= 0) { return { success: false as const, data: null, error: 'Invalid booking data', meta: null };
        }

        // Check if export window exists and has availability
        const windowRef = db.collection(COLLECTIONS.EXPORT_WINDOWS).doc(data.exportWindowId);
        const windowDoc = await windowRef.get();

        if (!windowDoc.exists) { return { success: false as const, data: null, error: 'Export window not found', meta: null };
        }

        const windowData = windowDoc.data()!;

        // Reserve the volume under a row lock, BEFORE the booking is written.
        //
        // This read targetVolume - currentVolume, compared, and then raised
        // currentVolume — with no transaction at all, which is why every sweep
        // of the atomic-money migration missed this file: those tables are
        // ordered by runTransaction count and this file has none. Two bookings
        // for the remaining volume both passed and the window went over target.
        //
        // Migration 010 made it worse rather than better, as it did for escrow,
        // cooperative savings and stock: the increments used to lose one
        // another, which hid the overshoot.
        //
        // Reserve first, write second — the losing booker is told the volume is
        // gone rather than ending up with a booking against capacity that does
        // not exist. Same ordering as the farm-nation property reservation.
        //
        // A window with no targetVolume recorded is treated as UNBOUNDED by
        // increment_within_ceiling. That matches the old behaviour rather than
        // changing it: `quantity > (undefined - currentVolume)` is
        // `quantity > NaN`, which is false, so those windows already accepted
        // every booking. admin.ts treats a missing targetVolume as "not
        // crowdfunded", so this is a real category, not a data error.
        const reserved = await incrementWithinCeiling({
            collection: COLLECTIONS.EXPORT_WINDOWS,
            id: data.exportWindowId,
            field: "currentVolume",
            amount: data.quantity,
            ceilingField: "targetVolume",
        });

        if (!reserved.ok) {
            const available = reserved.reason === "at_capacity"
                ? Math.max(0, Number(windowData.targetVolume ?? 0) - Number(reserved.value ?? 0))
                : 0;
            return {
                success: false as const,
                error: reserved.reason === "at_capacity"
                    ? `Only ${available}kg available`
                    : 'Export window not found',
                data: null,
                meta: null
            };
        }

        // Create booking. The volume is already reserved above, so this cannot
        // oversell even if two bookings land together.
        const bookingRef = await db.collection(COLLECTIONS.EXPORT_BOOKINGS).add({
            userId: session.user.id,
            exportWindowId: data.exportWindowId,
            quantity: data.quantity,
            totalPrice: data.totalPrice,
            status: 'pending',
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp()
        });

        await windowRef.update({ updatedAt: FieldValue.serverTimestamp() });

        return { error: null, success: true as const, data: { bookingId: bookingRef.id } };
    } catch (error) {
        logger.error('Create booking error:', error);
        return {
            success: false as const,
            error: 'Failed to create booking',
            data: null,
            meta: null
        };
    }
}

/**
 * Get user's bookings
 */
export async function getUserBookingsAction() { try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: "Authentication required", data: null as any };
    const { session } = sessionResult;
        if (!session?.user?.id) { return { success: false as const, data: null, error: 'Not authenticated', meta: null };
        }

        const snapshot = await db.collection(COLLECTIONS.EXPORT_BOOKINGS)
            .where('userId', '==', session.user.id)
            .orderBy('createdAt', 'desc')
            .get();

        const bookings = serializeDocs(snapshot.docs);

        return { success: true as const, data: bookings, error: null, meta: null };
    } catch (error) { logger.error('Get bookings error:', error);
        return { success: false as const, data: null, error: 'Failed to fetch bookings', meta: null };
    }
}
