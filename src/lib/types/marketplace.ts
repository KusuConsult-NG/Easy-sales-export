/**
 * Marketplace Type Definitions
 * 
 * Complete type definitions for the Easy Sales Digital Marketplace
 */

import type { UserRole } from "./roles";

// ============================================================================
// SELLER VERIFICATION
// ============================================================================

export interface SellerVerification {
    id: string;
    userId: string;
    status: "pending" | "approved" | "rejected" | "suspended";

    // Phone Verification
    phoneNumber: string;
    phoneVerified: boolean;
    phoneVerifiedAt?: Date;

    // Identity Documents
    nin?: string;
    bvn?: string;
    cac?: string; // For business entities

    // Bank Details
    bankAccount: {
        accountNumber: string;
        bankName: string;
        accountName: string;
        bankCode: string;
    };

    // Physical Address
    address: {
        street: string;
        city: string;
        state: string;
        lga: string;
        country: string;
        postalCode?: string;
    };

    // Location Coordinates
    location?: {
        latitude: number;
        longitude: number;
    };

    // Admin Review
    reviewedBy?: string;
    reviewedAt?: Date;
    rejectionReason?: string;

    createdAt: Date;
    updatedAt: Date;
}

// ============================================================================
// PRODUCT LISTINGS
// ============================================================================

export type PricingTier = {
    type: "retail" | "bulk" | "export";
    price: number;
    minQuantity: number;
};

export type DeliveryMethod = "pickup" | "delivery" | "both";

export type ProductCategory =
    | "grains"
    | "vegetables"
    | "fruits"
    | "livestock"
    | "poultry"
    | "fishery"
    | "processed"
    | "equipment"
    | "other";

export interface Product {
    id: string;
    sellerId: string;

    // Basic Info
    title: string;
    description: string;
    category: ProductCategory;

    // Media
    images: string[]; // URLs to uploaded images
    videoUrl?: string;

    // Pricing
    pricingTiers: PricingTier[];

    // Inventory
    availableQuantity: number;
    minimumOrderQuantity: number;
    unit: string; // e.g., "kg", "bags", "pieces"

    // Location
    location: {
        state: string;
        lga: string;
    };

    // Delivery
    deliveryMethod: DeliveryMethod;
    estimatedDeliveryDays?: number;

    // Certifications
    certifications?: string[];
    harvestDate?: Date;
    productionDate?: Date;

    // Status
    status: "draft" | "active" | "suspended" | "out_of_stock";
    bulkAvailable: boolean;
    exportReady: boolean;

    // Metrics
    views: number;
    orders: number;
    rating: number;
    reviewCount: number;

    createdAt: Date;
    updatedAt: Date;
}

// ============================================================================
// SHOPPING CART
// ============================================================================

export interface CartItem {
    productId: string;
    sellerId: string;
    quantity: number;
    selectedTier: "retail" | "bulk" | "export";
    price: number;
    addedAt: Date;
}

export interface ShoppingCart {
    id: string;
    userId: string;
    items: CartItem[];
    updatedAt: Date;
}

// ============================================================================
// ORDERS & CHECKOUT
// ============================================================================

export type OrderStatus =
    | "pending_payment"
    | "payment_received"
    | "processing"
    | "shipped"
    | "delivered"
    | "completed"
    | "cancelled"
    | "disputed";

export interface Order {
    id: string;
    orderNumber: string;

    // Parties
    buyerId: string;
    sellerId: string;

    // Items
    items: {
        productId: string;
        productTitle: string;
        quantity: number;
        unitPrice: number;
        totalPrice: number;
        tier: "retail" | "bulk" | "export";
    }[];

    // Amounts
    subtotal: number;
    deliveryFee: number;
    serviceFee: number;
    totalAmount: number;

    // Delivery
    deliveryAddress: {
        recipientName: string;
        recipientPhone: string;
        street: string;
        city: string;
        state: string;
        lga: string;
    };

    // Status
    status: OrderStatus;

    // Escrow
    escrowTransactionId?: string;

    // Tracking
    trackingNumber?: string;
    estimatedDeliveryDate?: Date;
    deliveredAt?: Date;

    // Buyer Confirmation
    buyerConfirmed: boolean;
    buyerConfirmedAt?: Date;

    createdAt: Date;
    updatedAt: Date;
}

// ============================================================================
// ESCROW
// ============================================================================

export type EscrowStatus =
    | "pending"
    | "funded"
    | "released"
    | "refunded"
    | "disputed";

export interface EscrowTransaction {
    id: string;
    orderId: string;

    // Parties
    buyerId: string;
    sellerId: string;

    // Amount
    amount: number;
    platformFee: number;
    sellerAmount: number;

    // Status
    status: EscrowStatus;

    // Payments
    paymentReference: string;
    paidAt?: Date;
    releasedAt?: Date;
    refundedAt?: Date;

    // Dispute
    disputeId?: string;

    createdAt: Date;
    updatedAt: Date;
}

// ============================================================================
// MESSAGING
// ============================================================================

export interface Message {
    id: string;
    conversationId: string;

    senderId: string;
    recipientId: string;

    content: string;
    attachments?: string[];

    read: boolean;
    readAt?: Date;

    createdAt: Date;
}

export interface Conversation {
    id: string;
    participants: string[]; // [buyerId, sellerId]

    // Context
    orderId?: string;
    productId?: string;

    lastMessage: string;
    lastMessageAt: Date;

    // Unread counts
    unreadCount: Record<string, number>; // userId -> count

    createdAt: Date;
    updatedAt: Date;
}

// ============================================================================
// DISPUTES
// ============================================================================

export type DisputeStatus = "open" | "under_review" | "resolved" | "closed";

export type DisputeReason =
    | "not_received"
    | "wrong_item"
    | "damaged"
    | "fake_product"
    | "other";

export type DisputeResolution =
    | "refund_buyer"
    | "release_seller"
    | "partial_refund"
    | "no_action";

export interface Dispute {
    id: string;
    orderId: string;
    buyerId: string;
    sellerId: string;

    // Details
    reason: DisputeReason;
    description: string;
    evidenceUrls: string[]; // URLs to uploaded evidence

    // Status
    status: DisputeStatus;

    // Admin Review
    adminId?: string;
    adminNotes?: string;
    resolution?: DisputeResolution;
    refundAmount?: number; // For partial refunds
    resolvedAt?: Date;

    createdAt: Date;
    updatedAt: Date;
}

// ============================================================================
// REVIEWS
// ============================================================================

export interface ProductReview {
    id: string;
    productId: string;
    sellerId: string;
    userId: string;
    orderId: string;

    rating: number; // 1-5
    comment: string;
    images?: string[];

    verified: boolean; // Purchased from platform

    // Admin moderation
    status: "pending" | "approved" | "rejected";
    moderatedBy?: string;
    moderatedAt?: Date;
    rejectionReason?: string;

    updatedAt?: Date;

    createdAt: Date;
}
