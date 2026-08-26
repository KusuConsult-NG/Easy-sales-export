"use server";

import { requireSession } from "@/lib/session-guard";
import { logger } from '@/lib/logger';
import { FieldValue, Timestamp } from "@/lib/firestore-compat";
import { supabaseDb as db } from "@/lib/supabase-db";
// Use Admin DB
// import { uploadFileToStorage } from "@/lib/storage-admin";

import { COLLECTIONS } from "@/lib/types/firestore";
import type { Product } from "@/lib/types/marketplace";
import { hasRole } from "@/lib/role-utils";
import { ProductSchema } from "@/lib/validations/marketplace";
import { withSafeAction, ActionResponse } from "@/lib/safe-action";
import { parseCurrencyStringToFloat } from "@/lib/utils";
import { newestVerification, SELLER_NAME_FALLBACK } from "@/lib/seller-trust";
import { PRODUCT_INITIAL_STATUS } from "@/lib/product-status";
import { retirementPatch } from "@/lib/record-retirement";

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
async function _createProductAction(prevState: unknown, formData: FormData): Promise<ActionResponse<{ productId: string }>> { 
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

        const retailPrice = parseCurrencyStringToFloat(formData.get("retailPrice") as string || "0");
        const bulkPrice = formData.get("bulkPrice") ? parseCurrencyStringToFloat(formData.get("bulkPrice") as string) : undefined;
        const exportPrice = formData.get("exportPrice") ? parseCurrencyStringToFloat(formData.get("exportPrice") as string) : undefined;
        const bulkAvailable = formData.get("bulkAvailable") === "true";
        const exportReady = formData.get("exportReady") === "true";
        const bulkMinQuantity = formData.get("bulkMinQuantity") ? parseInt(formData.get("bulkMinQuantity") as string) : undefined;
        const exportMinQuantity = formData.get("exportMinQuantity") ? parseInt(formData.get("exportMinQuantity") as string) : undefined;

        const pricingTiers: any[] = [];
        pricingTiers.push({ type: "retail", price: retailPrice, minQuantity: 1 });

        if (bulkPrice && bulkAvailable) { 
            pricingTiers.push({
                type: "bulk",
                price: bulkPrice,
                minQuantity: bulkMinQuantity || 50
            });
        }

        if (exportPrice && exportReady) { 
            pricingTiers.push({
                type: "export",
                price: exportPrice,
                minQuantity: exportMinQuantity || 100
            });
        }

        const productId = `product_${userId}_${Date.now()}`;
        const rawData = { 
            id: productId,
            sellerId: userId,
            createdAt: new Date(),
            updatedAt: new Date(),
            title: formData.get("title") || undefined,
            description: formData.get("description") || undefined,
            category: formData.get("category") || undefined,
            pricingTiers,
            availableQuantity: parseInt(formData.get("availableQuantity") as string || "0"),
            minimumOrderQuantity: parseInt(formData.get("minimumOrderQuantity") as string || "1"),
            unit: formData.get("unit") || undefined,
            location: {
                state: formData.get("state") as string || "Lagos",
                lga: formData.get("lga") as string || "Unknown",
                nearestMarket: formData.get("nearestMarket") as string || "Unknown",
            },
            deliveryMethod: formData.get("deliveryMethod") || undefined,
            estimatedDeliveryDays: formData.get("estimatedDeliveryDays") ? parseInt(formData.get("estimatedDeliveryDays") as string) : undefined,
            certifications,
            bulkAvailable,
            exportReady,
            videoUrl: formData.get("videoUrl") || "" 
        };

        // Validate with Zod
        const validation = ProductSchema.safeParse(rawData);
        if (!validation.success) { 
            logger.error("Product validation failed:", validation.error.format());
            return { success: false as const, error: validation.error.issues[0]?.path.join(".") + ": " + validation.error.issues[0]?.message || "Validation failed", data: null };
        }

        const validatedData = validation.data;

        // 1. Handle Image Uploads (supports pre-uploaded URLs or server-side fallback)
        const uploadFile = async (file: File) => {
            const extension = file.name.split(".").pop();
            const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${extension}`;
            const destination = `products/${userId}/${productId}/${fileName}`;
            const { uploadFileToStorage } = await import("@/lib/storage-admin");
            // isPublic=true so buyers can view images in the marketplace
            return await uploadFileToStorage(file, destination);
        };

        const imageUrls: string[] = [];
        for (const key of Array.from(formData.keys())) { 
            if (key.startsWith("productImages_") || key.startsWith("image")) {
                const val = formData.get(key);
                if (val) {
                    if (typeof val === "string" && val.startsWith("http")) {
                        imageUrls.push(val);
                    } else if (val instanceof File && val.size > 0) {
                        const url = await uploadFile(val);
                        imageUrls.push(url);
                    }
                }
            }
        }

        // Fetch Seller Info
        const [vendorDoc, verificationSnap] = await Promise.all([
            db.collection(COLLECTIONS.VENDOR_PROFILES).doc(userId).get(),
            db.collection(COLLECTIONS.SELLER_VERIFICATIONS).where("userId", "==", userId).get()
        ]);

        const vendorData = vendorDoc.data();

        // NEWEST verification, not docs[0].
        //
        // The query has no ordering, so a seller with more than one verification
        // record got whichever row the database happened to return first — which
        // is how a superseded verification could decide the badge and the
        // category. marketplace/seller/layout.tsx sorts this exact query by
        // createdAt for the same reason.
        const verificationData = newestVerification(
            verificationSnap.docs.map((d: any) => d.data()),
        );

        const sellerName = vendorData?.storeInfo?.name || session.user.name || SELLER_NAME_FALLBACK;
        // Written for the shape's other readers (the export catalog, the admin
        // views). NO buyer-facing path trusts this copy any more: it is a
        // snapshot taken now and never refreshed, so granting the badge would
        // not add it to this product and revoking would not remove it. Every
        // read path resolves the badge live — see lib/seller-trust.ts.
        const sellerVerified = verificationData?.isVerifiedBadge === true;
        const sellerCategory = verificationData?.sellerCategory || "retail";

        // Create product
        const productRef = db.collection(COLLECTIONS.PRODUCTS).doc(productId);

        const productData: any = { 
            id: productId,
            sellerId: userId,
            title: validatedData.title,
            description: validatedData.description,
            category: validatedData.category,
            images: imageUrls,
            videoUrl: (validatedData.videoUrl as string) || undefined,
            pricingTiers: validatedData.pricingTiers,
            availableQuantity: validatedData.availableQuantity,
            minimumOrderQuantity: validatedData.minimumOrderQuantity,
            unit: validatedData.unit,
            location: {
                state: validatedData.location.state,
                lga: validatedData.location.lga,
                // Collected by both forms, validated into `validatedData`, and
                // then dropped — the same shape as the certifications defect,
                // one field over in the same object. /api/marketplace/create-product
                // writes it, and the seller edit page reads it back into its own
                // field and re-sends it, so an edit made through that page
                // silently erased the nearest market the seller had entered and
                // showed the box empty the next time they opened it.
                nearestMarket: validatedData.location.nearestMarket,
            },
            deliveryMethod: validatedData.deliveryMethod,
            estimatedDeliveryDays: validatedData.estimatedDeliveryDays,
            bulkAvailable: validatedData.bulkAvailable || false,
            exportReady: validatedData.exportReady || false,
            // Collected from the form, validated by ProductSchema — and then
            // dropped. This object never mentioned `certifications`, so a
            // seller's certifications were parsed and discarded, while
            // marketplace/products/[id] has a whole section that renders them
            // and /api/marketplace/create-product writes them.
            certifications: validatedData.certifications ?? certifications ?? [],
            // ONE answer for both creators, from lib/product-status.ts.
            //
            // This wrote "pending" while /api/marketplace/create-product wrote
            // "active" and ProductSchema defaults to "draft". Every buyer-facing
            // reader filters on "active" alone, and nothing anywhere released a
            // pending product — so this action, reached from six links, produced
            // listings no buyer could see and no admin could publish.
            status: PRODUCT_INITIAL_STATUS,
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
 * Update existing product listing
 */
async function _updateProductAction(prevState: unknown, formData: FormData): Promise<ActionResponse<{ productId: string }>> { 
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized", data: null };
        const { session } = sessionResult;
        const userId = session.user.id;

        const productId = formData.get("productId") as string;
        if (!productId) {
            return { success: false as const, error: "Product ID is required", data: null };
        }

        // Check if user is an approved seller
        const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
        const userDoc = await userRef.get();
        const userData = userDoc.data();

        if (!hasRole(userData?.roles || [], "seller")) { 
            return { success: false as const, error: "You must have seller role to update products", data: null };
        }

        if (userData?.sellerVerificationStatus !== "approved") { 
            return { success: false as const, error: "Your seller account must be approved first", data: null };
        }

        // Fetch product and verify ownership
        const productRef = db.collection(COLLECTIONS.PRODUCTS).doc(productId);
        const productDoc = await productRef.get();
        if (!productDoc.exists) {
            return { success: false as const, error: "Product not found", data: null };
        }

        const productData = productDoc.data();
        if (productData?.sellerId !== userId) {
            return { success: false as const, error: "You are not authorized to edit this product", data: null };
        }

        // Extract and Prepare Data for Validation
        let certifications = [];
        try { 
            certifications = JSON.parse(formData.get("certifications") as string || "[]");
        } catch (e) { 
            logger.warn("Failed to parse certifications JSON, using defaults", { userId }); 
        }

        const retailPrice = parseCurrencyStringToFloat(formData.get("retailPrice") as string || "0");
        const bulkPrice = formData.get("bulkPrice") ? parseCurrencyStringToFloat(formData.get("bulkPrice") as string) : undefined;
        const exportPrice = formData.get("exportPrice") ? parseCurrencyStringToFloat(formData.get("exportPrice") as string) : undefined;
        const bulkAvailable = formData.get("bulkAvailable") === "true";
        const exportReady = formData.get("exportReady") === "true";
        const bulkMinQuantity = formData.get("bulkMinQuantity") ? parseInt(formData.get("bulkMinQuantity") as string) : undefined;
        const exportMinQuantity = formData.get("exportMinQuantity") ? parseInt(formData.get("exportMinQuantity") as string) : undefined;

        const pricingTiers: any[] = [];
        pricingTiers.push({ type: "retail", price: retailPrice, minQuantity: 1 });

        if (bulkPrice && bulkAvailable) { 
            pricingTiers.push({
                type: "bulk",
                price: bulkPrice,
                minQuantity: bulkMinQuantity || 50
            });
        }

        if (exportPrice && exportReady) { 
            pricingTiers.push({
                type: "export",
                price: exportPrice,
                minQuantity: exportMinQuantity || 100
            });
        }

        const createdAtDate = productData?.createdAt ? (productData.createdAt as Timestamp).toDate() : new Date();

        const rawData = { 
            id: productId,
            sellerId: userId,
            createdAt: createdAtDate,
            updatedAt: new Date(),
            title: formData.get("title") || undefined,
            description: formData.get("description") || undefined,
            category: formData.get("category") || undefined,
            pricingTiers,
            availableQuantity: parseInt(formData.get("availableQuantity") as string || "0"),
            minimumOrderQuantity: parseInt(formData.get("minimumOrderQuantity") as string || "1"),
            unit: formData.get("unit") || undefined,
            location: {
                state: formData.get("state") as string || "Lagos",
                lga: formData.get("lga") as string || "Unknown",
                nearestMarket: formData.get("nearestMarket") as string || "Unknown",
            },
            deliveryMethod: formData.get("deliveryMethod") || undefined,
            estimatedDeliveryDays: formData.get("estimatedDeliveryDays") ? parseInt(formData.get("estimatedDeliveryDays") as string) : undefined,
            certifications,
            bulkAvailable,
            exportReady,
            videoUrl: formData.get("videoUrl") || "" 
        };

        // Validate with Zod
        const validation = ProductSchema.safeParse(rawData);
        if (!validation.success) { 
            logger.error("Product update validation failed:", validation.error.format());
            return { success: false as const, error: validation.error.issues[0]?.path.join(".") + ": " + validation.error.issues[0]?.message || "Validation failed", data: null };
        }

        const validatedData = validation.data;

        // Image uploads
        const uploadFile = async (file: File) => {
            const extension = file.name.split(".").pop();
            const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${extension}`;
            const destination = `products/${userId}/${productId}/${fileName}`;
            const { uploadFileToStorage } = await import("@/lib/storage-admin");
            return await uploadFileToStorage(file, destination);
        };

        const imageUrls: string[] = [];
        // Whether the form carried image fields AT ALL, as distinct from
        // carrying none. See the note on the write below.
        let formCarriedImages = false;
        for (const key of Array.from(formData.keys())) { 
            if (key.startsWith("productImages_") || key.startsWith("image")) {
                formCarriedImages = true;
                const val = formData.get(key);
                if (val) {
                    if (typeof val === "string" && val.startsWith("http")) {
                        imageUrls.push(val);
                    } else if (val instanceof File && val.size > 0) {
                        const url = await uploadFile(val);
                        imageUrls.push(url);
                    }
                }
            }
        }

        // Update product
        const updatedProduct: any = { 
            title: validatedData.title,
            description: validatedData.description,
            category: validatedData.category,
            // KEPT when the form did not carry any.
            //
            // This wrote `imageUrls` unconditionally, and that list is built by
            // scanning the form for productImages_*/image* keys. A caller that
            // sends none — this is a "use server" export, so that is any caller
            // — therefore had every photo removed from the listing by an edit
            // that never mentioned images. The seller edit page does re-send
            // the existing URLs, so this half was latent; the certifications
            // below were not.
            images: formCarriedImages ? imageUrls : (productData?.images ?? []),
            videoUrl: (validatedData.videoUrl as string) || undefined,
            pricingTiers: validatedData.pricingTiers,
            availableQuantity: validatedData.availableQuantity,
            minimumOrderQuantity: validatedData.minimumOrderQuantity,
            unit: validatedData.unit,
            location: {
                state: validatedData.location.state,
                lga: validatedData.location.lga,
                // Collected by both forms, validated into `validatedData`, and
                // then dropped — the same shape as the certifications defect,
                // one field over in the same object. /api/marketplace/create-product
                // writes it, and the seller edit page reads it back into its own
                // field and re-sends it, so an edit made through that page
                // silently erased the nearest market the seller had entered and
                // showed the box empty the next time they opened it.
                nearestMarket: validatedData.location.nearestMarket,
            },
            deliveryMethod: validatedData.deliveryMethod,
            estimatedDeliveryDays: validatedData.estimatedDeliveryDays,
            bulkAvailable: validatedData.bulkAvailable || false,
            exportReady: validatedData.exportReady || false,
            // KEPT when the form did not carry them, which is EVERY EDIT.
            //
            // certifications was originally dropped from both writes; restoring
            // it to the update introduced a second fault, because the value
            // being restored is `JSON.parse(formData.get("certifications") ??
            // "[]")` and the seller edit page
            // (/marketplace/seller/products/[id]/edit) never appends that
            // field. So every edit wrote an empty array over whatever the
            // create path had saved, and the certifications section on
            // /marketplace/products/[id] went blank. On an agricultural export
            // marketplace those badges are the product's selling point.
            //
            // ProductSchema defaults the field to [], so validatedData cannot
            // distinguish "sent empty" from "not sent" — the FORM is asked
            // instead.
            certifications: formData.has("certifications")
                ? (validatedData.certifications ?? certifications ?? [])
                : (productData?.certifications ?? []),
            updatedAt: FieldValue.serverTimestamp()
        };

        // `status` is deliberately NOT in this patch. An edit must not change
        // whether a listing is published — that is reviewProductAction's job,
        // and an admin who suspended a product would otherwise see the seller
        // republish it by saving the edit form.
        await productRef.update(updatedProduct);

        return { error: null, success: true as const, data: { productId } };
    } catch (error) { 
        logger.error("Update product error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to update product", data: null };
    }
}

export const updateProductAction = withSafeAction("updateProductAction", _updateProductAction);


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

        /**
         *   #301 THIS DESTROYED THE ROW THAT EVERY ORDER POINTS AT.
         *
         *        `await productRef.delete()`. Orders store productIds, and this
         *        adapter does not raise on a dangling reference — `update()` on
         *        a missing document is a documented silent no-op.
         *
         *        The sharp end is order-management.ts, which returns stock to
         *        PRODUCTS.doc(item.productId) when an order is cancelled or
         *        refunded. Delete the product first and that write does nothing,
         *        raises nothing, and the cancellation reports success.
         *
         *        Retired instead. Every buyer-facing query already filters
         *        status == "active", so the listing leaves the catalogue on the
         *        status change alone; the seller's own list filters on
         *        `retired` because it queries by sellerId and nothing else.
         */
        await productRef.update({
            status: "archived",
            ...retirementPatch(userId, productData?.status),
            updatedAt: new Date().toISOString(),
        });
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
