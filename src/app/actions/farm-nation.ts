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
    category: "farming-arable" | "farming-irrigated" | "farming-commercial" | "farming-mixed" | "leasing" | "poultry" | "fishery" | "greenhouse" | "mixed-use";
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
        const q = query(propertiesRef, where("status", "in", ["available", "pending"]), orderBy("createdAt", "desc"));

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
            // Fallback to mock data for development
            const mockProperty = getMockProperties().find(p => p.id === propertyId);
            if (mockProperty) {
                return { success: true, property: mockProperty };
            }
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
        // Fallback to mock data on error
        const mockProperty = getMockProperties().find(p => p.id === propertyId);
        if (mockProperty) {
            return { success: true, property: mockProperty };
        }
        return { success: false, error: error.message };
    }
}

// Mock properties for development
function getMockProperties(): Property[] {
    return [
        {
            id: "1",
            name: "Prime Farmland in Kaduna",
            location: "Zaria",
            state: "kaduna",
            lga: "Zaria",
            price: 5000000,
            size: 10,
            type: "sale",
            category: "farming-arable",
            images: ["/images/logo.jpg"],
            description: "Fertile land suitable for cassava, yam, and maize cultivation. The soil is rich in nutrients and perfect for high-yield farming. Located in a secure area with easy access to markets and transportation.",
            ownerId: "mock-owner-1",
            ownerName: "Musa Ibrahim",
            ownerEmail: "musa.ibrahim@example.com",
            ownerPhone: "+234 803 123 4567",
            status: "available",
            verified: true,
            features: ["Fertile Soil", "Water Access", "Road Access", "Security", "Good Drainage"],
            documents: {},
            createdAt: new Date(),
            updatedAt: new Date(),
            viewCount: 45,
            favoriteCount: 12,
        },
        {
            id: "2",
            name: "Riverside Farm Plot",
            location: "Makurdi",
            state: "benue",
            lga: "Makurdi",
            price: 3500000,
            size: 5,
            type: "sale",
            category: "farming-irrigated",
            images: ["/images/logo.jpg"],
            description: "Access to water, perfect for rice farming. Located near the Benue River with natural irrigation possibilities. The land has been surveyed and all documents are in order.",
            ownerId: "mock-owner-2",
            ownerName: "Esther Ade",
            ownerEmail: "esther.ade@example.com",
            ownerPhone: "+234 805 234 5678",
            status: "available",
            verified: true,
            features: ["River Access", "Irrigation Ready", "Surveyed Land", "Title Documents", "Flat Terrain"],
            documents: {},
            createdAt: new Date(),
            updatedAt: new Date(),
            viewCount: 32,
            favoriteCount: 8,
        },
        {
            id: "3",
            name: "Large Scale farmland",
            location: "Plateau State",
            state: "plateau",
            lga: "Jos North",
            price: 12000000,
            size: 25,
            type: "sale",
            category: "farming-commercial",
            images: ["/images/logo.jpg"],
            description: "Ideal for large-scale agricultural projects. The land spans 25 hectares with excellent soil composition and climate for various crops. Perfect for commercial farming operations.",
            ownerId: "mock-owner-3",
            ownerName: "Chinedu Okafor",
            ownerEmail: "chinedu.okafor@example.com",
            ownerPhone: "+234 807 345 6789",
            status: "available",
            verified: false,
            features: ["Large Expanse", "Fertile Soil", "Good Climate", "Road Access", "Electricity Available"],
            documents: {},
            createdAt: new Date(),
            updatedAt: new Date(),
            viewCount: 67,
            favoriteCount: 23,
        },
        {
            id: "4",
            name: "Farmland for Lease",
            location: "Kano",
            state: "kano",
            lga: "Kano Municipal",
            price: 500000,
            size: 3,
            type: "lease",
            category: "leasing",
            images: ["/images/logo.jpg"],
            description: "1-year lease, ready for immediate farming. Perfect for small-scale farmers looking to start their agricultural journey without heavy capital investment.",
            ownerId: "mock-owner-4",
            ownerName: "Aisha Mohammed",
            ownerEmail: "aisha.mohammed@example.com",
            ownerPhone: "+234 809 456 7890",
            status: "available",
            verified: true,
            features: ["Immediate Availability", "Flexible Terms", "Water Access", "Security"],
            documents: {},
            createdAt: new Date(),
            updatedAt: new Date(),
            leaseDuration: 12,
            viewCount: 28,
            favoriteCount: 5,
        },
        {
            id: "5",
            name: "Irrigated Farmland",
            location: "Sokoto",
            state: "sokoto",
            lga: "Sokoto South",
            price: 800000,
            size: 8,
            type: "lease",
            category: "leasing",
            images: ["/images/logo.jpg"],
            description: "2-year lease with irrigation system. The property comes with a functional irrigation setup, making it ideal for year-round farming.",
            ownerId: "mock-owner-5",
            ownerName: "Aminu Yusuf",
            ownerEmail: "aminu.yusuf@example.com",
            ownerPhone: "+234 810 567 8901",
            status: "available",
            verified: true,
            features: ["Irrigation System", "Long Lease", "Water Assured", "Good Soil"],
            documents: {},
            createdAt: new Date(),
            updatedAt: new Date(),
            leaseDuration: 24,
            viewCount: 41,
            favoriteCount: 15,
        },
        {
            id: "6",
            name: "Mixed-Use Agricultural Land",
            location: "Enugu",
            state: "enugu",
            lga: "Enugu North",
            price: 8000000,
            size: 15,
            type: "sale",
            category: "mixed-use",
            images: ["/images/logo.jpg"],
            description: "Strategic location, suitable for mixed farming. The land is versatile and can support multiple agricultural activities including crop cultivation and livestock rearing.",
            ownerId: "mock-owner-6",
            ownerName: "Ngozi Okeke",
            ownerEmail: "ngozi.okeke@example.com",
            ownerPhone: "+234 812 678 9012",
            status: "available",
            verified: true,
            features: ["Versatile Land", "Strategic Location", "Multiple Use", "Good Access", "Title Documents"],
            documents: {},
            createdAt: new Date(),
            updatedAt: new Date(),
            viewCount: 53,
            favoriteCount: 19,
        },
    ];
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
