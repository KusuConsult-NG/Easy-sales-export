/**
 * Marketplace Server Actions
 * 
 * Server-side logic for marketplace operations
 */

"use server";

import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session-guard";
import { logger } from '@/lib/logger';
import { FieldValue, Timestamp, AggregateField } from "firebase-admin/firestore";
import { db } from "@/lib/firebase-admin"; // Use Admin DB
// import { uploadFileToStorage } from "@/lib/storage-admin";

import { COLLECTIONS } from "@/lib/types/firestore";
import type { SellerVerification, Product, CartItem, Order, ProductCategory, DeliveryMethod } from "@/lib/types/marketplace";
import { hasRole } from "@/lib/role-utils";
import { serializeDoc, serializeDocs } from "@/lib/firestore-serialize";
import { unstable_cache } from "next/cache";
import { invalidateUserCache } from "@/lib/cache-invalidation";
import { ProductSchema, 
    OrderSchema, 
    SellerAnalyticsSchema,
    MarketplaceOnboardingSchema,
    SellerVerificationSchema } from "@/lib/validations/marketplace";
import { withSafeAction, ActionResponse } from "@/lib/safe-action";

// ============================================
// Check Marketplace Application Status Action
// ============================================

async function _checkMarketplaceStatusAction(): Promise<ActionResponse<{ status: string; accountType: string } | null>> { 
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, data: null, error: "Unauthorized" };
        const { session } = sessionResult;

        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        const userData = userDoc.data();

        let status = userData?.serviceRegistrations?.marketplace?.status;
        let accountType = userData?.serviceRegistrations?.marketplace?.accountType;

        // ── AUTHORITATIVE CHECK: Check real verification record ──────
        if (status !== "approved") { const verSnap = await db.collection(COLLECTIONS.SELLER_VERIFICATIONS)
                .where("userId", "==", session.user.id)
                .orderBy("createdAt", "desc")
                .limit(1)
                .get();

            if (!verSnap.empty) {
                const verData = verSnap.docs[0].data();
                if (verData.status === "approved") {
                    status = "approved";
                    accountType = verData.accountType || "seller";
                    // Proactively backfill for performance in future logins
                    await db.collection(COLLECTIONS.USERS).doc(session.user.id).set({
                        serviceRegistrations: { marketplace: { status: "approved", accountType, syncedAt: new Date().toISOString() } },
                        _version: FieldValue.increment(1)
                    }, { merge: true });
                } else if (verData.status) { status = verData.status;
                    accountType = verData.accountType || accountType;
                }
            }
        }

        if (status) { return { error: null, success: true as const, data: { status, accountType } };
        }

        // ── FALLBACK: Returning user whose marketplace data predates V2 schema ──
        const legacySellerSnap = await db.collection(COLLECTIONS.MARKETPLACE_SELLERS)
            .where('userId', '==', session.user.id)
            .limit(1)
            .get();

        if (!legacySellerSnap.empty) { const legacyData = legacySellerSnap.docs[0].data();
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
                    },
                    _version: FieldValue.increment(1)
                },
                { merge: true }
            );

            logger.info(`[checkMarketplaceStatus] Backfilled legacy marketplace status '${legacyStatus}' for user ${session.user.id}`);
            return { error: null, success: true as const, data: { status: legacyStatus, accountType: legacyAccountType } };
        }

        // ── FALLBACK 2: Check legacy sellerVerificationStatus field
        if (userData?.sellerVerificationStatus) { const legacyStatus = userData.sellerVerificationStatus;
            const derivedAccountType = "seller";
            await db.collection(COLLECTIONS.USERS).doc(session.user.id).set(
                { 
                    serviceRegistrations: { marketplace: { status: legacyStatus, accountType: derivedAccountType, syncedFromLegacy: true, syncedAt: new Date().toISOString() } },
                    _version: FieldValue.increment(1)
                },
                { merge: true }
            );
            return { error: null, success: true as const, data: { status: legacyStatus, accountType: derivedAccountType } };
        }

        // ── FALLBACK 3: Check seller_verifications collection
        const verificationSnap = await db.collection(COLLECTIONS.SELLER_VERIFICATIONS)
            .where('userId', '==', session.user.id)
            .get();

        if (!verificationSnap.empty) { const sortedDocs = verificationSnap.docs.map(d => d.data()).sort((a: any, b: any) => {
                const aTime = a.createdAt?.toMillis?.() || a.createdAt?.seconds * 1000 || 0;
                const bTime = b.createdAt?.toMillis?.() || b.createdAt?.seconds * 1000 || 0;
                return bTime - aTime;
            });
            const vData = sortedDocs[0];
            const vStatus = vData?.status ?? 'pending';
            const vAccountType = vData?.accountType ?? 'seller';

            await db.collection(COLLECTIONS.USERS).doc(session.user.id).set(
                { serviceRegistrations: {
                        marketplace: {
                            status: vStatus,
                            accountType: vAccountType,
                            syncedFromLegacy: true,
                            syncedAt: new Date().toISOString()
                        }
                    },
                    _version: FieldValue.increment(1)
                },
                { merge: true }
            );

            logger.info(`[checkMarketplaceStatus] Backfilled from seller_verifications status '${vStatus}' for user ${session.user.id}`);
            return { error: null, success: true as const, data: { status: vStatus, accountType: vAccountType } };
        }

        return { error: null, success: true as const, data: null };
    } catch (error) { 
        logger.error("checkMarketplaceStatus error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to check marketplace status", data: null };
    }
}
export const checkMarketplaceStatusAction = withSafeAction("checkMarketplaceStatusAction", _checkMarketplaceStatusAction);

