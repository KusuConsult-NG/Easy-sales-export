/**
 * Marketplace Domain Types
 *
 * @easy-sales/marketplace/types
 */

import type { FieldValue, Timestamp } from "firebase-admin/firestore";

// ============================================================================
// SELLER VERIFICATION
// ============================================================================

export type SellerCategory = "wholesale" | "retail";

export interface SellerVerification {
    id: string;
    userId: string;
    status: "pending" | "approved" | "rejected" | "suspended";

    // Seller Categorization (NEW)
    sellerCategory?: SellerCategory;

    // Verified Badge (NEW)
    isVerifiedBadge?: boolean;
    verifiedBadgeGrantedAt?: FieldValue | Timestamp | Date;
    verifiedBadgeGrantedBy?: string;

    // Payment on Delivery (NEW)
    allowsPaymentOnDelivery?: boolean;

    // Phone Verification
    phoneNumber: string;
    phoneVerified: boolean;
    phoneVerifiedAt?: FieldValue | Timestamp | Date;

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
    reviewedAt?: FieldValue | Timestamp | Date;
    rejectionReason?: string;

    createdAt: FieldValue | Timestamp | Date;
    updatedAt: FieldValue | Timestamp | Date;
    _version?: number;
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
    | "poultry"
    | "sea_foods"
    | "horticultural"
    | "natural_oils"
    | "spices_herbs_seasonings"
    | "beverages"
    | "dairy"
    | "organics"
    | "gmos"
    | "health_wellness"
    | "grains"
    | "vegetables"
    | "fruits"
    | "livestock"
    | "fishery"
    | "processed"
    | "equipment"
    | "other"
    | "nuts"
    | "spices"
    | "roots"
    | "organic";

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
        nearestMarket?: string;
    };

    // Delivery
    deliveryMethod: DeliveryMethod;
    estimatedDeliveryDays?: number;

    // Certifications
    certifications?: string[];
    harvestDate?: FieldValue | Timestamp | Date;
    productionDate?: FieldValue | Timestamp | Date;

    // Status
    status: "draft" | "active" | "suspended" | "out_of_stock" | "deleted" | "pending" | "rejected";
    bulkAvailable: boolean;
    exportReady: boolean;

    // Metrics
    views: number;
    orders: number;
    rating: number;
    reviewCount: number;

    // Denormalized Seller Data
    sellerName?: string;
    sellerVerified?: boolean;       // Denormalized from seller_verifications.isVerifiedBadge
    sellerCategory?: SellerCategory; // Denormalized from seller_verifications.sellerCategory

    createdAt: FieldValue | Timestamp | Date;
    updatedAt: FieldValue | Timestamp | Date;
    _version?: number;
}

// ============================================================================
// SHOPPING CART
// ============================================================================

export interface CartItem {
    id: string;        // matches productId
    productId?: string; // legacy alias
    title: string;
    productTitle?: string;
    productImage?: string;
    sellerId: string;
    vendorName?: string;
    quantity: number;
    unit: string;
    selectedTier: "retail" | "bulk" | "export";
    price: number;
    addedAt: FieldValue | Timestamp | Date;
    isFlashSale?: boolean;
    eventId?: string;
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
    | "confirmed"
    | "processing"
    | "shipped"
    | "delivered"
    | "completed"
    | "cancelled"
    | "disputed";

export type OrderPaymentMethod = "escrow" | "wallet" | "payment_on_delivery";

export interface Order {
    id: string;
    orderNumber: string;

    // Parties
    buyerId: string;
    sellerId: string;
    sellerIds?: string[];

    // Items
    productIds: string[]; // For efficient querying
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

    // Payment Method (NEW)
    paymentMethod?: OrderPaymentMethod;

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
    paymentStatus?: string;
    paymentReference?: string;

    // Escrow
    escrowTransactionId?: string;

    // Tracking
    trackingNumber?: string;
    estimatedDeliveryDate?: FieldValue | Timestamp | Date;
    deliveredAt?: FieldValue | Timestamp | Date;

    // Review tracking (NEW)
    reviewSubmitted?: boolean;
    reviewId?: string;

    // Buyer Confirmation
    buyerConfirmed: boolean;
    buyerConfirmedAt?: FieldValue | Timestamp | Date;

