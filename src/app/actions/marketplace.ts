/**
 * Marketplace Server Actions
 * 
 * Server-side logic for marketplace operations
 */

"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase";
import {
    collection,
    doc,
    setDoc,
    getDoc,
    getDocs,
    updateDoc,
    query,
    where,
    serverTimestamp
} from "firebase/firestore";
import { COLLECTIONS } from "@/lib/types/firestore";
import type { SellerVerification, Product, CartItem, Order } from "@/lib/types/marketplace";
import { hasRole } from "@/lib/role-utils";

// ============================================================================
// SELLER VERIFICATION
// ============================================================================

export interface SellerVerificationFormData {
    phoneNumber: string;
    nin?: string;
    bvn?: string;
    cac?: string;
    accountNumber: string;
    bankName: string;
    accountName: string;
    bankCode: string;
    street: string;
    city: string;
    state: string;
    lga: string;
    country: string;
}

export interface SellerVerificationState {
    success: boolean;
    error?: string;
    verificationId?: string;
}

/**
 * Submit seller verification application
 */
export async function submitSellerVerificationAction(
    prevState: SellerVerificationState,
    formData: FormData
): Promise<SellerVerificationState> {
    try {
        const session = await auth();

        if (!session?.user) {
            return { success: false, error: "Not authenticated" };
        }

        const userId = session.user.id;

        // Check if already has a pending or approved verification
        const existingVerificationQuery = query(
            collection(db, COLLECTIONS.SELLER_VERIFICATIONS),
            where("userId", "==", userId)
        );

        const existingDocs = await getDocs(existingVerificationQuery);

        if (!existingDocs.empty) {
            const existing = existingDocs.docs[0].data() as SellerVerification;
            if (existing.status === "pending" || existing.status === "approved") {
                return {
                    success: false,
                    error: "You already have a verification application. Please check your status."
                };
            }
        }

        // Create verification document
        const verificationId = `seller_${userId}_${Date.now()}`;
        const verificationRef = doc(db, COLLECTIONS.SELLER_VERIFICATIONS, verificationId);

        const verificationData: SellerVerification = {
            id: verificationId,
            userId,
            status: "pending",
            phoneNumber: formData.get("phoneNumber") as string,
            phoneVerified: false,
            nin: (formData.get("nin") as string) || undefined,
            bvn: (formData.get("bvn") as string) || undefined,
            cac: (formData.get("cac") as string) || undefined,
            bankAccount: {
                accountNumber: formData.get("accountNumber") as string,
                bankName: formData.get("bankName") as string,
                accountName: formData.get("accountName") as string,
                bankCode: formData.get("bankCode") as string,
            },
            address: {
                street: formData.get("street") as string,
                city: formData.get("city") as string,
                state: formData.get("state") as string,
                lga: formData.get("lga") as string,
                country: formData.get("country") as string || "Nigeria",
            },
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        await setDoc(verificationRef, verificationData);

        // Update user record
        const userRef = doc(db, COLLECTIONS.USERS, userId);
        await updateDoc(userRef, {
            sellerVerificationStatus: "pending",
            sellerVerificationId: verificationId,
            updatedAt: serverTimestamp(),
        });

        return {
            success: true,
            verificationId,
        };
    } catch (error: any) {
        console.error("Seller verification error:", error);
        return {
            success: false,
            error: error.message || "Failed to submit verification"
        };
    }
}

/**
 * Get seller verification status
 */
export async function getSellerVerificationAction() {
    try {
        const session = await auth();

        if (!session?.user) {
            return { success: false, error: "Not authenticated" };
        }

        const userId = session.user.id;
        const verificationsQuery = query(
            collection(db, COLLECTIONS.SELLER_VERIFICATIONS),
            where("userId", "==", userId)
        );

        const snapshot = await getDocs(verificationsQuery);

        if (snapshot.empty) {
            return { success: true, verification: null };
        }

        const verification = snapshot.docs[0].data() as SellerVerification;

        return { success: true, verification };
    } catch (error: any) {
        console.error("Get seller verification error:", error);
        return { success: false, error: error.message };
    }
}

// ============================================================================
// PRODUCT MANAGEMENT
// ============================================================================

export interface ProductFormData {
    title: string;
    description: string;
    category: string;
    images: string[];
    videoUrl?: string;
    retailPrice: number;
    bulkPrice?: number;
    exportPrice?: number;
    availableQuantity: number;
    minimumOrderQuantity: number;
    unit: string;
    state: string;
    lga: string;
    deliveryMethod: string;
    estimatedDeliveryDays?: number;
    certifications?: string[];
    harvestDate?: string;
    bulkAvailable: boolean;
    exportReady: boolean;
}

export interface ProductActionState {
    success: boolean;
    error?: string;
    productId?: string;
}

/**
 * Create new product listing
 */
export async function createProductAction(
    prevState: ProductActionState,
    formData: FormData
): Promise<ProductActionState> {
    try {
        const session = await auth();

        if (!session?.user) {
            return { success: false, error: "Not authenticated" };
        }

        const userId = session.user.id;

        // Check if user is an approved seller
        const userDoc = await getDoc(doc(db, COLLECTIONS.USERS, userId));
        const userData = userDoc.data();

        if (!hasRole(userData?.roles || [], "seller")) {
            return { success: false, error: "You must have seller role to create products" };
        }

        if (userData?.sellerVerificationStatus !== "approved") {
            return { success: false, error: "Your seller account must be approved first" };
        }

        // Create product
        const productId = `product_${userId}_${Date.now()}`;
        const productRef = doc(db, COLLECTIONS.PRODUCTS, productId);

        // Parse pricing tiers
        const pricingTiers = [];
        const retailPrice = parseFloat(formData.get("retailPrice") as string);
        const bulkPrice = formData.get("bulkPrice") as string;
        const exportPrice = formData.get("exportPrice") as string;

        pricingTiers.push({ type: "retail" as const, price: retailPrice, minQuantity: 1 });

        if (bulkPrice) {
            pricingTiers.push({
                type: "bulk" as const,
                price: parseFloat(bulkPrice),
                minQuantity: parseInt(formData.get("bulkMinQuantity") as string || "50")
            });
        }

        if (exportPrice) {
            pricingTiers.push({
                type: "export" as const,
                price: parseFloat(exportPrice),
                minQuantity: parseInt(formData.get("exportMinQuantity") as string || "100")
            });
        }

        const productData: Product = {
            id: productId,
            sellerId: userId,
            title: formData.get("title") as string,
            description: formData.get("description") as string,
            category: formData.get("category") as any,
            images: JSON.parse(formData.get("images") as string || "[]"),
            videoUrl: (formData.get("videoUrl") as string) || undefined,
            pricingTiers,
            availableQuantity: parseInt(formData.get("availableQuantity") as string),
            minimumOrderQuantity: parseInt(formData.get("minimumOrderQuantity") as string),
            unit: formData.get("unit") as string,
            location: {
                state: formData.get("state") as string,
                lga: formData.get("lga") as string,
            },
            deliveryMethod: formData.get("deliveryMethod") as any,
            estimatedDeliveryDays: parseInt(formData.get("estimatedDeliveryDays") as string || "0") || undefined,
            certifications: JSON.parse(formData.get("certifications") as string || "[]"),
            bulkAvailable: formData.get("bulkAvailable") === "true",
            exportReady: formData.get("exportReady") === "true",
            status: "active",
            views: 0,
            orders: 0,
            rating: 0,
            reviewCount: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        await setDoc(productRef, productData);

        return {
            success: true,
            productId,
        };
    } catch (error: any) {
        console.error("Create product error:", error);
        return {
            success: false,
            error: error.message || "Failed to create product"
        };
    }
}

/**
 * Get seller's products
 */
export async function getSellerProductsAction() {
    try {
        const session = await auth();

        if (!session?.user) {
            return { success: false, error: "Not authenticated" };
        }

        const userId = session.user.id;
        const productsQuery = query(
            collection(db, COLLECTIONS.PRODUCTS),
            where("sellerId", "==", userId)
        );

        const snapshot = await getDocs(productsQuery);
        const products = snapshot.docs.map(doc => doc.data() as Product);

        return { success: true, products };
    } catch (error: any) {
        console.error("Get seller products error:", error);
        return { success: false, error: error.message };
    }
}