// ============================================================================
// SELLER VERIFICATION
// ============================================================================

export interface SellerVerificationFormData { phoneNumber: string;
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
    country: string; }

export type SellerVerificationState = 
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any };

/**
 * Submit seller verification application
 */
async function _submitSellerVerificationAction(
    prevState: any,
    formData: FormData
): Promise<ActionResponse<null>> { 
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized", data: null };
        const { session } = sessionResult;
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
                return { success: false as const, error: "You already have a verification application. Please check your status.", data: null };
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
                bankCode: formData.get("bankCode") as string 
            },
            address: { 
                street: formData.get("street") as string,
                city: formData.get("city") as string,
                state: formData.get("state") as string,
                lga: formData.get("lga") as string,
                country: formData.get("country") as string || "Nigeria" 
            },
            createdAt: new Date(),
            updatedAt: new Date(),
            _version: 0 
        };

        // Atomic update of verification doc and user record
        await db.runTransaction(async (transaction) => { 
            transaction.set(verificationRef, verificationData);

            // Update user record
            const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
            transaction.update(userRef, {
                sellerVerificationStatus: "pending",
                sellerVerificationId: verificationId,
                updatedAt: FieldValue.serverTimestamp(),
                _version: FieldValue.increment(1) 
            });
        });

        try { 
            await invalidateUserCache(userId);
        } catch (err) { 
            logger.error("Failed to invalidate cache after Seller Verification:", { userId, error: err });
        }

        return { error: null, success: true as const, data: null };
    } catch (error) { 
        logger.error("Seller verification error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error instanceof Error ? error.message : "Failed to submit verification", data: null };
    }
}
export const submitSellerVerificationAction = withSafeAction("submitSellerVerificationAction", _submitSellerVerificationAction);


/**
 * Get seller verification status
 */
/**
 * Get seller verification status
 */
async function _getSellerVerificationAction(): Promise<ActionResponse<{ verification: SellerVerification | null }>> { 
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized", data: null };
        const { session } = sessionResult;

        const userId = session.user.id;
        const snapshot = await db.collection(COLLECTIONS.SELLER_VERIFICATIONS)
            .where("userId", "==", userId)
            .get();

        if (snapshot.empty) { 
            return { error: null, success: true as const, data: { verification: null } };
        }

        const sortedDocs = snapshot.docs.sort((a, b) => { 
            const aTime = a.data().createdAt?.toMillis?.() || a.data().createdAt?.seconds * 1000 || 0;
            const bTime = b.data().createdAt?.toMillis?.() || b.data().createdAt?.seconds * 1000 || 0;
            return bTime - aTime;
        });
        const verification = serializeDoc<SellerVerification>(sortedDocs[0].id, sortedDocs[0].data());

        return { error: null, success: true as const, data: { verification } };
    } catch (error) { 
        logger.error("Get seller verification error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error instanceof Error ? error.message : "Fetch failed", data: null };
    }
}
export const getSellerVerificationAction = withSafeAction("getSellerVerificationAction", _getSellerVerificationAction);

/**
 * Submit full marketplace onboarding (Profile + Verification + Files)
 */
/**
 * Submit full marketplace onboarding (Profile + Verification + Files)
 */
async function _submitMarketplaceOnboardingAction(
    formData: FormData
): Promise<ActionResponse<null>> { 
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized", data: null };
        const { session } = sessionResult;

        const userId = session.user.id;
        const timestamp = Date.now();

        // Check for existing application
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
        const existingStatus = userDoc.data()?.serviceRegistrations?.marketplace?.status;

        if (existingStatus === 'pending' || existingStatus === 'under_review') { 
            return { success: false as const, error: "Your previous application is still being processed.", data: null };
        }
        if (existingStatus === 'approved') { 
            return { success: false as const, error: "You are already registered for Marketplace.", data: null };
        }

        // 1. Handle File Uploads (Admin SDK Storage)
        const uploadFile = async (file: File, path: string) => {
            const extension = file.name.split('.').pop();
            const fileName = `${timestamp}_${Math.random().toString(36).substring(7)}.${extension}`;
            const destination = `${path}/${userId}/${fileName}`;

            // Use signed URLs (private/secure) for verification docs
            const { uploadFileToStorage } = await import("@/lib/storage-admin");
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

        // Upload Farm Photos
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
        } catch (e) { 
            logger.warn("Failed to parse location JSON, using defaults", { userId }); 
        }

        const bankAccountStr = formData.get("bankAccount") as string;
        let bankAccount = { bankName: "", accountNumber: "", accountName: "" };
        try { 
            bankAccount = JSON.parse(bankAccountStr);
        } catch (e) { 
            logger.warn("Failed to parse bankAccount JSON, using defaults", { userId }); 
        }

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
            sellerCategory: (formData.get("sellerCategory") as string) || "retail",
            accountType: formData.get("accountType"), 
            sellerCategories: JSON.parse(formData.get("sellerCategories") as string || "[]"),
            productionCapacity: formData.get("productionCapacity"),
            certifications: JSON.parse(formData.get("certifications") as string || "[]"),
            documents: {
                businessRegistrationUrl,
                farmPhotoUrls,
                productSampleUrls 
            },
            bankAccount,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            _version: 0 
        };

        // Save to Firestore using a transaction for atomicity
        await db.runTransaction(async (transaction) => {
            transaction.set(verificationRef, verificationData);

            const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
            const accountType = formData.get("accountType") as string;
            const isBuyerOnly = accountType === "buyer";

            const userUpdate: any = {
                phone: formData.get("phone") as string,
                location: `${location.address}, ${location.lga}, ${location.state}`,
                updatedAt: FieldValue.serverTimestamp(),
                _version: FieldValue.increment(1) 
            };

            if (isBuyerOnly) { 
                userUpdate["serviceRegistrations.marketplace"] = {
                    status: "active",
                    paymentStatus: "completed",
                    accountType: "buyer",
                    sellerCategory: "retail",
                    submittedAt: FieldValue.serverTimestamp() 
                };
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
                    paymentStatus: "completed",
                    verificationId,
                    accountType: accountType,
                    sellerCategory: formData.get("sellerCategory") as string || "retail",
                    submittedAt: FieldValue.serverTimestamp() 
                };
            }

            transaction.update(userRef, userUpdate);
        });

        try { 
            await invalidateUserCache(userId);
        } catch (err) { 
            logger.error("Failed to invalidate cache after Marketplace Onboarding:", { userId, error: err });
        }

        return { error: null, success: true as const, data: null };
    } catch (error) { 
        logger.error("Marketplace onboarding error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error instanceof Error ? error.message : "Failed to submit application", data: null };
    }
}
export const submitMarketplaceOnboardingAction = withSafeAction("submitMarketplaceOnboardingAction", _submitMarketplaceOnboardingAction);


