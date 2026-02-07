"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase";
import {
    collection,
    doc,
    getDoc,
    getDocs,
    addDoc,
    updateDoc,
    query,
    where,
    orderBy,
    Timestamp,
    serverTimestamp,
} from "firebase/firestore";
import { COLLECTIONS } from "@/lib/types/firestore";

/**
 * Farm Nation Property Management Actions
 */

export interface Property {
    id: string;
    name: string;
    description: string;
    location: string;
    state: string;
    lga: string;
    price: number;
    size: number; // hectares
    type: "sale" | "lease";
    category: "arable" | "irrigated" | "commercial" | "mixed" | "pastoral";
    images: string[];
    ownerId: string;
    ownerName: string;
    ownerEmail: string;
    ownerPhone: string;
    status: "available" | "pending" | "sold" | "leased";
    verified: boolean;
    features: string[];
    coordinates?: {
        latitude: number;
        longitude: number;
    };
    documents: {
        cOfO?: string; //  Certificate of Occupancy
        surveyPlan?: string;
        taxClearance?: string;
    };
    createdAt: Date;
    updatedAt: Date;
    leaseDuration?: number; // months, if type is lease
    viewCount: number;
    favoriteCount: number;
}

export interface PropertyListingInput {
    name: string;
    description: string;
    location: string;
    state: string;
    lga: string;
    price: number;
    size: number;
    type: "sale" | "lease";
    category: string;
    features: string[];
    leaseDuration?: number;
}

/**
 * Get all properties with optional filters
 */
export async function getPropertiesAction(filters?: {
    state?: string;
    category?: string;
    type?: string;
    minPrice?: number;
    maxPrice?: number;
    minSize?: number;
    maxSize?: number;
}) {
    try {
        const propertiesRef = collection(db, COLLECTIONS.FARM_NATION_PROPERTIES);
        let q = query(propertiesRef, where("status", "in", ["available", "pending"]), orderBy("createdAt", "desc"));

        const snapshot = await getDocs(q);
        let properties = snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
            createdAt: doc.data().createdAt?.toDate(),
            updatedAt: doc.data().updatedAt?.toDate(),
        })) as Property[];

        // Client-side filtering (Firestore has query limitations)
        if (filters) {
            if (filters.state && filters.state !== "all") {
                properties = properties.filter((p) => p.state === filters.state);
            }
            if (filters.category && filters.category !== "all") {
                properties = properties.filter((p) => p.category === filters.category);
            }
            if (filters.type && filters.type !== "all") {
                properties = properties.filter((p) => p.type === filters.type);
            }
            if (filters.minPrice) {
                properties = properties.filter((p) => p.price >= filters.minPrice!);
            }
            if (filters.maxPrice) {
                properties = properties.filter((p) => p.price <= filters.maxPrice!);
            }
            if (filters.minSize) {
                properties = properties.filter((p) => p.size >= filters.minSize!);
            }
            if (filters.maxSize) {
                properties = properties.filter((p) => p.size <= filters.maxSize!);
            }
        }

        return { success: true, properties };
    } catch (error: any) {
        console.error("Get properties error:", error);
        return { success: false, error: error.message };
    }
}

/**
 * Get property by ID
 */
export async function getPropertyByIdAction(propertyId: string) {
    try {
        const propertyRef = doc(db, COLLECTIONS.FARM_NATION_PROPERTIES, propertyId);
        const propertyDoc = await getDoc(propertyRef);

        if (!propertyDoc.exists()) {
            return { success: false, error: "Property not found" };
        }

        // Increment view count
        await updateDoc(propertyRef, {
            viewCount: (propertyDoc.data().viewCount || 0) + 1,
        });

        const property = {
            id: propertyDoc.id,
            ...propertyDoc.data(),
            createdAt: propertyDoc.data().createdAt?.toDate(),
            updatedAt: propertyDoc.data().updatedAt?.toDate(),
        } as Property;

        return { success: true, property };
    } catch (error: any) {
        console.error("Get property error:", error);
        return { success: false, error: error.message };
    }
}

/**
 * List a new property
 */
