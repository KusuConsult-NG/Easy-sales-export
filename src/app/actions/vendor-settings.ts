"use server";

import { requireSession } from "@/lib/session-guard";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue } from "@/lib/firestore-compat";
import { withFlexibleSafeAction } from "@/lib/safe-action";
import { logger } from "@/lib/logger";

/**
 * VENDOR SETTINGS ACTIONS
 */

async function _updateVendorProfileAction(profileData: { storeName: string;
    description: string;
    category: string;
    contactEmail: string;
    phone: string;
    logo?: string;
    banner?: string; }, expectedVersion?: number) { let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: (sessionResult.error as any)?.error ?? 'Session expired', data: null };
        const { session } = sessionResult;
        if (!session?.user?.id) { return { success: false as const, error: "Unauthorized", data: null };
        }

        const vendorId = session.user.id;
        const vendorRef = db.collection(COLLECTIONS.VENDOR_PROFILES).doc(vendorId);

        const { versionedUpdate } = await import("@/lib/optimistic-locking");

        await db.runTransaction(async (transaction) => { await versionedUpdate(transaction, vendorRef, expectedVersion, {
                storeInfo: {
                    name: profileData.storeName,
                    description: profileData.description,
                    category: profileData.category,
                    contactEmail: profileData.contactEmail,
                    phone: profileData.phone,
                    logo: profileData.logo || null,
                    banner: profileData.banner || null },
                updatedAt: FieldValue.serverTimestamp() });

            // 2. Sync Vendor Phone back to central User document for Communication Hub
            if (profileData.phone) { const userRef = db.collection(COLLECTIONS.USERS).doc(vendorId);
                transaction.update(userRef, {
                    phone: profileData.phone,
                    updatedAt: FieldValue.serverTimestamp(),
                    _version: FieldValue.increment(1) });
            }
        });

        // 3. Denormalize Store Name to all products (Outside transaction to avoid large-batch transaction overhead)
        const productsSnap = await db.collection(COLLECTIONS.PRODUCTS)
            .where("sellerId", "==", vendorId)
            .get();

        if (!productsSnap.empty) { const batch = db.batch();
            productsSnap.docs.forEach((doc) => {
                batch.update(doc.ref, {
                    sellerName: profileData.storeName,
                    updatedAt: FieldValue.serverTimestamp(),
                    _version: FieldValue.increment(1) });
            });
            await batch.commit();
        }

        return { success: true as const, error: null, data: null };
    } catch (error: any) { logger.error("updateVendorProfileAction error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error.message, data: null };
    }
}
export const updateVendorProfileAction = withFlexibleSafeAction("updateVendorProfileAction", _updateVendorProfileAction);

async function _updateVendorPaymentConfigAction(paymentData: { bankName: string;
    accountNumber: string;
    accountName: string;
    paymentSchedule: "weekly" | "monthly";
    minPayoutThreshold: number;
    taxId?: string; }, expectedVersion?: number) { let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: (sessionResult.error as any)?.error ?? 'Session expired', data: null };
        const { session } = sessionResult;
        if (!session?.user?.id) { return { success: false as const, error: "Unauthorized", data: null };
        }

        const vendorId = session.user.id;
        const vendorRef = db.collection(COLLECTIONS.VENDOR_PROFILES).doc(vendorId);
        const { versionedUpdate } = await import("@/lib/optimistic-locking");

        await db.runTransaction(async (transaction) => { await versionedUpdate(transaction, vendorRef, expectedVersion, {
                paymentConfig: {
                    bankName: paymentData.bankName,
                    accountNumber: paymentData.accountNumber,
                    accountName: paymentData.accountName,
                    paymentSchedule: paymentData.paymentSchedule,
                    minPayoutThreshold: paymentData.minPayoutThreshold,
                    taxId: paymentData.taxId || null },
                updatedAt: FieldValue.serverTimestamp() });
        });

        return { error: null,  success: true as const, data: null };
    } catch (error: any) { logger.error("updateVendorPaymentConfigAction error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error.message, data: null };
    }
}
export const updateVendorPaymentConfigAction = withFlexibleSafeAction("updateVendorPaymentConfigAction", _updateVendorPaymentConfigAction);

async function _updateVendorNotificationPrefsAction(prefs: { newOrders: boolean;
    lowStock: boolean;
    payments: boolean;
    reviews: boolean;
    marketing: boolean; }, expectedVersion?: number) { let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: (sessionResult.error as any)?.error ?? 'Session expired', data: null };
        const { session } = sessionResult;
        if (!session?.user?.id) { return { success: false as const, error: "Unauthorized", data: null };
        }

        const vendorId = session.user.id;
        const vendorRef = db.collection(COLLECTIONS.VENDOR_PROFILES).doc(vendorId);
        const { versionedUpdate } = await import("@/lib/optimistic-locking");

        await db.runTransaction(async (transaction) => { await versionedUpdate(transaction, vendorRef, expectedVersion, {
                notifications: prefs,
                updatedAt: FieldValue.serverTimestamp() });
        });

        return { success: true as const, error: null, data: null };
    } catch (error: any) { logger.error("updateVendorNotificationPrefsAction error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error.message, data: null };
    }
}
export const updateVendorNotificationPrefsAction = withFlexibleSafeAction("updateVendorNotificationPrefsAction", _updateVendorNotificationPrefsAction);

async function _updateVendorShippingConfigAction(shippingData: { locations: string[];
    processingDays: number;
    returnPolicy: string;
    rates?: Record<string, number>; }, expectedVersion?: number) { let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: (sessionResult.error as any)?.error ?? 'Session expired', data: null };
        const { session } = sessionResult;
        if (!session?.user?.id) { return { success: false as const, error: "Unauthorized", data: null };
        }

        const vendorId = session.user.id;
        const vendorRef = db.collection(COLLECTIONS.VENDOR_PROFILES).doc(vendorId);
        const { versionedUpdate } = await import("@/lib/optimistic-locking");

        await db.runTransaction(async (transaction) => {
            await versionedUpdate(transaction, vendorRef, expectedVersion, {
                shipping: {
                    locations: shippingData.locations,
                    processingDays: shippingData.processingDays,
                    returnPolicy: shippingData.returnPolicy,
                    rates: shippingData.rates || {} },
                updatedAt: FieldValue.serverTimestamp() });
        });

        return { error: null,  success: true as const, data: null };
    } catch (error: any) { logger.error("updateVendorShippingConfigAction error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error.message, data: null };
    }
}
export const updateVendorShippingConfigAction = withFlexibleSafeAction("updateVendorShippingConfigAction", _updateVendorShippingConfigAction);

async function _getVendorSettingsAction() { let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: (sessionResult.error as any)?.error ?? 'Session expired', data: null };
        const { session } = sessionResult;
        if (!session?.user?.id) { return { success: false as const, error: "Unauthorized", data: null };
        }

        const vendorId = session.user.id;
        const vendorDoc = await db.collection(COLLECTIONS.VENDOR_PROFILES).doc(vendorId).get();

        if (!vendorDoc.exists) {
            return {
                error: null,
                success: true as const,
                data: null
            };
        }

        const { serializeValue } = await import("@/lib/firestore-serialize");
        return { error: null,  success: true as const, data: { settings: serializeValue(vendorDoc.data()) } };
    } catch (error: any) { logger.error("getVendorSettingsAction error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error.message, data: null };
    }
}
export const getVendorSettingsAction = withFlexibleSafeAction("getVendorSettingsAction", _getVendorSettingsAction);

