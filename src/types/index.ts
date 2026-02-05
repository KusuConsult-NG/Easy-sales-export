// ===========================
// User & Authentication Types
// ===========================

export interface User {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    phoneNumber?: string;
    role: "member" | "admin" | "super_admin";
    membershipTier?: "Basic" | "Premium" | "Gold";
    memberSince?: Date;
    profileImage?: string;
}

export interface AuthSession {
    user: User;
    accessToken: string;
    refreshToken?: string;
}

// ===========================
// Export Window Types
// ===========================

export type CommodityType = "Yam Tubers" | "Sesame Seeds" | "Dried Hibiscus";

export interface ExportWindow {
    id: string;
    commodity: CommodityType;
    phase: string;
    roi: string;
    fundingProgress: number; // 0-100
    daysRemaining: number;
    minInvestment: number;
    maxInvestment?: number;
    targetAmount: number;
    currentAmount: number;
    status: "open" | "funded" | "in_progress" | "completed" | "closed";
    startDate: Date;
    endDate: Date;
    imageUrl?: string;
}

export interface UserExportParticipation {
    id: string;
    exportWindowId: string;
    userId: string;
    amountInvested: number;
    participationDate: Date;
    status: "pending" | "active" | "completed" | "disputed";
    expectedReturn: number;
    actualReturn?: number;
}

// ===========================
// Marketplace Types
// ===========================

export interface Product {
    id: string;
    name: string;
    description: string;
    commodity: CommodityType;
    price: number;
    unit: "kg" | "ton" | "bag";
    minOrder: number;
    maxOrder?: number;
    imageUrl: string;
    inStock: boolean;
    sellerId: string;
    quality: "Standard" | "Premium" | "Organic";
}

export interface Order {
    id: string;
    userId: string;
    productId: string;
    quantity: number;
    totalAmount: number;
    status: "pending" | "escrow" | "shipped" | "delivered" | "completed" | "disputed";
    createdAt: Date;
    updatedAt: Date;
    escrowReleaseDate?: Date;
    trackingNumber?: string;
}

// ===========================
// Cooperative Types
// ===========================

export interface CooperativeMember {
    id: string;
    userId: string;
    membershipNumber: string;
    joinDate: Date;
    tier: "Basic" | "Premium" | "Gold";
    totalSavings: number;
    totalExports: number;
    totalRevenue: number;
    status: "active" | "inactive" | "suspended";
}

export interface Transaction {
    id: string;
    userId: string;
    type: "deposit" | "withdrawal" | "export_profit" | "fee";
    amount: number;
    description: string;
    status: "pending" | "completed" | "failed";
    date: Date;
    reference?: string;
}

// ===========================
// WAVE Program Types
// ===========================

export interface WAVEApplication {
    id: string;
    userId: string;
    businessName: string;
    businessType: string;
    yearsInOperation: number;
    annualRevenue?: number;
    fundingNeeded: number;
    purpose: string;
    status: "draft" | "submitted" | "under_review" | "approved" | "rejected";
    submittedAt?: Date;
    reviewedAt?: Date;
    reviewNotes?: string;
}

// ===========================
// Farm Nation Types
// ===========================

export interface LandListing {
    id?: string;
    title: string;
    description: string;
    location: {
        state: string;
        lga: string;
        address: string;
    };
    size: number; // in hectares
    sizeInAcres: number; // for display
    pricePerHectare: number;
    pricePerAcre: number; // for display
    totalPrice: number;
    soilType: string;
    waterSource?: string;
    waterAccess: boolean;
    accessibility: string;
    images: string[];
    documents?: {
        titleDeed?: string;
        survey?: string;
        photos?: string[];
    };
    ownerId: string;
    ownerEmail?: string;
    status: "available" | "reserved" | "sold";
    verificationStatus: "pending" | "approved" | "rejected";
    rejectionReason?: string;
    verifiedBy?: string;
    verifiedAt?: Date;
    listedDate: Date;
    createdAt?: Date;
    updatedAt?: Date;
}

// ===========================
// Academy Types
// ===========================

export interface Course {
    id: string;
    title: string;
    description: string;
    instructor: string;
    duration: string; // e.g., "4 weeks"
    modules: number;
    price: number;
    currency: "NGN" | "USD";
    imageUrl: string;
    category: "export" | "farming" | "business" | "compliance";
    level: "beginner" | "intermediate" | "advanced";
    enrollmentCount: number;
    rating: number; // 0-5
    status: "upcoming" | "open" | "in_progress" | "completed";
}

export interface Enrollment {
    id: string;
    userId: string;
    courseId: string;
    enrollmentDate: Date;
    progress: number; // 0-100
    completedModules: number;
    totalModules: number;
    status: "active" | "completed" | "dropped";
    certificateUrl?: string;
}

// ===========================
// Admin & Dispute Types
// ===========================

export interface Dispute {
    id: string;
    orderId?: string;
    exportWindowId?: string;
    complainantId: string;
    respondentId?: string;
    type: "order" | "export" | "payment" | "other";
    subject: string;
    description: string;
    status: "open" | "investigating" | "resolved" | "closed";
    priority: "low" | "medium" | "high" | "urgent";
    createdAt: Date;
    updatedAt: Date;
    resolvedAt?: Date;
    resolution?: string;
    assignedTo?: string;
}

export interface DisputeMessage {
    id: string;
    disputeId: string;
    senderId: string;
    message: string;
    attachments?: string[];
    timestamp: Date;
}

// ===========================
// Dashboard Stats Types
// ===========================

export interface DashboardStats {
    totalExports: number;
    totalRevenue: number;
    activeWindows: number;
    pendingOrders: number;
    savings: number;
    roi: string;
}
