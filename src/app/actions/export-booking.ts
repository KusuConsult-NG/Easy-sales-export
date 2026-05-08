'use server';

import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { auth } from '@/lib/auth';
import { db } from '@/lib/firebase-admin';
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue } from 'firebase-admin/firestore';
import { serializeDocs } from "@/lib/firestore-serialize";

export interface CreateBookingData {
    exportWindowId: string;
    quantity: number;
    totalPrice: number;
}

/**
 * Create an export booking in Firestore
 */
export async function createBookingAction(data: CreateBookingData) {
    try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return null as any;
    const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false as const, data: null, error: 'Not authenticated', meta: null };
        }

        // Validate input
        if (!data.exportWindowId || data.quantity <= 0 || data.totalPrice <= 0) {
            return { success: false as const, data: null, error: 'Invalid booking data', meta: null };
        }

        // Check if export window exists and has availability
        const windowRef = db.collection(COLLECTIONS.EXPORT_WINDOWS).doc(data.exportWindowId);
        const windowDoc = await windowRef.get();

        if (!windowDoc.exists) {
            return { success: false as const, data: null, error: 'Export window not found', meta: null };
        }

        const windowData = windowDoc.data()!;
        const availableVolume = windowData.targetVolume - windowData.currentVolume;

        if (data.quantity > availableVolume) {
            return {
                error: "Action failed", success: false as const,
                data: null,
                error: `Only ${availableVolume}kg available`,
                meta: null
            };
        }

        // Create booking
        const bookingRef = await db.collection(COLLECTIONS.EXPORT_BOOKINGS).add({
            userId: session.user.id,
            exportWindowId: data.exportWindowId,
            quantity: data.quantity,
            totalPrice: data.totalPrice,
            status: 'pending',
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });

        // Update export window current volume
        await windowRef.update({
            currentVolume: FieldValue.increment(data.quantity),
            updatedAt: FieldValue.serverTimestamp(),
        });

        return {
            error: null, success: true as const,
            data: { bookingId: bookingRef.id },
            error: null,
            meta: null
        };
    } catch (error) {
        logger.error('Create booking error:', error);
        return {
            error: "Action failed", success: false as const,
            data: null,
            error: 'Failed to create booking',
            meta: null
        };
    }
}

/**
 * Get user's bookings
 */
export async function getUserBookingsAction() {
    try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return null as any;
    const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false as const, data: null, error: 'Not authenticated', meta: null };
        }

        const snapshot = await db.collection(COLLECTIONS.EXPORT_BOOKINGS)
            .where('userId', '==', session.user.id)
            .orderBy('createdAt', 'desc')
            .get();

        const bookings = serializeDocs(snapshot.docs);

        return { success: true as const, data: bookings, error: null, meta: null };
    } catch (error) {
        logger.error('Get bookings error:', error);
        return { success: false as const, data: null, error: 'Failed to fetch bookings', meta: null };
    }
}
