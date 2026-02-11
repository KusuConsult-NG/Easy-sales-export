/**
 * Marketplace Server Actions
 * 
 * Server-side logic for marketplace operations
 */

"use server";

import { auth } from "@/lib/auth";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import {
    ref,
    uploadBytes,
    getDownloadURL
} from "firebase/storage";
import { db } from "@/lib/firebase-admin"; // Use Admin DB
import { storage } from "@/lib/firebase"; // Keep Client Storage for now (or refactor if needed)
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
        const existingDocs = await db.collection(COLLECTIONS.SELLER_VERIFICATIONS)
            .where("userId", "==", userId)
            .get();

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
        const verificationRef = db.collection(COLLECTIONS.SELLER_VERIFICATIONS).doc(verificationId);

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

        await verificationRef.set(verificationData);

        // Update user record
        const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
        await userRef.update({
            sellerVerificationStatus: "pending",
            sellerVerificationId: verificationId,
            updatedAt: FieldValue.serverTimestamp(),
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
        const snapshot = await db.collection(COLLECTIONS.SELLER_VERIFICATIONS)
            .where("userId", "==", userId)
            .get();

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

/**
 * Submit full marketplace onboarding (Profile + Verification + Files)
 */
export async function submitMarketplaceOnboardingAction(
    prevState: any,
    formData: FormData
) {
    try {
        const session = await auth();

        if (!session?.user) {
            return { success: false, error: "Not authenticated" };
        }

        const userId = session.user.id;
        const timestamp = Date.now();

        // 1. Handle File Uploads (Client SDK Storage)
        const uploadFile = async (file: File, path: string) => {
            const extension = file.name.split('.').pop();
            const fileName = `${timestamp}_${Math.random().toString(36).substring(7)}.${extension}`;
            const storageRef = ref(storage, `${path}/${userId}/${fileName}`);
            const buffer = await file.arrayBuffer();

            await uploadBytes(storageRef, buffer, { contentType: file.type });
            return await getDownloadURL(storageRef);
        };

        let businessRegistrationUrl = "";
        const farmPhotoUrls: string[] = [];
        const productSampleUrls: string[] = [];

        // Upload Business Registration
        const bizRegFile = formData.get("businessRegistration") as File;
        if (bizRegFile && bizRegFile.size > 0) {
            businessRegistrationUrl = await uploadFile(bizRegFile, "start_selling/documents");
        }

        // Upload Farm Photos (expecting farmPhotos_0, farmPhotos_1, etc.)
        for (const key of Array.from(formData.keys())) {
            if (key.startsWith("farmPhotos_")) {
                const file = formData.get(key) as File;
                if (file.size > 0) {
                    const url = await uploadFile(file, "start_selling/farm_photos");
                    farmPhotoUrls.push(url);
                }
            }
        }

        // Upload Product Samples
        for (const key of Array.from(formData.keys())) {
            if (key.startsWith("productSamples_")) {
                const file = formData.get(key) as File;
                if (file.size > 0) {
                    const url = await uploadFile(file, "start_selling/product_samples");
                    productSampleUrls.push(url);
                }
            }
        }

        // 2. Prepare Data
        const locationStr = formData.get("location") as string;
        let location = { state: "", lga: "", address: "" };
        try {
            location = JSON.parse(locationStr);
        } catch (e) { }

        const bankAccountStr = formData.get("bankAccount") as string;
        let bankAccount = { bankName: "", accountNumber: "", accountName: "" };
        try {
            bankAccount = JSON.parse(bankAccountStr);
        } catch (e) { }

        const verificationId = `seller_${userId}_${timestamp}`;
        const verificationRef = db.collection(COLLECTIONS.SELLER_VERIFICATIONS).doc(verificationId);

        const verificationData = {
            id: verificationId,
            userId,
            status: "pending",
            businessName: formData.get("businessName"),
            businessType: formData.get("businessType"),
            phone: formData.get("phone"),
            location,

            // Interest Profile
            accountType: formData.get("accountType"), // seller or both
            sellerCategories: JSON.parse(formData.get("sellerCategories") as string || "[]"),
            productionCapacity: formData.get("productionCapacity"),
            certifications: JSON.parse(formData.get("certifications") as string || "[]"),

            // Documents
            documents: {
                businessRegistrationUrl,
                farmPhotoUrls,
                productSampleUrls,
            },

            // Bank
            bankAccount,

            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        };

        // 3. Save to Firestore
        await verificationRef.set(verificationData);

        // 4. Update User Profile
        const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
        await userRef.update({
            phone: formData.get("phone") as string,
            location: `${location.address}, ${location.lga}, ${location.state}`, // Simplified location string
            isSeller: true, // Flag to indicate seller intent
            sellerVerificationStatus: "pending",
            sellerVerificationId: verificationId,
            updatedAt: FieldValue.serverTimestamp(),
        });

        return { success: true, verificationId };

    } catch (error: any) {
        console.error("Marketplace onboarding error:", error);
        return { success: false, error: error.message || "Failed to submit application" };
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
        const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
        const userDoc = await userRef.get();
        const userData = userDoc.data();

        if (!hasRole(userData?.roles || [], "seller")) {
            return { success: false, error: "You must have seller role to create products" };
        }

        if (userData?.sellerVerificationStatus !== "approved") {
            // Allow creation if pending for testing, or enforce strict? 
            // The prompt says "Fixing Marketplace Onboarding". 
            // If they are just onboarding, they might not be approved yet. 
            // But let's stick to the requirement.
            // For now, let's strictly enforce approved status as per original code.
            // If audit reveals this blocks testing, we can relax it.
            if (userData?.sellerVerificationStatus !== "approved") {
                return { success: false, error: "Your seller account must be approved first" };
            }
        }

        const productId = `product_${userId}_${Date.now()}`;

        // 1. Handle Image Uploads (Client SDK Storage)
        const uploadFile = async (file: File) => {
            const extension = file.name.split('.').pop();
            const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${extension}`;
            const storageRef = ref(storage, `products/${userId}/${productId}/${fileName}`);
            const buffer = await file.arrayBuffer();

            await uploadBytes(storageRef, buffer, { contentType: file.type });
            return await getDownloadURL(storageRef);
        };

        const imageUrls: string[] = [];

        // Process uploaded files (productImages_0, productImages_1, etc.)
        for (const key of Array.from(formData.keys())) {
            if (key.startsWith("productImages_")) {
                const file = formData.get(key) as File;
                if (file.size > 0) {
                    const url = await uploadFile(file);
                    imageUrls.push(url);
                }
            }
        }

        // Create product
        const productRef = db.collection(COLLECTIONS.PRODUCTS).doc(productId);

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
            images: imageUrls, // Use uploaded URLs
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

        await productRef.set(productData);

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
        const snapshot = await db.collection(COLLECTIONS.PRODUCTS)
            .where("sellerId", "==", userId)
            .get();

        const products = snapshot.docs.map(doc => doc.data() as Product);

        return { success: true, products };
    } catch (error: any) {
        console.error("Get seller products error:", error);
        return { success: false, error: error.message };
    }
}

/**
 * Get seller's orders
 */
export async function getSellerOrdersAction() {
    try {
        const session = await auth();

        if (!session?.user) {
            return { success: false, error: "Not authenticated" };
        }

        const userId = session.user.id;
        const snapshot = await db.collection(COLLECTIONS.ORDERS)
            .where("sellerId", "==", userId)
            .get();

        const orders = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Order[];

        return { success: true, orders };
    } catch (error: any) {
        console.error("Get seller orders error:", error);
        return { success: false, error: error.message };
    }
}

/**
 * Get seller analytics
 */
export async function getSellerAnalyticsAction() {
    try {
        const session = await auth();

        if (!session?.user) {
            return { success: false, error: "Not authenticated" };
        }

        const userId = session.user.id;

        // Fetch Orders
        const ordersSnapshot = await db.collection(COLLECTIONS.ORDERS)
            .where("sellerId", "==", userId)
            .get();
        const orders = ordersSnapshot.docs.map(doc => doc.data() as Order);

        // Fetch Products
        const productsSnapshot = await db.collection(COLLECTIONS.PRODUCTS)
            .where("sellerId", "==", userId)
            .get();
        const products = productsSnapshot.docs.map(doc => doc.data() as Product);

        // Calculate Stats
        const totalSales = orders
            .filter(o => o.status !== "cancelled" && o.status !== "disputed")
            .reduce((sum, o) => sum + o.totalAmount, 0);

        const pendingOrders = orders.filter(o => o.status === "pending_payment" || o.status === "processing").length;

        // Calculate monthly revenue (simple approximation for now)
        const currentMonth = new Date().getMonth();
        const monthlyRevenue = orders
            .filter(o => {
                const date = o.createdAt instanceof Date ? o.createdAt : (o.createdAt as any).toDate();
                return date.getMonth() === currentMonth && o.status !== "cancelled";
            })
            .reduce((sum, o) => sum + o.totalAmount, 0);

        const activeListings = products.filter(p => p.status === "active").length;

        // Conversion rate placeholder (would need view tracking)
        const conversionRate = 0;

        // Average Rating
        const averageRating = products.length > 0
            ? products.reduce((sum, p) => sum + (p.rating || 0), 0) / products.length
            : 0;

        return {
            success: true,
            analytics: {
                totalSales,
                activeListings,
                pendingOrders,
                monthlyRevenue,
                conversionRate,
                averageRating
            }
        };
    } catch (error: any) {
        console.error("Get seller analytics error:", error);
        return { success: false, error: error.message };
    }
}
/**
 * Get buyer's orders
 */
export async function getBuyerOrdersAction() {
    try {
        const session = await auth();

        if (!session?.user) {
            return { success: false, error: "Not authenticated" };
        }

        const userId = session.user.id;
        const snapshot = await db.collection(COLLECTIONS.ORDERS)
            .where("userId", "==", userId)
            .get();

        const orders = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Order[];

        return { success: true, orders };
    } catch (error: any) {
        console.error("Get buyer orders error:", error);
        return { success: false, error: error.message };
    }
}

/**
 * Get buyer dashboard stats
 */
export async function getBuyerStatsAction() {
    try {
        const session = await auth();

        if (!session?.user) {
            return { success: false, error: "Not authenticated" };
        }

        const userId = session.user.id;
        const snapshot = await db.collection(COLLECTIONS.ORDERS)
            .where("userId", "==", userId)
            .get();

        const orders = snapshot.docs.map(doc => doc.data() as Order);

        const activeOrders = orders.filter(o => o.status !== "delivered" && o.status !== "cancelled" && o.status !== "completed").length;
        const completedOrders = orders.filter(o => o.status === "delivered" || o.status === "completed").length;
        const totalSpent = orders.reduce((sum, o) => sum + o.totalAmount, 0);

        // Mock saved sellers for now as we don't have a followed_sellers collection yet
        const savedSellers = 0;

        return {
            success: true,
            stats: {
                activeOrders,
                completedOrders,
                totalSpent,
                savedSellers
            }
        };
    } catch (error: any) {
        console.error("Get buyer stats error:", error);
        return { success: false, error: error.message };
    }
}
/**
 * Get single product by ID
 */
export async function getProductAction(productId: string) {
    try {
        const productRef = db.collection(COLLECTIONS.PRODUCTS).doc(productId);
        const productSnap = await productRef.get();

        if (!productSnap.exists) {
            return { success: false, error: "Product not found" };
        }

        const product = productSnap.data() as Product;

        // Optionally fetch seller name
        let sellerName = "Unknown Seller";
        if (product.sellerId) {
            const userRef = db.collection(COLLECTIONS.USERS).doc(product.sellerId);
            const userSnap = await userRef.get();
            if (userSnap.exists) {
                const userData = userSnap.data();
                sellerName = userData?.businessName || userData?.displayName || "Unknown Seller";
            }
        }

        return { success: true, product: { ...product, sellerName } };
    } catch (error: any) {
        console.error("Get product error:", error);
        return { success: false, error: error.message };
    }
}

/**
 * Get recommended products for buyers
 */
export async function getRecommendedProductsAction(limit: number = 3) {
    try {
        const snapshot = await db.collection(COLLECTIONS.PRODUCTS)
            .where("status", "==", "active")
            .where("availableQuantity", ">", 0)
            .get();

        let products = snapshot.docs.map(doc => doc.data() as Product);

        // Sort by rating and views to get best products
        products = products
            .sort((a, b) => {
                // Prioritize products with ratings, then views
                const scoreA = (a.rating || 0) * 10 + (a.views || 0);
                const scoreB = (b.rating || 0) * 10 + (b.views || 0);
                return scoreB - scoreA;
            })
            .slice(0, limit);

        // Fetch seller names for each product
        const productsWithSellers = await Promise.all(
            products.map(async (product) => {
                let sellerName = "Unknown Seller";
                if (product.sellerId) {
                    const userRef = db.collection(COLLECTIONS.USERS).doc(product.sellerId);
                    const userSnap = await userRef.get();
                    if (userSnap.exists) {
                        const userData = userSnap.data();
                        sellerName = userData?.businessName || userData?.displayName || "Unknown Seller";
                    }
                }
                return {
                    ...product,
                    sellerName,
                };
            })
        );

        return { success: true, products: productsWithSellers };
    } catch (error: any) {
        console.error("Get recommended products error:", error);
        return { success: false, error: error.message, products: [] };
    }
}

