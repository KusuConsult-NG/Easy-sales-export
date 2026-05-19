/**
 * Export Module Types
 * 
 * Domain: Export Windows & Investments
 * Part of the Platform Type Isolation — Phase 0 Migration
 */

export interface ExportWindow {
    id: string;
    title?: string; // e.g. "Q1 2026 Yam Export"
    orderId: string; // @deprecated - leaving for compatibility
    commodity: "yam" | "sesame" | "hibiscus" | "other";
    quantity: string;
    amount: number; // Minimum investment
    roi: string; // e.g. "15-20%"
    duration: string; // e.g. "6 months"
    totalSpots?: number;
    spotsFilled?: number;
    fundedAmount?: number; // Total amount raised
    image?: string;
    status: "pending" | "open" | "active" | "completed" | "closed" | "in_transit" | "delivered";

    // Deep Data Fields
    description?: string;
    specifications?: string[]; // List of product specs
    benefits?: string[]; // List of investment benefits
    documents?: {
        name: string;
        url?: string;
        required: boolean;
    }[];
    timeline?: {
        phase: string;
        date: string;
        description: string;
        status: "pending" | "active" | "completed";
    }[];

    userId?: string; // Creator/Admin
    startDate?: Date;
    endDate?: Date;
    deliveryDate?: Date; // Legacy support
    createdAt: Date;
    updatedAt: Date;
}

export interface ExportOnboardingApplication {
    applicationId: string;
    userId: string;
    userEmail?: string | null;
    profile: any;
    kyc: any;
    bank: any;
    terms: any;
    status: "pending_review" | "approved" | "rejected";
    submittedAt: Date;
    createdAt: Date;
    updatedAt: Date;
}

export interface ExportInvestment {
    id: string;
    userId: string;
    windowId: string;
    amount: number;
    status: "pending" | "active" | "completed" | "cancelled";
    roi?: string;
    roiAmount?: number;
    investedAt?: Date;
    completedAt?: Date;
    createdAt?: Date;
    updatedAt?: Date;
}

export interface ExportSlot {
    id: string;
    userId: string;
    exportId: string; // Reference to export_windows document
    windowTitle?: string; // Denormalized for display — e.g. "Q1 Yam Export"
    commodity?: string;
    amount: number; // Amount invested by the user
    expectedReturn: number; // Projected profit at window end
    roi?: string; // e.g. "15%"
    status: "pending" | "active" | "completed" | "cancelled";
    paymentReference?: string; // Paystack reference (optional until payment confirmed)
    purchaseDate?: Date;
    startDate?: Date;
    endDate?: Date;
    daysRemaining?: number;
    createdAt: Date;
    updatedAt?: Date;
}
