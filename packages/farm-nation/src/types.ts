export enum SoilQuality {
    FERTILE = 'fertile',
    SANDY = 'sandy',
    LOAMY = 'loamy',
    CLAY = 'clay',
    MIXED = 'mixed',
    UNKNOWN = 'unknown',
    EXCELLENT = 'excellent',
    GOOD = 'good',
    FAIR = 'fair',
    POOR = 'poor'
}

export interface LandListing {
    id: string;
    title: string;
    description: string;
    price: number;
    size: number; // in acres
    location: {
        address: string;
        city: string;
        state: string;
        lat: number;
        lng: number;
        geopoint?: any;
    };
    soilQuality: SoilQuality;
    waterAccess: boolean;
    electricityAccess: boolean;
    roadAccess: boolean;
    ownerId: string;
    status: 'pending_verification' | 'verified' | 'rejected' | 'deleted';
    createdAt: Date;
    updatedAt: Date;
    verifiedAt: Date | null;
    verifiedBy: string | null;
    rejectionReason: string | null;
    images: string[];
    documents?: string[];
}

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
        cOfO?: string; // Certificate of Occupancy
        surveyPlan?: string;
        taxClearance?: string;
    };
    createdAt: any;
    updatedAt: any;
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

export interface FarmNationOnboardingData {
    role: "buyer" | "seller" | "both";
    profile: {
        firstName: string;
        lastName: string;
        otherName?: string;
        phone: string;
        businessName?: string;
        state: string;
        lga: string;
        address: string;
    };
    interests: {
        // Buyer fields
        propertyTypes?: string[];
        budgetRange?: string;
        preferredSize?: string;
        // Seller fields
        listingTypes?: string[];
        totalAcreage?: string;
        readyToList?: boolean;
    };
    terms: {
        termsAccepted: boolean;
        privacyAccepted: boolean;
        feeDisclosureAccepted: boolean;
    };
}

export interface FarmNationDashboardStats {
    totalHectares: number;
    activeListings: number;
    completedDeals: number;
    portfolioValue: number;
    pendingTransactions: number;
    propertiesAcquired: number;
    totalInvestmentValue: number;
    recentTransactions: Array<{
        id: string;
        propertyName: string;
        propertyType: string;
        amount: number;
        status: string;
        createdAt: Date;
    }>;
    recentListings: Array<{
        id: string;
        name: string;
        location: string;
        state: string;
        size: number;
        price: number;
        status: string;
        verified: boolean;
        type: string;
        createdAt: Date;
    }>;
    role: string;
}
