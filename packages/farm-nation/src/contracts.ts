import type { Property, PropertyListingInput, FarmNationOnboardingData, FarmNationDashboardStats } from "./types";

export interface PropertyPurchasePayload {
    propertyId: string;
    buyerInfo: {
        fullName: string;
        email: string;
        phone: string;
        purpose: string;
    };
}

export interface FarmNationServiceContract {
    getProperties(filters?: {
        state?: string;
        category?: string;
        type?: string;
        minPrice?: number;
        maxPrice?: number;
        minSize?: number;
        maxSize?: number;
        search?: string;
        limit?: number;
        lastDocId?: string;
    }): Promise<{ properties: Property[]; cursor: string | null; hasMore: boolean }>;
    
    getPropertyById(id: string): Promise<Property>;
    
    listProperty(input: PropertyListingInput, ownerId: string): Promise<{ propertyId: string }>;
    
    updateProperty(propertyId: string, updates: Partial<PropertyListingInput>, ownerId: string): Promise<void>;
    
    deleteProperty(propertyId: string, ownerId: string): Promise<void>;
    
    submitOnboarding(data: FarmNationOnboardingData, userId: string): Promise<void>;
    
    getOnboardingApplication(userId: string): Promise<any>;
    
    resubmitOnboarding(data: FarmNationOnboardingData, userId: string): Promise<void>;
    
    approveSeller(userId: string, adminId: string): Promise<void>;
    
    rejectSeller(userId: string, reason: string, adminId: string): Promise<void>;
    
    verifyProperty(propertyId: string, verified: boolean, adminId: string): Promise<void>;
    
    initiatePurchase(payload: PropertyPurchasePayload, buyerId: string): Promise<void>;
    
    getMyPurchaseRequests(buyerId: string): Promise<any[]>;
    
    cancelPurchaseRequest(requestId: string, buyerId: string): Promise<void>;
    
    getDashboardStats(userId: string): Promise<FarmNationDashboardStats>;
}
