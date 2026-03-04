'use server';

import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { auth } from '@/lib/auth';
import { db } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

export interface CreateBookingData {
    exportWindowId: string;
    quantity: number;
    totalPrice: number;
}

/**
 * Create an export booking in Firestore
 */
export async function createBookingAction(data: CreateBookingData): Promise<{
    success: boolean;
    bookingId?: string;
    error?: string;
}> {
    try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return null as any;
    const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false, error: 'Not authenticated' };
        }

        // Validate input
        if (!data.exportWindowId || data.quantity <= 0 || data.totalPrice <= 0) {
            return { success: false, error: 'Invalid booking data' };
        }

        // Check if export window exists and has availability
        const windowRef = db.collection('export_windows').doc(data.exportWindowId);
        const windowDoc = await windowRef.get();

        if (!windowDoc.exists) {
            return { success: false, error: 'Export window not found' };
        }

        const windowData = windowDoc.data()!;
        const availableVolume = windowData.targetVolume - windowData.currentVolume;

        if (data.quantity > availableVolume) {
            return {
                success: false,
                error: `Only ${availableVolume}kg available`
            };
        }

        // Create booking
        const bookingRef = await db.collection('export_bookings').add({
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
            success: true,
            bookingId: bookingRef.id
        };
    } catch (error) {
        logger.error('Create booking error:', error);
        return {
            success: false,
            error: 'Failed to create booking'
        };
    }
}

/**
 * Get user's bookings
 */
export async function getUserBookingsAction(): Promise<{
    success: boolean;
    bookings?: any[];
    error?: string;
}> {
    try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return null as any;
    const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false, error: 'Not authenticated' };
        }

        const snapshot = await db.collection('export_bookings')
            .where('userId', '==', session.user.id)
            .orderBy('createdAt', 'desc')
            .get();

        const bookings = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
        }));

        return { success: true, bookings };
    } catch (error) {
        logger.error('Get bookings error:', error);
        return { success: false, error: 'Failed to fetch bookings' };
    }
}
