/**
 * Marketplace Server Actions
 * 
 * Server-side logic for marketplace operations
 */

"use server";

import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session-guard";
import { logger } from '@/lib/logger';
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { db } from "@/lib/firebase-admin"; // Use Admin DB
import { uploadFileToStorage } from "@/lib/storage-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import type { SellerVerification, Product, CartItem, Order, ProductCategory, DeliveryMethod } from "@/lib/types/marketplace";
import { hasRole } from "@/lib/role-utils";
import { serializeDoc, serializeDocs } from "@/lib/firestore-serialize";
import { unstable_cache } from "next/cache";
import { invalidateUserCache } from "@/lib/cache-invalidation";

// ============================================
// Check Marketplace Application Status Action
// ============================================

export async function checkMarketplaceStatusAction(): Promise<{ status: string; accountType?: string } | null> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return null;
        const { session } = sessionResult;

        // ── PRIMARY: Check central user document for service registration ──
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        const userData = userDoc.data();

        const registration = userData?.serviceRegistrations?.marketplace;

        if (registration?.status) {
            return {
                status: registration.status,
                accountType: registration.accountType
            };
        }

        // ── FALLBACK: Returning user whose marketplace data predates V2 schema ──
        // Marketplace stores seller data in MARKETPLACE_SELLERS by userId
        const legacySellerSnap = await db.collection(COLLECTIONS.MARKETPLACE_SELLERS)
            .where('userId', '==', session.user.id)
            .limit(1)
            .get();

        if (!legacySellerSnap.empty) {
            const legacyData = legacySellerSnap.docs[0].data();
            const legacyStatus = legacyData?.status ?? 'pending';
            const legacyAccountType = legacyData?.accountType;

            await db.collection(COLLECTIONS.USERS).doc(session.user.id).set(
                {
                    serviceRegistrations: {
                        marketplace: {
                            status: legacyStatus,
                            accountType: legacyAccountType,
                            syncedFromLegacy: true,
                            syncedAt: new Date().toISOString()
                        }
                    }
                },
                { merge: true }
            );

            logger.info(`[checkMarketplaceStatus] Backfilled legacy marketplace status '${legacyStatus}' for user ${session.user.id}`);
            return { status: legacyStatus, accountType: legacyAccountType };
        }

        // ── FALLBACK 2: Check legacy sellerVerificationStatus field on the user doc itself
        if (userData?.sellerVerificationStatus) {
            const legacyStatus = userData.sellerVerificationStatus;
            
            // In the legacy system, users with sellerVerificationStatus were sellers.
            // If they are missing accountType, default them to "seller" so they don't get trapped in the buyer dashboard.
            const derivedAccountType = "seller";
            
            await db.collection(COLLECTIONS.USERS).doc(session.user.id).set(
                { serviceRegistrations: { marketplace: { status: legacyStatus, accountType: derivedAccountType, syncedFromLegacy: true, syncedAt: new Date().toISOString() } } },
                { merge: true }
            );
            return { status: legacyStatus, accountType: derivedAccountType };
        }

        // ── FALLBACK 3: Check seller_verifications collection
        // Sometimes the user document gets out of sync with the verification document
        const verificationSnap = await db.collection(COLLECTIONS.SELLER_VERIFICATIONS)
            .where('userId', '==', session.user.id)
            .get();

        if (!verificationSnap.empty) {
            const sortedDocs = verificationSnap.docs.map(d => d.data()).sort((a: any, b: any) => {
                const aTime = a.createdAt?.toMillis?.() || a.createdAt?.seconds * 1000 || 0;
                const bTime = b.createdAt?.toMillis?.() || b.createdAt?.seconds * 1000 || 0;
                return bTime - aTime;
            });
            const vData = sortedDocs[0];
            const vStatus = vData?.status ?? 'pending';
            const vAccountType = vData?.accountType ?? 'seller';

            await db.collection(COLLECTIONS.USERS).doc(session.user.id).set(
                {
                    serviceRegistrations: {
                        marketplace: {
                            status: vStatus,
                            accountType: vAccountType,
                            syncedFromLegacy: true,
                            syncedAt: new Date().toISOString()
                        }
                    }
                },
                { merge: true }
            );

            logger.info(`[checkMarketplaceStatus] Backfilled from seller_verifications status '${vStatus}' for user ${session.user.id}`);
            return { status: vStatus, accountType: vAccountType };
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
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;

        if (!session?.user) {
            return { success: false, error: "Not authenticated" };
        }

        const userId = session.user.id;

        // Check if already has a pending or approved verification
        const existingDocs = await db.collection(COLLECTIONS.SELLER_VERIFICATIONS)
            .where("userId", "==", userId)
            .get();

        if (!existingDocs.empty) {
            const hasActive = existingDocs.docs.some(doc => {
                const existing = doc.data() as SellerVerification;
                return existing.status === "pending" || existing.status === "approved";
            });
            if (hasActive) {
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

        try {
            await invalidateUserCache(userId);
        } catch (err) {
            logger.error("Failed to invalidate cache after Seller Verification:", err);
        }

        return { success: true, verificationId, };
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
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;

        if (!session?.user) {
            return { success: false, error: "Not authenticated" };
        }

        const userId = session.user.id;
        const snapshot = await db.collection(COLLECTIONS.SELLER_VERIFICATIONS)
            .where("userId", "==", userId)
            .get();

        if (snapshot.empty) {
            return { success: true, data: { verification: null } };
        }

        const sortedDocs = snapshot.docs.map(d => d.data()).sort((a: any, b: any) => {
            const aTime = a.createdAt?.toMillis?.() || a.createdAt?.seconds * 1000 || 0;
            const bTime = b.createdAt?.toMillis?.() || b.createdAt?.seconds * 1000 || 0;
            return bTime - aTime;
        });
        const verification = serializeDoc<SellerVerification>(sortedDocs[0].id, sortedDocs[0]);

        return { success: true, data: { verification } };
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
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;

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

            // Seller Categorization (NEW)
            sellerCategory: (formData.get("sellerCategory") as string) || "retail",

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
        const accountType = formData.get("accountType") as string;
        const isBuyerOnly = accountType === "buyer";

        const userUpdate: any = {
            phone: formData.get("phone") as string,
            location: `${location.address}, ${location.lga}, ${location.state}`, // Simplified location string
            updatedAt: FieldValue.serverTimestamp(),
        };

        if (isBuyerOnly) {
            userUpdate["serviceRegistrations.marketplace"] = {
                status: "active",
                accountType: "buyer",
                sellerCategory: "retail",
                submittedAt: FieldValue.serverTimestamp(),
            };
            // Also append marketplace_buyer role if we want them to bypass future checks easily
            const existingRoles = userDoc.data()?.roles || ["general_user"];
            if (!existingRoles.includes("marketplace_buyer")) {
                userUpdate.roles = [...existingRoles, "marketplace_buyer"];
            }
        } else {
            userUpdate.isSeller = true;
            userUpdate.sellerVerificationStatus = "pending";
            userUpdate.sellerVerificationId = verificationId;
            userUpdate.sellerCategory = formData.get("sellerCategory") as string || "retail";
            userUpdate["serviceRegistrations.marketplace"] = {
                status: "pending",
                verificationId,
                accountType: accountType,
                sellerCategory: formData.get("sellerCategory") as string || "retail",
                submittedAt: FieldValue.serverTimestamp(),
            };
        }

        await userRef.update(userUpdate);

        try {
            await invalidateUserCache(userId);
        } catch (err) {
            logger.error("Failed to invalidate cache after Marketplace Onboarding:", err);
        }

        return { success: true, data: { verificationId } };

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
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;

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

        return { success: true, productId };
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
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;

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
        let products = serializeDocs<Product>(snapshot.docs);

        // Client-side Text Search (Temporary Fallback)
        // Ideally use a dedicated search service for full-text search
        if (search) {
            const searchLower = search.toLowerCase();
            products = products.filter(p =>
                p.title?.toLowerCase()?.includes(searchLower) ||
                p.category?.toLowerCase()?.includes(searchLower)
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

        return { success: true, data: { products, lastId: newLastId, hasMore } };
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
    search?: string;
} = {}) {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;

        if (!session?.user) {
            return { success: false, error: "Not authenticated" };
        }

        const userId = session.user.id;
        const { limit = 20, lastId, status, search } = options;

        // When searching, fetch a broader page so we can filter client-side
        // (Firestore does not support full-text search natively)
        const fetchLimit = search ? Math.min(limit * 5, 100) : limit;

        let query: FirebaseFirestore.Query = db.collection(COLLECTIONS.MARKETPLACE_ORDERS)
            .where("sellerIds", "array-contains", userId)
            .orderBy("createdAt", "desc");

        // ✅ FIX: status filter must be applied BEFORE orderBy, so rebuild from scratch.
        // Previously appended .where("orderStatus") after .orderBy(), causing Firestore 400.
        // Also fixed wrong field name: orders store 'status', not 'orderStatus'.
        if (status && status !== "all") {
            query = db.collection(COLLECTIONS.MARKETPLACE_ORDERS)
                .where("sellerIds", "array-contains", userId)
                .where("status", "==", status)
                .orderBy("createdAt", "desc");
        }

        if (lastId && !search) {
            const lastDoc = await db.collection(COLLECTIONS.MARKETPLACE_ORDERS).doc(lastId).get();
            if (lastDoc.exists) {
                query = query.startAfter(lastDoc);
            }
        }

        query = query.limit(fetchLimit);

        const snapshot = await query.get();
        let orders = serializeDocs<Order>(snapshot.docs);

        // Server-assisted search: filter by order ID, buyer name, or product references
        if (search) {
            const q = search.toLowerCase();
            orders = orders.filter(o => {
                const anyOrderData = o as any;
                return (
                    o.id?.toLowerCase().includes(q) ||
                    anyOrderData.buyerName?.toLowerCase().includes(q) ||
                    anyOrderData.buyerEmail?.toLowerCase().includes(q) ||
                    anyOrderData.items?.some((item: any) => item.title?.toLowerCase().includes(q))
                );
            }).slice(0, limit);
        }

        let newLastId = undefined;
        let hasMore = false;

        if (!search && snapshot.docs.length === fetchLimit) {
            hasMore = true;
            newLastId = snapshot.docs[snapshot.docs.length - 1].id;
        }

        return { success: true, data: { orders, lastId: newLastId, hasMore } };
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
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;

        if (!session?.user) {
            return { success: false, error: "Not authenticated" };
        }

        const userId = session.user.id;

        // Fetch Orders
        // ✅ FIX: Orders store 'sellerIds' (array), not 'sellerId' (string).
        // Previously returned zero orders, making all seller analytics show ₦0.
        const ordersSnapshot = await db.collection(COLLECTIONS.MARKETPLACE_ORDERS)
            .where("sellerIds", "array-contains", userId)
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

        // Conversion rate: completed orders ÷ total product views × 100
        // Both `views` and `orders` are incremented fields on Product documents.
        const totalProductViews = products.reduce((sum, p) => sum + (p.views || 0), 0);
        const completedOrderCount = orders.filter(o => o.status !== "cancelled" && o.status !== "disputed").length;
        const conversionRate = totalProductViews > 0
            ? parseFloat(((completedOrderCount / totalProductViews) * 100).toFixed(1))
            : 0;

        // Average Rating
        const averageRating = products.length > 0
            ? products.reduce((sum, p) => sum + (p.rating || 0), 0) / products.length
            : 0;

        // Calculate prev-month revenue for trend badges
        const prevMonth = currentMonth === 0 ? 11 : currentMonth - 1;
        const prevYear = currentMonth === 0 ? new Date().getFullYear() - 1 : new Date().getFullYear();
        const prevMonthRevenue = orders
            .filter(o => {
                const date = o.createdAt instanceof Date ? o.createdAt : (o.createdAt as unknown as import('firebase-admin/firestore').Timestamp).toDate();
                return date.getMonth() === prevMonth && date.getFullYear() === prevYear && o.status !== "cancelled";
            })
            .reduce((sum, o) => sum + o.totalAmount, 0);

        // Prev total sales = all orders before the current month
        const prevTotalSales = orders
            .filter(o => {
                const date = o.createdAt instanceof Date ? o.createdAt : (o.createdAt as unknown as import('firebase-admin/firestore').Timestamp).toDate();
                return date.getMonth() !== currentMonth && o.status !== "cancelled" && o.status !== "disputed";
            })
            .reduce((sum, o) => sum + o.totalAmount, 0);

        // For active listings trend, compare current to 30 days ago snapshot is not feasible without history;
        // we return 0 so badge is hidden rather than fabricated.
        const prevActiveListings = 0;

        return { success: true, data: { analytics: {
                totalSales,
                activeListings,
                pendingOrders,
                monthlyRevenue,
                conversionRate,
                averageRating,
                prevMonthRevenue,
                prevTotalSales,
                prevActiveListings, } }
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
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;

        if (!session?.user) {
            return { success: false, error: "Not authenticated" };
        }

        const userId = session.user.id;
        const { limit = 20, lastId, status } = options;

        let query: FirebaseFirestore.Query = db.collection(COLLECTIONS.MARKETPLACE_ORDERS)
            .where("buyerId", "==", userId)
            .orderBy("createdAt", "desc");

        // ✅ FIX: status filter must be applied BEFORE orderBy, so rebuild from scratch.
        // Previously appended .where("orderStatus") after .orderBy(), causing Firestore 400.
        // Also fixed wrong field name: orders store 'status', not 'orderStatus'.
        if (status && status !== "all") {
            query = db.collection(COLLECTIONS.MARKETPLACE_ORDERS)
                .where("buyerId", "==", userId)
                .where("status", "==", status)
                .orderBy("createdAt", "desc");
        }

        if (lastId) {
            const lastDoc = await db.collection(COLLECTIONS.MARKETPLACE_ORDERS).doc(lastId).get();
            if (lastDoc.exists) {
                query = query.startAfter(lastDoc);
            }
        }

        query = query.limit(limit);

        const snapshot = await query.get();
        const orders = serializeDocs<Order>(snapshot.docs);

        let newLastId = undefined;
        let hasMore = false;

        if (snapshot.docs.length === limit) {
            hasMore = true;
            newLastId = snapshot.docs[snapshot.docs.length - 1].id;
        }

        return { success: true, data: { orders, lastId: newLastId, hasMore } };
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
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;

        if (!session?.user) {
            return { success: false, error: "Not authenticated" };
        }

        const userId = session.user.id;
        const snapshot = await db.collection(COLLECTIONS.MARKETPLACE_ORDERS)
            .where("buyerId", "==", userId)
            .get();

        const orders = snapshot.docs.map(doc => doc.data() as Order);

        const activeOrders = orders.filter(o => o.status !== "delivered" && o.status !== "cancelled" && o.status !== "completed").length;
        const completedOrders = orders.filter(o => o.status === "delivered" || o.status === "completed").length;
        const totalSpent = orders.reduce((sum, o) => sum + o.totalAmount, 0);

        // Read saved sellers count from user profile (incremented when user bookmarks a seller)
        const buyerDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        const savedSellers: number = buyerDoc.data()?.savedSellersCount ?? 0;

        return { success: true, data: { stats: {
                activeOrders,
                completedOrders,
                totalSpent,
                savedSellers } }
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

            return { success: true, data: { product: { ...product, sellerName } } };
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

            return { success: true, data: { products: productsWithSellers } };
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
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;

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

        // ✅ FIX: Check correct field name 'status' (not 'orderStatus' which doesn't exist on orders).
        // Previously this guard never fired, allowing soft-delete of products with active orders.
        const activeOrders = await db.collection(COLLECTIONS.MARKETPLACE_ORDERS)
            .where("productIds", "array-contains", productId)
            .where("status", "in", ["confirmed", "processing", "shipped"])
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

            return { success: true, data: { products: products.slice(0, limit) } };
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
                p.title?.toLowerCase()?.includes(lowerQuery) ||
                p.description?.toLowerCase()?.includes(lowerQuery)
            );
        }

        return { success: true, data: { products: finalProducts,
            lastId: lastVisible ? lastVisible.id : undefined,
            hasMore: snapshot.docs.length === limit } };

    } catch (error: any) {
        logger.error("Search products error:", error);
        return { success: false, error: error.message, products: [] };
    }
}

// ============================================================================
// USER RESUBMIT — Seller Verification
// ============================================================================

/**
 * Resubmit a rejected or suspended seller verification with corrected information.
 */
export async function resubmitSellerVerificationAction(
    fields: {
        businessName?: string;
        phone?: string;
        location?: { state: string; lga: string; address: string };
        bankAccount?: { bankName: string; accountNumber: string; accountName: string; bankCode: string };
        [key: string]: any;
    }
): Promise<{ success: boolean; error?: string }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        if (!session?.user) return { success: false, error: 'Unauthorized' };

        const userId = session.user.id;

        const snap = await db.collection(COLLECTIONS.SELLER_VERIFICATIONS)
            .where('userId', '==', userId)
            .get();

        if (snap.empty) return { success: false, error: 'No existing verification found' };

        const sortedDocs = snap.docs.sort((a, b) => {
            const aTime = a.data().createdAt?.toMillis?.() || a.data().createdAt?.seconds * 1000 || 0;
            const bTime = b.data().createdAt?.toMillis?.() || b.data().createdAt?.seconds * 1000 || 0;
            return bTime - aTime;
        });

        const latestDocRef = sortedDocs[0];
        const existing = latestDocRef.data();
        const allowedStatuses = ['pending', 'rejected', 'suspended'];
        if (!allowedStatuses.includes(existing.status)) {
            return { success: false, error: 'Your verification cannot be resubmitted at this time.' };
        }

        await latestDocRef.ref.update({
            ...fields,
            status: 'pending',
            rejectionReason: null,
            resubmittedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });

        await db.collection(COLLECTIONS.USERS).doc(userId).update({
            sellerVerificationStatus: 'pending',
            'serviceRegistrations.marketplace.status': 'pending',
            updatedAt: FieldValue.serverTimestamp(),
        });

        try {
            await invalidateUserCache(userId);
        } catch (err) {
            logger.error("Failed to invalidate cache after Seller resubmission:", err);
        }

        return { success: true };
    } catch (error: any) {
        logger.error('resubmitSellerVerificationAction error:', error);
        return { success: false, error: 'Failed to resubmit seller verification' };
    }
}

