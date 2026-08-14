/**
 * Farm Nation types as the SERVER ACTIONS use them.
 *
 * Declared inside actions/farm-nation.ts and referred to across it, so
 * splitting that 1,735-line file by domain would have left them in whichever
 * piece happened to keep them.
 *
 * WHY NOT packages/farm-nation/src/types.ts
 * -----------------------------------------
 * Because `Property` is declared there too, and the two disagree about what a
 * property can be:
 *
 *     packages/farm-nation   type: "sale" | "lease"
 *     here (from actions)    type: "sale" | "rent" | "lease"
 *
 * A listing stored as "rent" is valid to every writer in actions/farm-nation
 * and invalid to anything typed against the package. Which of the two is right
 * is a product question — whether renting farmland is an offer this platform
 * makes — and not one to settle while moving code.
 *
 * Third instance of this pattern, after academy (#205) and WAVE (#206): a
 * caller-facing type and a database-facing type under one name. Recorded so it
 * is visible rather than discovered again.
 *
 * A plain module, not one under src/app/actions, where every file must carry
 * "use server" and a session guard.
 */

import type { FieldValue, Timestamp } from "@/lib/firestore-compat";

/**
 * Farm Nation Property Management Actions
 */

export interface Property { id: string;
    name: string;
    description: string;
    location: string;
    state: string;
    lga: string;
    price: number;
    size: number; // hectares
    type: "sale" | "rent" | "lease";
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
    documents: { cOfO?: string; //  Certificate of Occupancy
        surveyPlan?: string;
        taxClearance?: string;
    };
    createdAt: any;
    updatedAt: any;
    leaseDuration?: number; // months, if type is lease
    viewCount: number;
    favoriteCount: number;
}


export interface PropertyListingInput { name: string;
    description: string;
    location: string;
    state: string;
    lga: string;
    price: number;
    size: number;
    type: "sale" | "rent" | "lease";
    category: string | string[];
    features: string[];
    leaseDuration?: number; }


export interface FarmNationOnboardingData { role: "buyer" | "seller" | "both";
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
    interests: { // Buyer fields
        propertyTypes?: string[];
        budgetRange?: string;
        preferredSize?: string;
        // Seller fields
        listingTypes?: string[];
        totalAcreage?: string;
        readyToList?: boolean;
    };
    terms: { termsAccepted: boolean;
        privacyAccepted: boolean;
        feeDisclosureAccepted: boolean;
    };
}


// ============================================================================
// DASHBOARD STATS — Farm Nation Member Dashboard
// ============================================================================

export interface FarmNationDashboardStats { /** Total size (hectares) of all properties the user has listed */
    totalHectares: number;
    /** Count of properties with status "available" */
    activeListings: number;
    /** Count of properties with status "sold" or "leased" */
    completedDeals: number;
    /** Total value of all listed properties */
    portfolioValue: number;
    /** Count of pending purchase/lease transactions (as buyer) */
    pendingTransactions: number;
    /** Count of properties acquired (status completed/confirmed) */
    propertiesAcquired: number;
    /** Total value of investments made */
    totalInvestmentValue: number;
    /** Recent transactions (last 5 as buyer) */
    recentTransactions: Array<{
        id: string;
        propertyName: string;
        propertyType: string;
        amount: number;
        status: string;
        createdAt: Date;
    }>;
    /** Recent listings (last 4 by this user) */
    recentListings: Array<{ id: string;
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
    /** User's registered role in Farm Nation (buyer | seller | both) */
    role: string;
}