// ============================================================================
// PRODUCT MANAGEMENT
// ============================================================================

export interface ProductFormData { title: string;
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
    exportReady: boolean; }

export type ProductActionState = 
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any };

/**
 * Create new product listing
 */
async function _createProductAction(prevState: any, formData: FormData): Promise<ActionResponse<{ productId: string }>> { 
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized", data: null };
        const { session } = sessionResult;
        const userId = session.user.id;

        // Check if user is an approved seller
        const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
        const userDoc = await userRef.get();
        const userData = userDoc.data();

        if (!hasRole(userData?.roles || [], "seller")) { 
            return { success: false as const, error: "You must have seller role to create products", data: null };
        }

        if (userData?.sellerVerificationStatus !== "approved") { 
            return { success: false as const, error: "Your seller account must be approved first", data: null };
        }

        // Extract and Prepare Data for Validation
        let certifications = [];
        try { 
            certifications = JSON.parse(formData.get("certifications") as string || "[]");
        } catch (e) { 
            logger.warn("Failed to parse certifications JSON, using defaults", { userId }); 
        }

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
            videoUrl: formData.get("videoUrl") || "" 
        };

        // Validate with Zod
        const validation = ProductSchema.safeParse(rawData);
        if (!validation.success) { 
            return { success: false as const, error: validation.error.issues[0]?.message || "Validation failed", data: null };
        }

        const validatedData: any = { ...rawData, ...validation.data };
        const productId = `product_${userId}_${Date.now()}`;

        // 1. Handle Image Uploads
        const uploadFile = async (file: File) => {
            const extension = file.name.split(".").pop();
            const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${extension}`;
            const destination = `products/${userId}/${productId}/${fileName}`;
            const { uploadFileToStorage } = await import("@/lib/storage-admin");
            return await uploadFileToStorage(file, destination, false);
        };

        const imageUrls: string[] = [];
        for (const key of Array.from(formData.keys())) { 
            if (key.startsWith("productImages_")) {
                const file = formData.get(key) as File;
                if (file.size > 0) {
                    const url = await uploadFile(file);
                    imageUrls.push(url);
                }
            }
        }

        // Fetch Seller Info
        const [vendorDoc, verificationSnap] = await Promise.all([
            db.collection(COLLECTIONS.VENDOR_PROFILES).doc(userId).get(),
            db.collection(COLLECTIONS.SELLER_VERIFICATIONS).where("userId", "==", userId).get()
        ]);

        const vendorData = vendorDoc.data();
        const verificationData = verificationSnap.empty ? null : verificationSnap.docs[0].data();

        const sellerName = vendorData?.storeInfo?.name || session.user.name || "Easy Sales Seller";
        const sellerVerified = verificationData?.isVerifiedBadge || false;
        const sellerCategory = verificationData?.sellerCategory || "retail";

        // Create product
        const productRef = db.collection(COLLECTIONS.PRODUCTS).doc(productId);

        const pricingTiers: any[] = [];
        pricingTiers.push({ type: "retail", price: validatedData.retailPrice, minQuantity: 1 });

        if (validatedData.bulkPrice && validatedData.bulkAvailable) { 
            pricingTiers.push({
                type: "bulk",
                price: validatedData.bulkPrice,
                minQuantity: validatedData.bulkMinQuantity || 50
            });
        }

        if (validatedData.exportPrice && validatedData.exportReady) { 
            pricingTiers.push({
                type: "export",
                price: validatedData.exportPrice,
                minQuantity: validatedData.exportMinQuantity || 100
            });
        }

        const productData: any = { 
            id: productId,
            sellerId: userId,
            title: validatedData.title,
            description: validatedData.description,
            category: validatedData.category,
            images: imageUrls,
            videoUrl: validatedData.videoUrl || undefined,
            pricingTiers,
            availableQuantity: validatedData.availableQuantity,
            minimumOrderQuantity: validatedData.minimumOrderQuantity,
            unit: validatedData.unit,
            location: {
                state: validatedData.state,
                lga: validatedData.lga 
            },
            deliveryMethod: validatedData.deliveryMethod,
            estimatedDeliveryDays: validatedData.estimatedDeliveryDays,
            bulkAvailable: validatedData.bulkAvailable || false,
            exportReady: validatedData.exportReady || false,
            status: "active",
            sellerName,
            sellerVerified,
            sellerCategory,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            _version: 0,
            views: 0,
            orders: 0,
            rating: 0,
            reviewCount: 0 
        };

        await productRef.set(productData);

        return { error: null, success: true as const, data: { productId } };
    } catch (error) { 
        logger.error("Create product error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to create product", data: null };
    }
}
export const createProductAction = withSafeAction("createProductAction", _createProductAction);

/**
 * Get Marketplace Products
 */
async function _getMarketplaceProductsAction(params: { 
    category?: string;
    search?: string;
    minPrice?: number;
    maxPrice?: number;
    location?: string;
    sortBy?: string;
    limit?: number; 
} = {}): Promise<ActionResponse<{ products: Product[] }>> { 
    try {
        const { category, search, location, sortBy, limit: limitCount = 20 } = params;

        let query: any = db.collection(COLLECTIONS.PRODUCTS).where("status", "==", "active");

        if (category && category !== "all") { 
            query = query.where("category", "==", category);
        }

        if (location) { 
            query = query.where("location.state", "==", location);
        }

        // Apply sorting
        switch (sortBy) { 
            case "newest":
                query = query.orderBy("createdAt", "desc");
                break;
            case "popular":
                query = query.orderBy("views", "desc");
                break;
            default:
                query = query.orderBy("createdAt", "desc");
        }

        const snapshot = await query.limit(limitCount).get();
        const { serializeValue } = await import("@/lib/firestore-serialize");
        let products = snapshot.docs.map((doc: any) => { 
            const data = doc.data();
            const parsed = ProductSchema.parse({ id: doc.id, ...data });
            return serializeValue(parsed);
        });

        if (search) { 
            const searchLower = search.toLowerCase();
            products = products.filter((p: any) => 
                p.title.toLowerCase().includes(searchLower) || 
                p.description.toLowerCase().includes(searchLower)
            );
        }

        return { error: null, success: true as const, data: { products } };
    } catch (error) { 
        logger.error("Get products error:", {
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to fetch products", data: null };
    }
}
export const getMarketplaceProductsAction = withSafeAction("getMarketplaceProductsAction", _getMarketplaceProductsAction);

/**
 * Get single product by ID
 */
async function _getProductByIdAction(productId: string): Promise<ActionResponse<Product>> { 
    try {
        const doc = await db.collection(COLLECTIONS.PRODUCTS).doc(productId).get();
        if (!doc.exists) {
            return { success: false as const, error: "Product not found", data: null };
        }

        const data = doc.data();
        const { serializeValue } = await import("@/lib/firestore-serialize");
        const product = serializeValue(ProductSchema.parse({ id: doc.id, ...data })) as Product;

        return { error: null, success: true as const, data: product };
    } catch (error) { 
        logger.error("Get product by id error:", {
            productId,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to fetch product", data: null };
    }
}
export const getProductByIdAction = withSafeAction("getProductByIdAction", _getProductByIdAction);
export const getProductAction = getProductByIdAction;

/**
 * Delete a product listing
 */
async function _deleteProductAction(productId: string): Promise<ActionResponse<{ success: boolean; message: string }>> { 
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized", data: null };
        const { session } = sessionResult;
        const userId = session.user.id;

        const productRef = db.collection(COLLECTIONS.PRODUCTS).doc(productId);
        const productDoc = await productRef.get();

        if (!productDoc.exists) { 
            return { success: false as const, error: "Product not found", data: null };
        }

        const productData = productDoc.data();
        // Ensure ownership
        if (productData?.sellerId !== userId) { 
            const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
            const roles = userDoc.data()?.roles || [];
            const isAdmin = roles.some((r: string) => r === "admin" || r === "super_admin" || r === "marketplace_admin");
            if (!isAdmin) {
                return { success: false as const, error: "Unauthorized: You do not own this product", data: null };
            }
        }

        await productRef.delete();
        return { error: null, success: true as const, data: { success: true, message: "Product deleted successfully" } };
    } catch (error) { 
        logger.error("Delete product error:", {
            productId,
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to delete product", data: null };
    }
}
export const deleteProductAction = withSafeAction("deleteProductAction", _deleteProductAction);

/**
 * Get Recommended Products
 */
async function _getRecommendedProductsAction(limitCount: number = 3): Promise<ActionResponse<{ products: Product[] }>> { 
    try {
        const query = db.collection(COLLECTIONS.PRODUCTS)
            .where("status", "==", "active")
            .orderBy("createdAt", "desc")
            .limit(limitCount);

        const snapshot = await query.get();
        const { serializeValue } = await import("@/lib/firestore-serialize");
        const products = snapshot.docs.map((doc: any) => { 
            const data = doc.data();
            const parsed = ProductSchema.parse({ id: doc.id, ...data });
            return serializeValue(parsed);
        });

        return { error: null, success: true as const, data: { products } };
    } catch (error) { 
        logger.error("Get recommended products error:", {
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to fetch recommended products", data: null };
    }
}
export const getRecommendedProductsAction = withSafeAction("getRecommendedProductsAction", _getRecommendedProductsAction);

/**
 * Get seller's products
 */
async function _getSellerProductsAction(options: { 
    limit?: number;
    lastId?: string;
    status?: string;
    search?: string;
    sortBy?: string;
    sortDir?: "asc" | "desc"; 
} = {}): Promise<ActionResponse<{ products: Product[]; lastId?: string; hasMore: boolean }>> { 
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized", data: null };
        const { session } = sessionResult;
        const userId = session.user.id;

        const { 
            limit = 50,
            lastId,
            status,
            search,
            sortBy = "createdAt",
            sortDir = "desc"
        } = options;

        let query = db.collection(COLLECTIONS.PRODUCTS).where("sellerId", "==", userId);

        if (status && status !== "all" && status !== "low_stock") { 
            query = query.where("status", "==", status);
        }

        if (status === "low_stock") { 
            query = query.where("availableQuantity", "<", 50).where("availableQuantity", ">", 0);
        }

        try { 
            query = query.orderBy(sortBy, sortDir);
        } catch (e) { 
            logger.warn("Sorting failed, likely missing index. Falling back to default sort.", { userId }); 
        }

        if (lastId) { 
            const lastDoc = await db.collection(COLLECTIONS.PRODUCTS).doc(lastId).get();
            if (lastDoc.exists) query = query.startAfter(lastDoc);
        }

        query = query.limit(limit);
        const snapshot = await query.get();
        const { serializeValue } = await import("@/lib/firestore-serialize");
        
        let products = snapshot.docs.map((doc: any) => { 
            const data = doc.data();
            const parsed = ProductSchema.parse({ id: doc.id, ...data });
            return serializeValue(parsed);
        });

        if (search) { 
            const searchLower = search.toLowerCase();
            products = products.filter((p: any) =>
                p.title?.toLowerCase()?.includes(searchLower) ||
                p.category?.toLowerCase()?.includes(searchLower)
            );
        }

        let newLastId = undefined;
        let hasMore = false;
        if (snapshot.docs.length === limit) { 
            hasMore = true;
            newLastId = snapshot.docs[snapshot.docs.length - 1].id;
        }

        return { error: null, success: true as const, data: { products, lastId: newLastId, hasMore } };
    } catch (error) { 
        logger.error("Get seller products error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to fetch products", data: null };
    }
}
export const getSellerProductsAction = withSafeAction("getSellerProductsAction", _getSellerProductsAction);


/**
 * Get seller's orders
 */
async function _getSellerOrdersAction(options: { limit?: number;
    lastId?: string;
    status?: string;
    search?: string; } = {}): Promise<ActionResponse<{ orders: Order[]; lastId?: string; hasMore: boolean }>> { 
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized", data: null };
        const { session } = sessionResult;

        const userId = session.user.id;
        const { limit = 20, lastId, status, search } = options;

        const fetchLimit = search ? Math.min(limit * 5, 100) : limit;

        let query: FirebaseFirestore.Query = db.collection(COLLECTIONS.MARKETPLACE_ORDERS)
            .where("sellerIds", "array-contains", userId)
            .orderBy("createdAt", "desc");

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
        const { serializeValue } = await import("@/lib/firestore-serialize");
        let orders = snapshot.docs.map((doc: any) => { 
            const data = doc.data();
            const parsed = OrderSchema.parse({ id: doc.id, ...data });
            return serializeValue(parsed);
        });

        // Server-assisted search
        if (search) { 
            const q = search.toLowerCase();
            orders = orders.filter((o: any) => {
                return (
                    o.id?.toLowerCase().includes(q) ||
                    o.buyerName?.toLowerCase().includes(q) ||
                    o.buyerEmail?.toLowerCase().includes(q) ||
                    o.items?.some((item: any) => item.title?.toLowerCase().includes(q))
                );
            }).slice(0, limit);
        }

        let newLastId = undefined;
        let hasMore = false;

        if (!search && snapshot.docs.length === fetchLimit) { 
            hasMore = true;
            newLastId = snapshot.docs[snapshot.docs.length - 1].id;
        }

        return { 
            error: null, 
            success: true as const, 
            data: { orders, lastId: newLastId, hasMore } 
        };
    } catch (error) { 
        logger.error("Get seller orders error:", {
            userId: sessionResult?.session?.user?.id,
            options,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error instanceof Error ? error.message : "Fetch failed", data: null };
    }
}
export const getSellerOrdersAction = withSafeAction("getSellerOrdersAction", _getSellerOrdersAction);

/**
 * Get seller analytics
 */
async function _getSellerAnalyticsAction(): Promise<ActionResponse<{ analytics: any }>> { 
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized", data: null };
        const { session } = sessionResult;

        const userId = session.user.id;

        const ordersRef = db.collection(COLLECTIONS.MARKETPLACE_ORDERS)
            .where("sellerIds", "array-contains", userId);
        const productsRef = db.collection(COLLECTIONS.PRODUCTS)
            .where("sellerId", "==", userId);

        const totalSalesSnapshot = await ordersRef
            .where("status", "not-in", ["cancelled", "disputed"])
            .aggregate({ totalAmount: AggregateField.sum("totalAmount"),
                count: AggregateField.count()
            })
            .get();
        const totalSales = totalSalesSnapshot.data().totalAmount || 0;
        const totalOrdersCount = totalSalesSnapshot.data().count || 0;

        const pendingOrdersSnapshot = await ordersRef
            .where("status", "in", ["pending_payment", "processing"])
            .aggregate({ count: AggregateField.count()
            })
            .get();
        const pendingOrders = pendingOrdersSnapshot.data().count || 0;

        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);

        const monthlyRevenueSnapshot = await ordersRef
            .where("status", "not-in", ["cancelled", "disputed"])
            .where("createdAt", ">=", startOfMonth)
            .aggregate({ totalAmount: AggregateField.sum("totalAmount")
            })
            .get();
        const monthlyRevenue = monthlyRevenueSnapshot.data().totalAmount || 0;

        const startOfPrevMonth = new Date(startOfMonth);
        startOfPrevMonth.setMonth(startOfPrevMonth.getMonth() - 1);
        const endOfPrevMonth = new Date(startOfMonth);

        const prevMonthRevenueSnapshot = await ordersRef
            .where("status", "not-in", ["cancelled", "disputed"])
            .where("createdAt", ">=", startOfPrevMonth)
            .where("createdAt", "<", endOfPrevMonth)
            .aggregate({ totalAmount: AggregateField.sum("totalAmount")
            })
            .get();
        const prevMonthRevenue = prevMonthRevenueSnapshot.data().totalAmount || 0;

        const activeListingsSnapshot = await productsRef
            .where("status", "==", "active")
            .count()
            .get();
        const activeListings = activeListingsSnapshot.data().count || 0;

        const productStatsSnapshot = await productsRef
            .aggregate({ totalViews: AggregateField.sum("views"),
                avgRating: AggregateField.average("rating")
            })
            .get();
        const totalProductViews = productStatsSnapshot.data().totalViews || 0;
        const averageRating = productStatsSnapshot.data().avgRating || 0;

        const conversionRate = totalProductViews > 0
            ? parseFloat(((totalOrdersCount / totalProductViews) * 100).toFixed(1))
            : 0;

        const { serializeValue } = await import("@/lib/firestore-serialize");
        const analytics = SellerAnalyticsSchema.parse({ totalSales,
            activeListings,
            pendingOrders,
            monthlyRevenue,
            conversionRate,
            averageRating,
            prevMonthRevenue,
            prevTotalSales: totalSales - monthlyRevenue,
            prevActiveListings: 0 });

        return { error: null,  success: true as const, data: { analytics: serializeValue(analytics) } };
    } catch (error: any) { 
        logger.error("Get seller analytics error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error instanceof Error ? error.message : "Failed to fetch analytics", data: null };
    }
}
export const getSellerAnalyticsAction = withSafeAction("getSellerAnalyticsAction", _getSellerAnalyticsAction);


/**
 * Get buyer's orders
 */
async function _getBuyerOrdersAction(options: { limit?: number;
    lastId?: string;
    status?: string; } = {}): Promise<ActionResponse<{ orders: Order[]; lastId?: string; hasMore: boolean }>> { 
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized", data: null };
        const { session } = sessionResult;

        const { limit = 20, lastId, status } = options;

        let query: FirebaseFirestore.Query = db.collection(COLLECTIONS.MARKETPLACE_ORDERS)
            .where("buyerId", "==", session.user.id)
            .orderBy("createdAt", "desc");

        if (status && status !== "all") { 
            query = db.collection(COLLECTIONS.MARKETPLACE_ORDERS)
                .where("buyerId", "==", session.user.id)
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
        const { serializeValue } = await import("@/lib/firestore-serialize");
        const orders = snapshot.docs.map((doc: any) => { 
            const data = doc.data();
            const parsed = OrderSchema.parse({ id: doc.id, ...data });
            return serializeValue(parsed);
        });

        let newLastId = undefined;
        let hasMore = false;

        if (snapshot.docs.length === limit) { 
            hasMore = true;
            newLastId = snapshot.docs[snapshot.docs.length - 1].id;
        }

        return { 
            error: null, 
            success: true as const, 
            data: { orders, lastId: newLastId, hasMore } 
        };
    } catch (error: any) { 
        logger.error("Get buyer orders error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to fetch orders", data: null };
    }
}
export const getBuyerOrdersAction = withSafeAction("getBuyerOrdersAction", _getBuyerOrdersAction);

/**
 * Get buyer dashboard stats
 */
async function _getBuyerStatsAction(): Promise<ActionResponse<{ stats: { activeOrders: number; completedOrders: number; totalSpent: number; savedSellers: number } }>> { 
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized", data: null };
        const { session } = sessionResult;

        const snapshot = await db.collection(COLLECTIONS.MARKETPLACE_ORDERS)
            .where("buyerId", "==", session.user.id)
            .get();

        const orders = snapshot.docs.map((doc: any) => doc.data() as Order);

        const activeOrders = orders.filter(o => o.status !== "delivered" && o.status !== "cancelled" && o.status !== "completed").length;
        const completedOrders = orders.filter(o => o.status === "delivered" || o.status === "completed").length;
        const totalSpent = orders.reduce((sum, o) => sum + o.totalAmount, 0);

        const buyerDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        const savedSellers: number = buyerDoc.data()?.savedSellersCount ?? 0;

        const stats = { activeOrders, completedOrders, totalSpent, savedSellers };
        return { error: null, success: true as const, data: { stats } };
    } catch (error: any) { 
        logger.error("Get buyer stats error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error instanceof Error ? error.message : "Failed to fetch stats", data: null };
    }
}
export const getBuyerStatsAction = withSafeAction("getBuyerStatsAction", _getBuyerStatsAction);

/**
 * Get related products based on category and location
 */
async function _getRelatedProductsAction(productId: string, limit: number = 4): Promise<ActionResponse<{ products: Product[] }>> { 
    try {
        const productRef = db.collection(COLLECTIONS.PRODUCTS).doc(productId);
        const productSnap = await productRef.get();

        if (!productSnap.exists) {
            return { success: false as const, error: "Product not found", data: null };
        }

        const product = productSnap.data() as Product;

        const snapshot = await db.collection(COLLECTIONS.PRODUCTS)
            .where("category", "==", product.category)
            .where("status", "==", "active")
            .limit(limit + 1)
            .get();

        const { serializeValue } = await import("@/lib/firestore-serialize");
        const products = snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }))
            .filter((p: any) => p.id !== productId);

        return { error: null, success: true as const, data: { 
                products: serializeValue(products.slice(0, limit)) 
 } 
        };
    } catch (error: any) { 
        logger.error("Get related products error:", error);
        return { success: false as const, error: error instanceof Error ? error.message : "Failed to fetch related products", data: null };
    }
}
export const getRelatedProductsAction = withSafeAction("getRelatedProductsAction", _getRelatedProductsAction);

/**
 * Search Products
 */
async function _searchProductsAction(params: { query?: string;
    category?: string;
    state?: string;
    sortBy?: string;
    limit?: number;
    lastId?: string; }): Promise<ActionResponse<{ products: Product[]; lastId?: string; hasMore: boolean }>> { 
    try {
        const limit = params.limit || 12;
        let query = db.collection(COLLECTIONS.PRODUCTS)
            .where("status", "==", "active")
            .where("availableQuantity", ">", 0);

        if (params.category && params.category !== "All Categories") {
            query = query.where("category", "==", params.category);
        }

        if (params.state && params.state !== "All Locations") { 
            query = query.where("location.state", "==", params.state);
        }

        if (params.sortBy === "price_asc") { 
            query = query.orderBy("pricingTiers.0.price", "asc");
        } else if (params.sortBy === "price_desc") { 
            query = query.orderBy("pricingTiers.0.price", "desc");
        } else if (params.sortBy === "rating") { 
            query = query.orderBy("rating", "desc");
        } else { 
            query = query.orderBy("createdAt", "desc");
        }

        if (params.lastId) { 
            const lastDoc = await db.collection(COLLECTIONS.PRODUCTS).doc(params.lastId).get();
            if (lastDoc.exists) {
                query = query.startAfter(lastDoc);
            }
        }

        query = query.limit(limit);

        const snapshot = await query.get();
        const products = snapshot.docs.map((doc: any) => { 
            const data = doc.data();
            return ProductSchema.parse({ id: doc.id, ...data });
        });
        const lastVisible = snapshot.docs[snapshot.docs.length - 1];

        // Fetch seller names (optimize this with a separate user index/cache later)
        const productsWithSellers = await Promise.all(
            products.map(async (product) => { 
                let sellerName = "Unknown Seller";
                if (product.sellerId) {
                    if (product.sellerName) {
                        sellerName = product.sellerName; 
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

        let finalProducts = productsWithSellers;
        if (params.query) { 
            const lowerQuery = params.query.toLowerCase();
            finalProducts = finalProducts.filter(p =>
                p.title?.toLowerCase()?.includes(lowerQuery) ||
                p.description?.toLowerCase()?.includes(lowerQuery)
            );
        }

        const { serializeValue } = await import("@/lib/firestore-serialize");
        return { 
            error: null, 
            success: true as const, 
            data: { 
                products: serializeValue(finalProducts), 
                lastId: lastVisible ? lastVisible.id : undefined, 
                hasMore: snapshot.docs.length === limit 
            }
        };

    } catch (error: any) { 
        logger.error("Search products error:", {
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error instanceof Error ? error.message : "Search failed", data: null };
    }
}
export const searchProductsAction = withSafeAction("searchProductsAction", _searchProductsAction);


// ============================================================================
// USER RESUBMIT — Seller Verification
// ============================================================================

/**
 * Resubmit verification after rejection
 */
async function _resubmitSellerVerificationAction(data: any): Promise<ActionResponse<{ verificationId: string }>> { 
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized", data: null };
        const { session } = sessionResult;

        // Find the most recent rejected verification for this user
        const snapshot = await db.collection(COLLECTIONS.SELLER_VERIFICATIONS)
            .where("userId", "==", session.user.id)
            .orderBy("createdAt", "desc")
            .limit(1)
            .get();

        if (snapshot.empty) {
            return { success: false as const, error: "No verification record found to resubmit.", data: null };
        }

        const doc = snapshot.docs[0];
        const existing = doc.data();
        
        if (existing?.status !== "rejected") {
            return { success: false as const, error: `Can only resubmit rejected verifications (Current: ${existing?.status})`, data: null };
        }

        await doc.ref.update({ 
            ...data,
            status: "pending",
            submittedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            rejectionReason: null
        });

        return { error: null, success: true as const, data: { verificationId: doc.id } };
    } catch (error: any) { 
        logger.error("Resubmit verification error:", error);
        return { success: false as const, error: error instanceof Error ? error.message : "Resubmission failed", data: null };
    }
}
export const resubmitSellerVerificationAction = withSafeAction("resubmitSellerVerificationAction", _resubmitSellerVerificationAction);


// ============================================================================
// VERIFIED BADGE — Admin Actions
// ============================================================================

/**
 * Admin action to grant verified badge
 */
async function _grantSellerVerifiedBadgeAction(userId: string): Promise<ActionResponse<{ success: boolean }>> { 
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized", data: null };
        
        const roles = sessionResult.session.user.roles || [];
        const isAdmin = roles.some(r => r === "admin" || r === "super_admin" || r === "marketplace_admin");
        
        if (!isAdmin) {
            return { success: false as const, error: "Unauthorized: Admin only", data: null };
        }

        await db.collection(COLLECTIONS.USERS).doc(userId).update({ 
            isSellerVerified: true,
            sellerBadge: "verified",
            updatedAt: FieldValue.serverTimestamp()
        });

        return { error: null, success: true as const, data: { success: true } };
    } catch (error: any) { 
        logger.error("Grant badge error:", error);
        return { success: false as const, error: error instanceof Error ? error.message : "Failed to grant badge", data: null };
    }
}
export const grantSellerVerifiedBadgeAction = withSafeAction("grantSellerVerifiedBadgeAction", _grantSellerVerifiedBadgeAction);

/**
 * Admin action to revoke verified badge
 */
async function _revokeSellerVerifiedBadgeAction(userId: string): Promise<ActionResponse<{ success: boolean }>> { 
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized", data: null };

        const roles = sessionResult.session.user.roles || [];
        const isAdmin = roles.some(r => r === "admin" || r === "super_admin" || r === "marketplace_admin");

        if (!isAdmin) {
            return { success: false as const, error: "Unauthorized: Admin only", data: null };
        }

        await db.collection(COLLECTIONS.USERS).doc(userId).update({ 
            isSellerVerified: false,
            sellerBadge: null,
            updatedAt: FieldValue.serverTimestamp()
        });

        return { error: null, success: true as const, data: { success: true } };
    } catch (error: any) { 
        logger.error("Revoke badge error:", error);
        return { success: false as const, error: error instanceof Error ? error.message : "Failed to revoke badge", data: null };
    }
}
export const revokeSellerVerifiedBadgeAction = withSafeAction("revokeSellerVerifiedBadgeAction", _revokeSellerVerifiedBadgeAction);


// ============================================================================
// SELLER CATEGORY — Update action for admin
// ============================================================================

/**
 * Update the seller category (wholesale/retail) for an existing approved seller.
 * Admin or the seller themselves can update this.
 */
async function _updateSellerCategoryAction(
    sellerId: string,
    category: "wholesale" | "retail"
): Promise<ActionResponse<{ message: string }>> { 
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized", data: null };
        const actorId = sessionResult.session.user.id;

        // Allow: the seller themselves, or an admin
        if (actorId !== sellerId) { 
            const actorDoc = await db.collection(COLLECTIONS.USERS).doc(actorId).get();
            const roles: string[] = actorDoc.data()?.roles || [];
            const hasMarketplaceAdminAccess = roles.some(r => r === "admin" || r === "super_admin" || r === "marketplace_admin");
            if (!hasMarketplaceAdminAccess) {
                return { success: false as const, error: "Unauthorized", data: null };
            }
        }

        const now = FieldValue.serverTimestamp();

        // Perform updates in a single transaction for atomicity
        await db.runTransaction(async (transaction) => { 
            // 1. Update User Document
            const userRef = db.collection(COLLECTIONS.USERS).doc(sellerId);
            transaction.update(userRef, {
                sellerCategory: category,
                updatedAt: now,
                _version: FieldValue.increment(1) 
            });

            // 2. Update Verification Document
            const verSnap = await transaction.get(db.collection(COLLECTIONS.SELLER_VERIFICATIONS)
                .where("userId", "==", sellerId));
            if (!verSnap.empty) { 
                const sortedDocs = verSnap.docs.sort((a, b) => {
                    const aData = a.data();
                    const bData = b.data();
                    const aTime = aData.createdAt?.toMillis?.() || aData.createdAt?.seconds * 1000 || 0;
                    const bTime = bData.createdAt?.toMillis?.() || bData.createdAt?.seconds * 1000 || 0;
                    return bTime - aTime;
                });
                transaction.update(sortedDocs[0].ref, { 
                    sellerCategory: category, 
                    updatedAt: now,
                    _version: FieldValue.increment(1) 
                });
            }

            // 3. Denormalize onto all products
            const productsSnap = await transaction.get(db.collection(COLLECTIONS.PRODUCTS)
                .where("sellerId", "==", sellerId));
            if (!productsSnap.empty) { 
                productsSnap.docs.forEach((doc) => {
                    transaction.update(doc.ref, { 
                        sellerCategory: category, 
                        updatedAt: now,
                        _version: FieldValue.increment(1) 
                    });
                });
            }
        });

        return { error: null, success: true as const, data: { message: "Category updated" } };
    } catch (error) { 
        logger.error("updateSellerCategoryAction error:", {
            userId: sessionResult?.session?.user?.id,
            sellerId,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error instanceof Error ? error.message : "Failed to update seller category", data: null };
    }
}
export const updateSellerCategoryAction = withSafeAction("updateSellerCategoryAction", _updateSellerCategoryAction);