    // Escrow Release Tracking (set by confirmDeliveryAction)
    escrowReleased?: boolean;
    escrowReleasedAt?: FieldValue | Timestamp | Date;
    paystackTransferCode?: string;   // Paystack transfer code after release
    sellerAmountPaid?: number;       // Actual amount sent to seller (after commission)
    escrowPendingManualRelease?: boolean; // Set if Paystack payout failed
    escrowReleaseError?: string;
    escrowReleaseNote?: string;

    createdAt: FieldValue | Timestamp | Date;
    updatedAt: FieldValue | Timestamp | Date;
    _version?: number;
}

// ============================================================================
// ESCROW
// ============================================================================

export type EscrowStatus =
    | "pending"
    | "funded"
    | "in_transit"
    | "delivered"
    | "released"
    | "refunded"
    | "disputed"
    | "cancelled"
    | "completed";

export interface EscrowTransaction {
    id: string;
    orderId?: string; // Optional: Link to the master order (Marketplace)
    // Standalone Escrow fields
    buyerId: string;
    buyerEmail?: string;
    sellerId: string;
    sellerEmail?: string;
    productName?: string;
    productDescription?: string;

    // Amount
    amount: number;
    grossAmount?: number;
    platformFee?: number;
    sellerAmount?: number;

    // Status
    status: EscrowStatus;

    // Payments
    paymentReference?: string;
    paidAt?: FieldValue | Timestamp | Date;
    releasedAt?: FieldValue | Timestamp | Date;
    refundedAt?: FieldValue | Timestamp | Date;
    releaseRequestedAt?: FieldValue | Timestamp | Date;
    releaseRequestedBy?: string;
    releasedBy?: string;

    // Dispute
    disputeId?: string;

    createdAt: FieldValue | Timestamp | Date;
    updatedAt?: FieldValue | Timestamp | Date;
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
    orderId?: string; // Marketplace
    escrowId?: string; // Standalone Escrow

    // Parties (Marketplace)
    buyerId?: string;
    sellerId?: string;

    // Parties (Standalone Escrow - Generic)
    initiatorId?: string;
    respondentId?: string;
    initiatedBy?: "buyer" | "seller";

    // Details
    reason: DisputeReason | string; // String for generic
    description?: string; // Marketplace uses this
    evidenceUrls?: string[]; // URLs to uploaded evidence
    evidence?: string[]; // Standalone uses this (alias?)

    // Status
    status: DisputeStatus;

    /**
     * Whether the escrow behind this dispute was frozen when it was filed.
     *
     * Filing a dispute must take the escrow off `funded`, or the auto-release
     * cron (api/cron/release-escrow) pays the seller while the dispute is open —
     * which is what happened to every dispute raised from
     * /dashboard/disputes/new, because actions/disputes.ts claimed only the
     * ORDER. Recorded here so an admin can see, BEFORE choosing a resolution,
     * whether there is money left to move.
     */
    escrowFrozen?: boolean;

    /**
     * Set when the escrow had already been released or refunded before the
     * dispute was filed.
     *
     * resolveDisputeAction claims the escrow from ["funded","disputed","pending"],
     * so a refund resolution cannot be executed against a settled one. The admin
     * should not discover that only when the refund fails.
     */
    escrowAlreadySettled?: string | null;

    // Admin Review
    adminId?: string;
    adminNotes?: string;
    resolution?: DisputeResolution | string;
    refundAmount?: number; // For partial refunds
    resolvedAt?: FieldValue | Timestamp | Date;
    resolvedBy?: string;

    createdAt: FieldValue | Timestamp | Date;
    updatedAt?: FieldValue | Timestamp | Date;
    _version?: number;
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
    readAt?: FieldValue | Timestamp | Date;

    createdAt: Date;
}

export interface Conversation {
    id: string;
    participants: string[]; // [buyerId, sellerId]

    // Context
    orderId?: string;
    productId?: string;

    lastMessage: string;
    lastMessageAt: FieldValue | Timestamp | Date;

    // Unread counts
    unreadCount: Record<string, number>; // userId -> count

    createdAt: FieldValue | Timestamp | Date;
    updatedAt: FieldValue | Timestamp | Date;
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
    moderatedAt?: FieldValue | Timestamp | Date;
    rejectionReason?: string;