// ============================================================================
// VERIFIED BADGE — Admin Actions
// ============================================================================

/**
 * Grant or revoke the verified badge for an approved seller.
 * Admin-only action (enforced via role check).
 */
async function _updateSellerBadge(
    adminUserId: string,
    sellerId: string,
    grant: boolean
): Promise<{ success: boolean; error?: string }> {
    try {
        // Role check
        const adminDoc = await db.collection(COLLECTIONS.USERS).doc(adminUserId).get();
        const adminRoles: string[] = adminDoc.data()?.roles || [];
        const hasMarketplaceAdminAccess = adminRoles.some(r => r === "admin" || r === "super_admin" || r === "marketplace_admin");
        if (!hasMarketplaceAdminAccess) {
            return { success: false, error: "Unauthorized: admin role required" };
        }

        const now = FieldValue.serverTimestamp();

        // Update seller_verifications doc
        const verSnap = await db.collection(COLLECTIONS.SELLER_VERIFICATIONS)
            .where("userId", "==", sellerId)
            .get();

        if (!verSnap.empty) {
            const sortedDocs = verSnap.docs.sort((a, b) => {
                const aTime = a.data().createdAt?.toMillis?.() || a.data().createdAt?.seconds * 1000 || 0;
                const bTime = b.data().createdAt?.toMillis?.() || b.data().createdAt?.seconds * 1000 || 0;
                return bTime - aTime;
            });
            await sortedDocs[0].ref.update({
                isVerifiedBadge: grant,
                verifiedBadgeGrantedAt: grant ? now : null,
                verifiedBadgeGrantedBy: grant ? adminUserId : null,
                updatedAt: now,
            });
        }

        // Sync on user document
        await db.collection(COLLECTIONS.USERS).doc(sellerId).update({
            isVerifiedBadge: grant,
            verifiedBadgeGrantedAt: grant ? now : null,
            updatedAt: now,
        });

        // Denormalize onto all active products by this seller
        const productsSnap = await db.collection(COLLECTIONS.PRODUCTS)
            .where("sellerId", "==", sellerId)
            .where("status", "==", "active")
            .get();

        if (!productsSnap.empty) {
            const batch = db.batch();
            productsSnap.docs.forEach((doc) => {
                batch.update(doc.ref, { sellerVerified: grant, updatedAt: now });
            });
            await batch.commit();
        }

        // Notify the seller
        const { notifyBadgeUpdated } = await import("@/lib/marketplace-notifications");
        await notifyBadgeUpdated({ sellerId, granted: grant });

        return { success: true };
    } catch (error: any) {
        logger.error(`Badge ${grant ? "grant" : "revoke"} error:`, error);
        return { success: false, error: error.message || "Failed to update badge" };
    }
}

