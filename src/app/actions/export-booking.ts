'use server';

import { auth } from '@/lib/auth';
import { db } from '@/lib/firebase';
import { collection, addDoc, Timestamp, doc, getDoc, updateDoc, increment } from 'firebase/firestore';

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
        const session = await auth();
        if (!session?.user?.id) {
            return { success: false, error: 'Not authenticated' };
        }

        // Validate input
        if (!data.exportWindowId || data.quantity <= 0 || data.totalPrice <= 0) {
            return { success: false, error: 'Invalid booking data' };
        }

        // Check if export window exists and has availability
        const windowRef = doc(db, 'export_windows', data.exportWindowId);
        const windowDoc = await getDoc(windowRef);

        if (!windowDoc.exists) {
            return { success: false, error: 'Export window not found' };
        }

        const windowData = windowDoc.data();
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
        await updateDoc(windowRef, {
            currentVolume: increment(data.quantity),
            updatedAt: FieldValue.serverTimestamp(),
        });

        return {
            success: true,
            bookingId: bookingRef.id
        };
    } catch (error) {
        console.error('Create booking error:', error);
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
        const session = await auth();
        if (!session?.user?.id) {
            return { success: false, error: 'Not authenticated' };
        }

        const { getDocs, query, where, orderBy } = await import('firebase/firestore');

        const q = db.collection('export_bookings').where('userId', '==', session.user.id).orderBy('createdAt', 'desc');

        const snapshot = await getDocs(q);
        const bookings = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
        }));

        return { success: true, bookings };
    } catch (error) {
        console.error('Get bookings error:', error);
        return { success: false, error: 'Failed to fetch bookings' };
    }
}
