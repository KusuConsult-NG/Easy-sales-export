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

        // Fallback to mock data if Firebase is empty
        if (products.length === 0) {
            products = getMockProducts();
        }

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

        if (filters?.category && filters.category !== "all") {
            products = products.filter(product => product.category === filters.category);
        }

        return { success: true, products };
    } catch (error: any) {
        console.error("Get products error:", error);
        // Fallback to mock data on error
        const products = getMockProducts();
        return { success: true, products };
    }
}

// Mock products for development
function getMockProducts(): Product[] {
    const baseDate = new Date();
    return [
        {
            id: "1",
            sellerId: "mock-seller-1",
            title: "Premium Cashew Nuts",
            description: "High-quality cashew nuts from Kogi state. Freshly harvested and processed with strict quality control. Perfect for export or local distribution.",
            category: "grains",
            images: ["/images/logo.jpg"],
            status: "active",
            pricingTiers: [
                { type: "retail", minQuantity: 10, price: 8500 },
                { type: "bulk", minQuantity: 100, price: 8000 },
                { type: "export", minQuantity: 1000, price: 7500 },
            ],
            availableQuantity: 500,
            minimumOrderQuantity: 10,
            unit: "kg",
            bulkAvailable: true,
            exportReady: true,
            certifications: ["Organic", "NAFDAC"],
            location: {
                state: "Kogi",
                lga: "Lokoja",
            },
            deliveryMethod: "both",
            estimatedDeliveryDays: 3,
            views: 245,
            orders: 127,
            rating: 4.8,
            reviewCount: 45,
            createdAt: baseDate,
            updatedAt: baseDate,
        },
        {
            id: "2",
            sellerId: "mock-seller-2",
            title: "Organic Shea Butter",
            description: "Pure unrefined shea butter from Northern Nigeria. Perfect for cosmetics and skincare products. Rich, creamy texture.",
            category: "processed",
            images: ["/images/logo.jpg"],
            status: "active",
            pricingTiers: [
                { type: "retail", minQuantity: 5, price: 12000 },
                { type: "bulk", minQuantity: 50, price: 11500 },
                { type: "export", minQuantity: 500, price: 11000 },
            ],
            availableQuantity: 200,
            minimumOrderQuantity: 5,
            unit: "kg",
            bulkAvailable: true,
            exportReady: true,
            certifications: ["Organic", "Fair Trade"],
            location: {
                state: "Kaduna",
                lga: "Kaduna North",
            },
            deliveryMethod: "both",
            estimatedDeliveryDays: 5,
            views: 189,
            orders: 89,
            rating: 4.9,
            reviewCount: 67,
            createdAt: baseDate,
            updatedAt: baseDate,
        },
        {
            id: "3",
            sellerId: "mock-seller-3",
            title: "Dried Hibiscus Flowers",
            description: "Premium quality dried hibiscus flowers. Rich in antioxidants and perfect for beverages and herbal teas.",
            category: "processed",
            images: ["/images/logo.jpg"],
            status: "active",
            pricingTiers: [
                { type: "retail", minQuantity: 25, price: 3500 },
                { type: "bulk", minQuantity: 100, price: 3200 },
                { type: "export", minQuantity: 500, price: 3000 },
            ],
            availableQuantity: 1000,
            minimumOrderQuantity: 25,
            unit: "kg",
            bulkAvailable: true,
            exportReady: true,
            certifications: ["NAFDAC", "Organic"],
            location: {
                state: "Kano",
                lga: "Kano Municipal",
            },
            deliveryMethod: "both",
            estimatedDeliveryDays: 4,
            views: 356,
            orders: 156,
            rating: 4.7,
            reviewCount: 92,
            createdAt: baseDate,
            updatedAt: baseDate,
        },
        {
            id: "4",
            sellerId: "mock-seller-4",
            title: "Fresh Ginger Roots",
            description: "Fresh ginger roots harvested this season. High oil content and strong aroma. Perfect for export markets.",
            category: "vegetables",
            images: ["/images/logo.jpg"],
            status: "active",
            pricingTiers: [
                { type: "retail", minQuantity: 50, price: 4200 },
                { type: "bulk", minQuantity: 200, price: 4000 },
                { type: "export", minQuantity: 1000, price: 3800 },
            ],
            availableQuantity: 800,
            minimumOrderQuantity: 50,
            unit: "kg",
            bulkAvailable: true,
            exportReady: true,
            certifications: ["Export Grade"],
            location: {
                state: "Plateau",
                lga: "Jos North",
            },
            deliveryMethod: "both",
            estimatedDeliveryDays: 2,
            views: 195,
            orders: 95,
            rating: 4.6,
            reviewCount: 56,
            createdAt: baseDate,
            updatedAt: baseDate,
        },
        {
            id: "5",
            sellerId: "mock-seller-5",
            title: "Raw Honey",
            description: "Pure natural honey from Oyo state. No additives or preservatives. Rich golden color with natural sweetness.",
            category: "processed",
            images: ["/images/logo.jpg"],
            status: "active",
            pricingTiers: [
                { type: "retail", minQuantity: 10, price: 6500 },
                { type: "bulk", minQuantity: 50, price: 6200 },
                { type: "export", minQuantity: 200, price: 6000 },
            ],
            availableQuantity: 150,
            minimumOrderQuantity: 10,
            unit: "liter",
            bulkAvailable: true,
            exportReady: false,
            certifications: ["NAFDAC"],
            location: {
                state: "Oyo",
                lga: "Ibadan North",
            },
            deliveryMethod: "both",
            estimatedDeliveryDays: 3,
            views: 403,
            orders: 203,
            rating: 4.9,
            reviewCount: 134,
            createdAt: baseDate,
            updatedAt: baseDate,
        },
    ];
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
