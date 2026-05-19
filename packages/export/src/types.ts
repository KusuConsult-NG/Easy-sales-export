export interface ExportWindow {
    id: string;
    title?: string;
    orderId: string; // @deprecated
    commodity: "yam" | "sesame" | "hibiscus" | "other";
    quantity: string;
    amount: number;
    roi: string;
    duration: string;
    totalSpots?: number;
    spotsFilled?: number;
    fundedAmount?: number;
    image?: string;
    status: "pending" | "open" | "active" | "completed" | "closed" | "in_transit" | "delivered";
    description?: string;
    specifications?: string[];
    benefits?: string[];
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
    userId?: string;
    startDate?: Date;
    endDate?: Date;
    deliveryDate?: Date;
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
    exportId: string;
    windowTitle?: string;
    commodity?: string;
    amount: number;
    expectedReturn: number;
    roi?: string;
    status: "pending" | "active" | "completed" | "cancelled";
    paymentReference?: string;
    purchaseDate?: Date;
    startDate?: Date;
    endDate?: Date;
    daysRemaining?: number;
    createdAt: Date;
    updatedAt?: Date;
}
