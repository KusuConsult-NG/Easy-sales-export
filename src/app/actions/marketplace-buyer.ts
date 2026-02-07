/**
 * Marketplace Server Actions - Buyer Side
 * 
 * Actions for product browsing, cart, and orders
 */

"use server";

import { db } from "@/lib/firebase";
import {
    collection,
    getDocs,
    query,
    where,
    orderBy,
    limit,
    getDoc,
    doc
} from "firebase/firestore";
import { COLLECTIONS } from "@/lib/types/firestore";
import type { Product } from "@/lib/types/marketplace";

// ============================================================================
// PRODUCT BROWSING
// ============================================================================

export interface ProductFilters {
    category?: string;
    minPrice?: number;
    maxPrice?: number;
    state?: string;
    lga?: string;
    bulkAvailable?: boolean;
    exportReady?: boolean;
    searchTerm?: string;
}

export async function getProductsAction(filters?: ProductFilters) {
    try {
        let productsQuery = query(
            collection(db, COLLECTIONS.PRODUCTS),
            where("status", "==", "active")
        );

        // Apply filters
        if (filters?.category) {
            productsQuery = query(productsQuery, where("category", "==", filters.category));
        }

        if (filters?.state) {
            productsQuery = query(productsQuery, where("location.state", "==", filters.state));
        }

        if (filters?.bulkAvailable) {
            productsQuery = query(productsQuery, where("bulkAvailable", "==", true));
        }

        if (filters?.exportReady) {
            productsQuery = query(productsQuery, where("exportReady", "==", true));
        }

        const snapshot = await getDocs(productsQuery);
        let products = snapshot.docs.map(doc => doc.data() as Product);

        // Client-side filters (Firestore limitations)
        if (filters?.minPrice !== undefined || filters?.maxPrice !== undefined) {
            products = products.filter(product => {
                const price = product.pricingTiers[0]?.price || 0;
                const meetsMin = filters.minPrice === undefined || price >= filters.minPrice;
                const meetsMax = filters.maxPrice === undefined || price <= filters.maxPrice;
                return meetsMin && meetsMax;
            });
        }

        if (filters?.searchTerm) {
            const term = filters.searchTerm.toLowerCase();
            products = products.filter(product =>
                product.title.toLowerCase().includes(term) ||
                product.description.toLowerCase().includes(term)
            );
        }

        if (filters?.lga) {
            products = products.filter(product => product.location.lga === filters.lga);
        }

        return { success: true, products };
    } catch (error: any) {
        console.error("Get products error:", error);
        return { success: false, error: error.message, products: [] };
    }
}

/**
 * Get single product by ID
 */
export async function getProductByIdAction(productId: string) {
    try {
        const productDoc = await getDoc(doc(db, COLLECTIONS.PRODUCTS, productId));

        if (!productDoc.exists()) {
            return { success: false, error: "Product not found" };
        }

        const product = productDoc.data() as Product;

        return { success: true, product };
    } catch (error: any) {
        console.error("Get product error:", error);
        return { success: false, error: error.message };
    }
}

/**
 * Get featured products
 */
export async function getFeaturedProductsAction() {
    try {
        const productsQuery = query(
            collection(db, COLLECTIONS.PRODUCTS),
            where("status", "==", "active"),
            orderBy("orders", "desc"),
            limit(8)
        );

        const snapshot = await getDocs(productsQuery);
        const products = snapshot.docs.map(doc => doc.data() as Product);

        return { success: true, products };
    } catch (error: any) {
        console.error("Get featured products error:", error);
        return { success: false, error: error.message, products: [] };
    }
}

/**
 * Get products by category
 */
export async function getProductsByCategoryAction(category: string) {
    try {
        const productsQuery = query(
            collection(db, COLLECTIONS.PRODUCTS),
            where("status", "==", "active"),
            where("category", "==", category)
        );

        const snapshot = await getDocs(productsQuery);
        const products = snapshot.docs.map(doc => doc.data() as Product);

        return { success: true, products };
    } catch (error: any) {
        console.error("Get products by category error:", error);
        return { success: false, error: error.message, products: [] };
    }
}
