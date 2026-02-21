/**
 * Marketplace Server Actions
 * 
 * Server-side logic for marketplace operations
 */

"use server";

import { auth } from "@/lib/auth";
import { logger } from '@/lib/logger';
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { db } from "@/lib/firebase-admin"; // Use Admin DB
import { uploadFileToStorage } from "@/lib/storage-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import type { SellerVerification, Product, CartItem, Order, ProductCategory, DeliveryMethod } from "@/lib/types/marketplace";
import { hasRole } from "@/lib/role-utils";
import { unstable_cache } from "next/cache";

// ============================================
// Check Marketplace Application Status Action
// ============================================

export async function checkMarketplaceStatusAction(): Promise<{ status: string; accountType?: string } | null> {
    try {
        const session = await auth();
        if (!session?.user) return null;

        // Check user document for service registration
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        const userData = userDoc.data();

        const registration = userData?.serviceRegistrations?.marketplace;

        if (registration?.status) {
            return {
                status: registration.status,
                accountType: registration.accountType
            };
        }

        return null;
    } catch (error) {
        logger.error("Error checking Marketplace status:", error);
        return null;
    }
}

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
        logger.error("Seller verification error:", error);
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
        logger.error("Get seller verification error:", error);
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

        // Check for existing application
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
        const existingStatus = userDoc.data()?.serviceRegistrations?.marketplace?.status;

        if (existingStatus === 'pending' || existingStatus === 'under_review') {
            return {
                success: false,
                error: "Your previous application is still being processed."
            };
        }
        if (existingStatus === 'approved') {
            return {
                success: false,
                error: "You are already registered for Marketplace."
            };
        }

        // 1. Handle File Uploads (Admin SDK Storage)
        const uploadFile = async (file: File, path: string) => {
            const extension = file.name.split('.').pop();
            const fileName = `${timestamp}_${Math.random().toString(36).substring(7)}.${extension}`;
            const destination = `${path}/${userId}/${fileName}`;

            // Use signed URLs (private/secure) for verification docs
            return await uploadFileToStorage(file, destination, false);
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
        } catch (e) { logger.warn("Failed to parse location JSON, using defaults"); }

        const bankAccountStr = formData.get("bankAccount") as string;
        let bankAccount = { bankName: "", accountNumber: "", accountName: "" };
        try {
            bankAccount = JSON.parse(bankAccountStr);
        } catch (e) { logger.warn("Failed to parse bankAccount JSON, using defaults"); }

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
            // Use dot notation to preserve other service registrations (Academy, Cooperatives, etc.)
            "serviceRegistrations.marketplace": {
                status: "pending",
                verificationId,
                accountType: formData.get("accountType") as string,
                submittedAt: FieldValue.serverTimestamp(),
            },
            updatedAt: FieldValue.serverTimestamp(),
        });

        return { success: true, verificationId };

    } catch (error: any) {
        logger.error("Marketplace onboarding error:", error);
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
            return { success: false, error: "Your seller account must be approved first" };
        }

        // Extract and Prepare Data for Validation
        let certifications = [];
        try {
            certifications = JSON.parse(formData.get("certifications") as string || "[]");
        } catch (e) { logger.warn("Failed to parse certifications JSON, using defaults"); }

        const rawData = {
            title: formData.get("title"),
            description: formData.get("description"),
            category: formData.get("category"),
            retailPrice: parseFloat(formData.get("retailPrice") as string),
            bulkPrice: formData.get("bulkPrice") ? parseFloat(formData.get("bulkPrice") as string) : undefined,
            exportPrice: formData.get("exportPrice") ? parseFloat(formData.get("exportPrice") as string) : undefined,
            availableQuantity: parseInt(formData.get("availableQuantity") as string),
            minimumOrderQuantity: parseInt(formData.get("minimumOrderQuantity") as string),
            bulkMinQuantity: formData.get("bulkMinQuantity") ? parseInt(formData.get("bulkMinQuantity") as string) : undefined,
            exportMinQuantity: formData.get("exportMinQuantity") ? parseInt(formData.get("exportMinQuantity") as string) : undefined,
            unit: formData.get("unit"),
            state: formData.get("state"),
            lga: formData.get("lga"),
            deliveryMethod: formData.get("deliveryMethod"),
            estimatedDeliveryDays: formData.get("estimatedDeliveryDays") ? parseInt(formData.get("estimatedDeliveryDays") as string) : undefined,
            certifications,
            bulkAvailable: formData.get("bulkAvailable") === "true",
            exportReady: formData.get("exportReady") === "true",
            videoUrl: formData.get("videoUrl") || "",
        };

        // Validate with Zod
        const { productSchema } = await import("@/lib/validations/marketplace");
        const validation = productSchema.safeParse(rawData);

        if (!validation.success) {
            return {
                success: false,
                error: validation.error.issues[0]?.message || "Validation failed",
            };
        }

        const validatedData = validation.data;
        const productId = `product_${userId}_${Date.now()}`;

        // 1. Handle Image Uploads (Admin SDK Storage)
        const uploadFile = async (file: File) => {
            const extension = file.name.split('.').pop();
            const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${extension}`;
            const destination = `products/${userId}/${productId}/${fileName}`;
            return await uploadFileToStorage(file, destination, false);
        };

        const imageUrls: string[] = [];
        // Process uploaded files
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

        // Construct Pricing Tiers
        const pricingTiers = [];
        pricingTiers.push({ type: "retail" as const, price: validatedData.retailPrice, minQuantity: 1 });

        if (validatedData.bulkPrice && validatedData.bulkAvailable) {
            pricingTiers.push({
                type: "bulk" as const,
                price: validatedData.bulkPrice,
                minQuantity: validatedData.bulkMinQuantity || 50
            });
        }

        if (validatedData.exportPrice && validatedData.exportReady) {
            pricingTiers.push({
                type: "export" as const,
                price: validatedData.exportPrice,
                minQuantity: validatedData.exportMinQuantity || 100
            });
        }

        const productData: Product = {
            id: productId,
            sellerId: userId,
            title: validatedData.title,
            description: validatedData.description,
            category: validatedData.category as ProductCategory,
            images: imageUrls,
            videoUrl: validatedData.videoUrl || undefined,
            pricingTiers,
            availableQuantity: validatedData.availableQuantity,
            minimumOrderQuantity: validatedData.minimumOrderQuantity,
            unit: validatedData.unit,
            location: {
                state: validatedData.state,
                lga: validatedData.lga,
            },
            deliveryMethod: validatedData.deliveryMethod as DeliveryMethod,
            estimatedDeliveryDays: validatedData.estimatedDeliveryDays,
            certifications: validatedData.certifications,
            bulkAvailable: validatedData.bulkAvailable || false,
            exportReady: validatedData.exportReady || false,
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
        logger.error("Create product error:", error);
        return {
            success: false,
            error: error.message || "Failed to create product"
        };
    }
}

/**
 * Get seller's products
 */
export async function getSellerProductsAction(options: {
    limit?: number;
    lastId?: string;
    status?: string;
    search?: string;
    sortBy?: "createdAt" | "title" | "price" | "orders" | "views" | "rating" | "availableQuantity";
    sortDir?: "asc" | "desc";
} = {}) {
    try {
        const session = await auth();

        if (!session?.user) {
            return { success: false, error: "Not authenticated" };
        }

        const userId = session.user.id;
        const {
            limit = 50,
            lastId,
            status,
            search,
            sortBy = "createdAt",
            sortDir = "desc"
        } = options;

        let query = db.collection(COLLECTIONS.PRODUCTS)
            .where("sellerId", "==", userId);

        // Apply Status Filter
        if (status && status !== "all" && status !== "low_stock") {
            query = query.where("status", "==", status);
        }

        // Handle Low Stock Filter (virtual status)
        if (status === "low_stock") {
            query = query.where("availableQuantity", "<", 50)
                .where("availableQuantity", ">", 0);
        }

        // Apply Sorting
        // Note: Firestore requires an index for each combination of where+orderBy
        try {
            query = query.orderBy(sortBy, sortDir);
        } catch (e) {
            // Fallback if index missing or incompatible sort
            logger.warn("Sorting failed, likely missing index. Falling back to default sort.", { error: e });
        }

        // Apply Pagination
        if (lastId) {
            const lastDoc = await db.collection(COLLECTIONS.PRODUCTS).doc(lastId).get();
            if (lastDoc.exists) {
                query = query.startAfter(lastDoc);
            }
        }

        query = query.limit(limit);

        const snapshot = await query.get();
        let products = snapshot.docs.map(doc => doc.data() as Product);

        // Client-side Text Search (Temporary Fallback)
        // Ideally use a dedicated search service for full-text search
        if (search) {
            const searchLower = search.toLowerCase();
            products = products.filter(p =>
                p.title.toLowerCase().includes(searchLower) ||
                p.category.toLowerCase().includes(searchLower)
            );
        }

        // Determine pagination info
        let newLastId = undefined;
        let hasMore = false;

        const lastProduct = products[products.length - 1];
        if (lastProduct && snapshot.docs.length === limit) {
            hasMore = true; // Optimistic check
            newLastId = lastProduct.id;
        }

        return { success: true, products, lastId: newLastId, hasMore };
    } catch (error: any) {
        logger.error("Get seller products error:", { error });
        return { success: false, error: error.message };
    }
}

/**
 * Get seller's orders
 */
export async function getSellerOrdersAction(options: {
    limit?: number;
    lastId?: string;
    status?: string;
} = {}) {
    try {
        const session = await auth();

        if (!session?.user) {
            return { success: false, error: "Not authenticated" };
        }

        const userId = session.user.id;
        const { limit = 20, lastId, status } = options;

        // Query 'marketplaceOrders' collection using sellerIds array
        let query = db.collection("marketplaceOrders")
            .where("sellerIds", "array-contains", userId)
            .orderBy("createdAt", "desc");

        if (status && status !== "all") {
            // Note: 'status' in marketplaceOrders is 'orderStatus' or 'paymentStatus'?
            // marketplace-payment.ts saves 'orderStatus' ("pending_payment") 
            // and 'paymentStatus' ("pending").
            // Seller usually cares about "orderStatus" (processing, shipped, etc).
            // But existing code checked "status". 
            // I should map "status" query to "orderStatus".
            query = query.where("orderStatus", "==", status);
        }

        if (lastId) {
            const lastDoc = await db.collection("marketplaceOrders").doc(lastId).get();
            if (lastDoc.exists) {
                query = query.startAfter(lastDoc);
            }
        }

        query = query.limit(limit);

        const snapshot = await query.get();
        const orders = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Order[];

        let newLastId = undefined;
        let hasMore = false;

        if (snapshot.docs.length === limit) {
            hasMore = true;
            newLastId = snapshot.docs[snapshot.docs.length - 1].id;
        }

        return { success: true, orders, lastId: newLastId, hasMore };
    } catch (error: any) {
        logger.error("Get seller orders error:", { error });
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
                const date = o.createdAt instanceof Date ? o.createdAt : (o.createdAt as unknown as import('firebase-admin/firestore').Timestamp).toDate();
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
        logger.error("Get seller analytics error:", error);
        return { success: false, error: error.message };
    }
}


/**
 * Get buyer's orders
 */
export async function getBuyerOrdersAction(options: {
    limit?: number;
    lastId?: string;
    status?: string;
} = {}) {
    try {
        const session = await auth();

        if (!session?.user) {
            return { success: false, error: "Not authenticated" };
        }

        const userId = session.user.id;
        const { limit = 20, lastId, status } = options;

        let query = db.collection("marketplaceOrders")
            .where("buyerId", "==", userId) // marketplace-payment.ts uses buyerId
            .orderBy("createdAt", "desc");

        if (status && status !== "all") {
            query = query.where("orderStatus", "==", status);
        }

        if (lastId) {
            const lastDoc = await db.collection("marketplaceOrders").doc(lastId).get();
            if (lastDoc.exists) {
                query = query.startAfter(lastDoc);
            }
        }

        query = query.limit(limit);

        const snapshot = await query.get();
        const orders = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Order[];

        let newLastId = undefined;
        let hasMore = false;

        if (snapshot.docs.length === limit) {
            hasMore = true;
            newLastId = snapshot.docs[snapshot.docs.length - 1].id;
        }

        return { success: true, orders, lastId: newLastId, hasMore };
    } catch (error: any) {
        logger.error("Get buyer orders error:", { error });
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
        logger.error("Get buyer stats error:", error);
        return { success: false, error: error.message };
    }
}
/**
 * Get single product by ID
 */
const getCachedProduct = (productId: string) => unstable_cache(
    async () => {
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
            logger.error("Get product error:", error);
            return { success: false, error: error.message };
        }
    },
    [`product-${productId}`],
    { revalidate: 3600, tags: [`product-${productId}`] }
)();

export async function getProductAction(productId: string) {
    return getCachedProduct(productId);
}

/**
 * Get recommended products for buyers
 */

// Internal cache
const getCachedRecommendedProducts = unstable_cache(
    async (limit: number) => {
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
            logger.error("Get recommended products error:", error);
            return { success: false, error: error.message, products: [] };
        }
    },
    ["recommended-products"],
    { revalidate: 3600, tags: ["recommended-products"] }
);

/**
 * Get recommended products for buyers
 */
export async function getRecommendedProductsAction(limit: number = 3) {
    return getCachedRecommendedProducts(limit);
}


/**
 * Delete a product listing
 */
export async function deleteProductAction(productId: string) {
    try {
        const session = await auth();

        if (!session?.user?.id) {
            return { success: false, error: "Unauthorized" };
        }

        const productRef = db.collection(COLLECTIONS.PRODUCTS).doc(productId);
        const productDoc = await productRef.get();

        if (!productDoc.exists) {
            return { success: false, error: "Product not found" };
        }

        const product = productDoc.data() as Product;

        // Verify user owns this product
        if (product.sellerId !== session.user.id) {
            return { success: false, error: "Unauthorized" };
        }

        // Check for active orders
        const activeOrders = await db.collection(COLLECTIONS.ORDERS)
            .where("productIds", "array-contains", productId)
            .where("status", "in", ["pending_payment", "processing", "shipped"])
            .get();

        if (!activeOrders.empty) {
            return {
                success: false,
                error: "Cannot delete product with active orders",
            };
        }

        // Soft delete
        await productRef.update({
            status: "deleted",
            updatedAt: FieldValue.serverTimestamp(),
        });

        return {
            success: true,
            message: "Product deleted successfully",
        };
    } catch (error: any) {
        logger.error("Delete product error:", error);
        return { success: false, error: error.message };
    }
}

/**
 * Get related products based on category and location
 */

// Internal cache
const getCachedRelatedProducts = (productId: string, limit: number) => unstable_cache(
    async () => {
        try {
            const productRef = db.collection(COLLECTIONS.PRODUCTS).doc(productId);
            const productSnap = await productRef.get();

            if (!productSnap.exists) {
                return { success: false, error: "Product not found", products: [] };
            }

            const product = productSnap.data() as Product;

            // Query by same category
            const snapshot = await db.collection(COLLECTIONS.PRODUCTS)
                .where("category", "==", product.category)
                .where("status", "==", "active")
                .limit(limit + 1)
                .get();

            let products = snapshot.docs
                .map(doc => doc.data() as Product)
                .filter(p => p.id !== productId);

            // If not enough, add random active products
            if (products.length < limit) {
                const randomSnapshot = await db.collection(COLLECTIONS.PRODUCTS)
                    .where("status", "==", "active")
                    .limit(limit * 2)
                    .get();

                const randomProducts = randomSnapshot.docs
                    .map(doc => doc.data() as Product)
                    .filter(p => p.id !== productId && !products.find(existing => existing.id === p.id));

                products = [...products, ...randomProducts].slice(0, limit);
            }

            return { success: true, products: products.slice(0, limit) };
        } catch (error: any) {
            logger.error("Get related products error:", error);
            return { success: false, error: error.message, products: [] };
        }
    },
    [`related-products-${productId}`],
    { revalidate: 3600, tags: [`related-products-${productId}`] }
)();

/**
 * Get related products based on category and location
 */
/**
 * Get related products based on category and location
 */
export async function getRelatedProductsAction(productId: string, limit: number = 4) {
    return getCachedRelatedProducts(productId, limit);
}

/**
 * Search Products with Pagination and Filters
 */
export async function searchProductsAction(params: {
    query?: string;
    category?: string;
    state?: string;
    minPrice?: number;
    maxPrice?: number;
    sortBy?: "newest" | "price_asc" | "price_desc" | "rating";
    limit?: number;
    lastId?: string; // Cursor for pagination
}) {
    try {
        const limit = params.limit || 12;
        let query = db.collection(COLLECTIONS.PRODUCTS)
            .where("status", "==", "active")
            .where("availableQuantity", ">", 0);

        // Filters
        if (params.category && params.category !== "All Categories") {
            query = query.where("category", "==", params.category);
        }

        if (params.state && params.state !== "All Locations") {
            query = query.where("location.state", "==", params.state);
        }

        // Note: Firestore limitation - cannot filter by range on multiple fields easily
        // We will prioritize client-side price filtering if complex, or simple range here
        // For now, let's keep price filtering client-side or separate index if needed.
        // We'll focus on Category + Sort + Pagination which is the most common path.

        // Sorting
        if (params.sortBy === "price_asc") {
            query = query.orderBy("pricingTiers.0.price", "asc");
        } else if (params.sortBy === "price_desc") {
            query = query.orderBy("pricingTiers.0.price", "desc");
        } else if (params.sortBy === "rating") {
            query = query.orderBy("rating", "desc");
        } else {
            // Default: Newest
            query = query.orderBy("createdAt", "desc");
        }

        // Cursor Pagination
        if (params.lastId) {
            const lastDoc = await db.collection(COLLECTIONS.PRODUCTS).doc(params.lastId).get();
            if (lastDoc.exists) {
                query = query.startAfter(lastDoc);
            }
        }

        query = query.limit(limit);

        const snapshot = await query.get();
        const products = snapshot.docs.map(doc => doc.data() as Product);
        const lastVisible = snapshot.docs[snapshot.docs.length - 1];

        // Fetch seller names (optimize this with a separate user index/cache later)
        const productsWithSellers = await Promise.all(
            products.map(async (product) => {
                let sellerName = "Unknown Seller";
                if (product.sellerId) {
                    // Try to fetch from a simple cache or just db for now
                    // In a real high-scale app, sellerName should be denormalized onto the product document
                    // to avoid N+1 queries.
                    // For the sake of this audit fix, let's assume we read it, but recommend denormalization.
                    if (product.sellerName) {
                        sellerName = product.sellerName; // If denormalized
                    } else {
                        const userRef = db.collection(COLLECTIONS.USERS).doc(product.sellerId);
                        const userSnap = await userRef.get();
                        if (userSnap.exists) {
                            const userData = userSnap.data();
                            sellerName = userData?.businessName || userData?.displayName || "Unknown Seller";
                        }
                    }
                }
                return { ...product, sellerName };
            })
        );

        // Simple Text Search (Firestore doesn't support full text)
        // We filter the results in memory if a query is present
        // This is NOT scalable for millions of records, but for initial filter + search, it works 
        // if the database filter reduces the set significantly.
        // Ideally, use Algolia/Typesense.
        let finalProducts = productsWithSellers;
        if (params.query) {
            const lowerQuery = params.query.toLowerCase();
            finalProducts = finalProducts.filter(p =>
                p.title.toLowerCase().includes(lowerQuery) ||
                p.description.toLowerCase().includes(lowerQuery)
            );
        }

        return {
            success: true,
            products: finalProducts,
            lastId: lastVisible ? lastVisible.id : undefined,
            hasMore: snapshot.docs.length === limit
        };

    } catch (error: any) {
        logger.error("Search products error:", error);
        return { success: false, error: error.message, products: [] };
    }
}