export async function listPropertyAction(input: PropertyListingInput) {
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return { success: false, error: "Unauthorized" };
        }

        // Check user tier (Premium required)
        const userRef = doc(db, COLLECTIONS.USERS, session.user.id);
        const userDoc = await getDoc(userRef);

        if (!userDoc.exists()) {
            return { success: false, error: "User not found" };
        }

        const userData = userDoc.data();
        if (!userData.cooperativeTier || userData.cooperativeTier === "Basic") {
            return {
                success: false,
                error: "Premium tier required to list properties. Contribute at least ₦20,000.",
            };
        }

        // Create property
        const property = {
            name: input.name,
            description: input.description,
            location: input.location,
            state: input.state.toLowerCase(),
            lga: input.lga,
            price: input.price,
            size: input.size,
            type: input.type,
            category: input.category,
            features: input.features,
            leaseDuration: input.leaseDuration || null,
            images: [], // Will be uploaded separately
            ownerId: session.user.id,
            ownerName: userData.name || "Unknown",
            ownerEmail: userData.email || "",
            ownerPhone: userData.phone || "",
            status: "available",
            verified: false, // Requires admin verification
            documents: {},
            viewCount: 0,
            favoriteCount: 0,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
        };

        const docRef = await addDoc(collection(db, COLLECTIONS.FARM_NATION_PROPERTIES), property);

        return {
            success: true,
            message: "Property listed successfully. Awaiting admin verification.",
            propertyId: docRef.id,
        };
    } catch (error: any) {
        console.error("List property error:", error);
        return { success: false, error: error.message };
    }
}

/**
 * Get user's listed properties
 */
export async function getMyPropertiesAction() {
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return { success: false, error: "Unauthorized" };
        }

        const propertiesRef = collection(db, COLLECTIONS.FARM_NATION_PROPERTIES);
        const q = query(
            propertiesRef,
            where("ownerId", "==", session.user.id),
            orderBy("createdAt", "desc")
        );

        const snapshot = await getDocs(q);
        const properties = snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
            createdAt: doc.data().createdAt?.toDate(),
            updatedAt: doc.data().updatedAt?.toDate(),
        })) as Property[];

        return { success: true, properties };
    } catch (error: any) {
        console.error("Get my properties error:", error);
        return { success: false, error: error.message };
    }
}

/**
 * Initiate property purchase/lease
 */
export async function initiatePropertyPurchaseAction(
    propertyId: string,
    buyerInfo: {
        fullName: string;
        email: string;
        phone: string;
        purpose: string;
    }
) {
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return { success: false, error: "Unauthorized" };
        }

        // Verify property exists and is available
        const propertyRef = doc(db, COLLECTIONS.FARM_NATION_PROPERTIES, propertyId);
        const propertyDoc = await getDoc(propertyRef);

        if (!propertyDoc.exists()) {
            return { success: false, error: "Property not found" };
        }

        const property = propertyDoc.data() as Property;
        if (property.status !== "available") {
            return { success: false, error: "Property is no longer available" };
        }

        // Check user tier
        const userRef = doc(db, COLLECTIONS.USERS, session.user.id);
        const userDoc = await getDoc(userRef);

        if (!userDoc.exists()) {
            return { success: false, error: "User not found" };
        }

        const userData = userDoc.data();
        if (!userData.cooperativeTier || userData.cooperativeTier === "Basic") {
            return {
                success: false,
                error: "Premium tier required. Contribute at least ₦20,000.",
            };
        }

        // Create purchase request
        const purchaseRequest = {
            propertyId,
            propertyName: property.name,
            propertyPrice: property.price,
            propertyType: property.type,
            buyerId: session.user.id,
            buyerName: buyerInfo.fullName,
            buyerEmail: buyerInfo.email,
            buyerPhone: buyerInfo.phone,
            purpose: buyerInfo.purpose,
            sellerId: property.ownerId,
            sellerName: property.ownerName,
            status: "pending_payment",
            escrowAmount: property.price,
            escrowStatus: "pending",
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
        };

        const requestRef = await addDoc(
            collection(db, COLLECTIONS.FARM_NATION_TRANSACTIONS),
            purchaseRequest
        );

        // Mark property as pending
        await updateDoc(propertyRef, {
            status: "pending",
            updatedAt: serverTimestamp(),
        });

        return {
            success: true,
            message: "Purchase request created. Proceed to payment.",
            requestId: requestRef.id,
            amount: property.price,
        };
    } catch (error: any) {
        console.error("Initiate purchase error:", error);
        return { success: false, error: error.message };
    }
}

/**
 * Get user's purchase/lease requests
 */
export async function getMyPurchaseRequestsAction() {
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return { success: false, error: "Unauthorized" };
        }

        const requestsRef = collection(db, COLLECTIONS.FARM_NATION_TRANSACTIONS);
        const q = query(
            requestsRef,
            where("buyerId", "==", session.user.id),
            orderBy("createdAt", "desc")
        );

        const snapshot = await getDocs(q);
        const requests = snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
            createdAt: doc.data().createdAt?.toDate(),
            updatedAt: doc.data().updatedAt?.toDate(),
        }));

        return { success: true, requests };
    } catch (error: any) {
        console.error("Get purchase requests error:", error);
        return { success: false, error: error.message };
    }
}