    updatedAt?: FieldValue | Timestamp | Date;

    createdAt: FieldValue | Timestamp | Date;
}

// ============================================================================
// VILLAGE MARKET (FLASH SALES)
// ============================================================================

export interface VillageMarketEvent {
    id: string;
    title: string;
    description?: string;
    location: string;            // Physical location / venue name
    state: string;               // Nigerian state
    lga?: string;

    // Timing
    startTime: FieldValue | Timestamp | Date;
    endTime: FieldValue | Timestamp | Date;
    isRecurring?: boolean;
    recurringDay?: string;       // e.g. "Saturday"

    // Participants
    participantSellerIds?: string[]; // Platform sellers who joined
    externalMerchants?: ExternalMerchant[];

    // Status
    status: "upcoming" | "active" | "ended" | "cancelled";

    createdBy: string; // admin UID
    createdAt: FieldValue | Timestamp | Date;
    updatedAt?: FieldValue | Timestamp | Date;
}

export interface ExternalMerchant {
    id: string;          // generated
    displayName: string;
    businessName?: string;
    phone?: string;
    productsDescription?: string; // What they're selling
    imageUrl?: string;
}

export interface FlashSaleProduct {
    id: string;
    eventId: string;
    sellerId: string;         // Platform user UID (or 'external' for outside merchants)
    externalMerchantId?: string; // If from an external merchant

    // Product info (may reference an existing product or be ad-hoc)
    productId?: string;       // Reference to products collection (if platform seller)
    title: string;
    description?: string;
    imageUrl?: string;
    images?: string[];
    price: number;
    unit?: string;
    availableQuantity?: number;

    // Flash sale specific
    flashPrice?: number;      // Special discounted price
    validUntil?: FieldValue | Timestamp | Date;

    status: "active" | "sold_out" | "removed";
    createdAt: FieldValue | Timestamp | Date;
    updatedAt?: FieldValue | Timestamp | Date;
}

// ============================================================================
// WALLET
// ============================================================================

export type WalletTransactionType =
    | "funding"          // Wallet top-up via Paystack
    | "purchase"         // Order paid from wallet
    | "refund"           // Refund credited to wallet
    | "withdrawal"       // Withdrawal to bank account
    | "bonus";            // Admin-issued bonus

export interface Wallet {
    id: string;          // Same as userId
    userId: string;
    balance: number;     // In Naira (NGN), stored as kobo-safe integer (×100)
    currency: "NGN";
    updatedAt: Date | FieldValue | Timestamp;
    createdAt: Date | FieldValue | Timestamp;
}

export interface WalletTransaction {
    id: string;
    walletId: string;
    userId: string;
    type: WalletTransactionType;
    amount: number;          // Positive = credit, Negative = debit
    balanceBefore: number;
    balanceAfter: number;
    reference?: string;      // Paystack reference for funding
    orderId?: string;        // Related order (for purchases)
    description: string;
    status: "pending" | "completed" | "failed";
    createdAt: FieldValue | Timestamp | Date;
    updatedAt?: FieldValue | Timestamp | Date;
}

// ============================================================================
// SELLER REVIEWS (buyer reviewing a seller)
// ============================================================================

export interface SellerReview {
    id: string;
    sellerId: string;
    buyerId: string;
    orderId: string;

    rating: number; // 1-5
    comment?: string;

    verified: boolean; // Order was actually completed

    // Admin moderation
    status: "pending" | "approved" | "rejected";
    moderatedBy?: string;
    moderatedAt?: FieldValue | Timestamp | Date;

    createdAt: FieldValue | Timestamp | Date;
    updatedAt?: FieldValue | Timestamp | Date;
}

// ============================================================================
// DOMAIN-SPECIFIC COMPOSITE VIEW MODELS
// ============================================================================

export interface SellerDashboardStats {
    totalSales: number;
    totalOrders: number;
    pendingDeliveries: number;
    activeListings: number;
    availableBalance: number;
    escrowLockedBalance: number;
    recentTransactions: any[];
}

export interface BuyerDashboardStats {
    totalSpent: number;
    totalOrdersCount: number;
    activeOrdersCount: number;
    disputedOrdersCount: number;
    walletBalance: number;
}
