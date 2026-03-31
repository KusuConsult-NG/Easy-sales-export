"use server";

import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session-guard";
import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue } from "firebase-admin/firestore";

/**
 * VENDOR SETTINGS ACTIONS
 */

export async function updateVendorProfileAction(profileData: {
    storeName: string;
    description: string;
    category: string;
    contactEmail: string;
    phone: string;
    logo?: string;
    banner?: string;
}) {
    try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false, error: (sessionResult.error as any)?.error ?? 'Session expired' };
    const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false, error: "Unauthorized" };
        }

        const vendorId = session.user.id;
        const vendorRef = db.collection(COLLECTIONS.VENDOR_PROFILES).doc(vendorId);

        await vendorRef.set({
            storeInfo: {
                name: profileData.storeName,
                description: profileData.description,
                category: profileData.category,
                contactEmail: profileData.contactEmail,
                phone: profileData.phone,
                logo: profileData.logo || null,
                banner: profileData.banner || null,
            },
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        // Sync Vendor Phone back to central User document for Communication Hub
        if (profileData.phone) {
            await db.collection(COLLECTIONS.USERS).doc(vendorId).update({
                phone: profileData.phone,
                updatedAt: FieldValue.serverTimestamp(),
            });
        }

        return { success: true, message: "Profile updated successfully" };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

export async function updateVendorPaymentConfigAction(paymentData: {
    bankName: string;
    accountNumber: string;
    accountName: string;
    paymentSchedule: "weekly" | "monthly";
    minPayoutThreshold: number;
    taxId?: string;
}) {
    try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false, error: (sessionResult.error as any)?.error ?? 'Session expired' };
    const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false, error: "Unauthorized" };
        }

        const vendorId = session.user.id;
        const vendorRef = db.collection(COLLECTIONS.VENDOR_PROFILES).doc(vendorId);

        await vendorRef.set({
            paymentConfig: {
                bankName: paymentData.bankName,
                accountNumber: paymentData.accountNumber,
                accountName: paymentData.accountName,
                paymentSchedule: paymentData.paymentSchedule,
                minPayoutThreshold: paymentData.minPayoutThreshold,
                taxId: paymentData.taxId || null,
            },
            updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        return { success: true, message: "Payment configuration updated" };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

export async function updateVendorNotificationPrefsAction(prefs: {
    newOrders: boolean;
    lowStock: boolean;
    payments: boolean;
    reviews: boolean;
    marketing: boolean;
}) {
    try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false, error: (sessionResult.error as any)?.error ?? 'Session expired' };
    const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false, error: "Unauthorized" };
        }

        const vendorId = session.user.id;
        const vendorRef = db.collection(COLLECTIONS.VENDOR_PROFILES).doc(vendorId);

        await vendorRef.set({
            notifications: prefs,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        return { success: true, message: "Notification preferences updated" };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

export async function updateVendorShippingConfigAction(shippingData: {
    locations: string[];
    processingDays: number;
    returnPolicy: string;
    rates?: Record<string, number>;
}) {
    try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false, error: (sessionResult.error as any)?.error ?? 'Session expired' };
    const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false, error: "Unauthorized" };
        }

        const vendorId = session.user.id;
        const vendorRef = db.collection(COLLECTIONS.VENDOR_PROFILES).doc(vendorId);

        await vendorRef.set({
            shipping: {
                locations: shippingData.locations,
                processingDays: shippingData.processingDays,
                returnPolicy: shippingData.returnPolicy,
                rates: shippingData.rates || {},
            },
            updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        return { success: true, message: "Shipping configuration updated" };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

export async function getVendorSettingsAction() {
    try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false, error: (sessionResult.error as any)?.error ?? 'Session expired' };
    const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false, error: "Unauthorized" };
        }

        const vendorId = session.user.id;
        const vendorDoc = await db.collection(COLLECTIONS.VENDOR_PROFILES).doc(vendorId).get();

        if (!vendorDoc.exists) {
            return {
                success: true,
                settings: {
                    storeInfo: null,
                    paymentConfig: null,
                    notifications: {
                        newOrders: true,
                        lowStock: true,
                        payments: true,
                        reviews: true,
                        marketing: false,
                    },
                    shipping: null,
                },
            };
        }

        return { success: true, settings: vendorDoc.data() };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}