export async function grantSellerVerifiedBadgeAction(
    sellerId: string
): Promise<{ success: boolean; error?: string }> {
    const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false, error: "Unauthorized" };
    return _updateSellerBadge(sessionResult.session.user.id, sellerId, true);
}

export async function revokeSellerVerifiedBadgeAction(
    sellerId: string
): Promise<{ success: boolean; error?: string }> {
    const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false, error: "Unauthorized" };
    return _updateSellerBadge(sessionResult.session.user.id, sellerId, false);
}

// ============================================================================
// SELLER CATEGORY — Update action for admin
// ============================================================================

/**
 * Update the seller category (wholesale/retail) for an existing approved seller.
 * Admin or the seller themselves can update this.
 */
export async function updateSellerCategoryAction(
    sellerId: string,
    category: "wholesale" | "retail"
): Promise<{ success: boolean; error?: string }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false, error: "Unauthorized" };
        const actorId = sessionResult.session.user.id;

        // Allow: the seller themselves, or an admin
        if (actorId !== sellerId) {
            const actorDoc = await db.collection(COLLECTIONS.USERS).doc(actorId).get();
            const roles: string[] = actorDoc.data()?.roles || [];
            const hasMarketplaceAdminAccess = roles.some(r => r === "admin" || r === "super_admin" || r === "marketplace_admin");
            if (!hasMarketplaceAdminAccess) {
                return { success: false, error: "Unauthorized" };
            }
        }

        const now = FieldValue.serverTimestamp();

        await db.collection(COLLECTIONS.USERS).doc(sellerId).update({
            sellerCategory: category,
            updatedAt: now,
        });

        const verSnap = await db.collection(COLLECTIONS.SELLER_VERIFICATIONS)
            .where("userId", "==", sellerId)
            .get();
        if (!verSnap.empty) {
            const sortedDocs = verSnap.docs.sort((a, b) => {
                const aTime = a.data().createdAt?.toMillis?.() || a.data().createdAt?.seconds * 1000 || 0;
                const bTime = b.data().createdAt?.toMillis?.() || b.data().createdAt?.seconds * 1000 || 0;
                return bTime - aTime;
            });
            await sortedDocs[0].ref.update({ sellerCategory: category, updatedAt: now });
        }

        // Denormalize onto all products
        const productsSnap = await db.collection(COLLECTIONS.PRODUCTS)
            .where("sellerId", "==", sellerId)
            .get();
        if (!productsSnap.empty) {
            const batch = db.batch();
            productsSnap.docs.forEach((doc) => batch.update(doc.ref, { sellerCategory: category }));
            await batch.commit();
        }

        return { success: true };
    } catch (error: any) {
        logger.error("updateSellerCategoryAction error:", error);
        return { success: false, error: error.message || "Failed to update seller category" };
    }
}
