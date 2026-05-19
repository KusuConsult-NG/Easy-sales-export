/**
 * Marketplace Domain Types
 *
 * @easy-sales/marketplace/types
 *
 * Re-exports from @easy-sales/types/marketplace + domain view models.
 */

export type {
    SellerCategory,
    SellerVerification,
    PricingTier,
    DeliveryMethod,
    ProductCategory,
    Product,
    CartItem,
    ShoppingCart,
    OrderStatus,
    OrderPaymentMethod,
    Order,
    EscrowStatus,
    EscrowTransaction,
    Dispute,
    Message,
    Conversation,
    DisputeStatus,
    DisputeReason,
    DisputeResolution,
    ProductReview,
    VillageMarketEvent,
    ExternalMerchant,
    FlashSaleProduct,
    Wallet,
    WalletTransaction,
    WalletTransactionType,
    SellerReview,
} from "@easy-sales/types/marketplace";

// ─── Domain-specific Composite View Models ───────────────────────────────────

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
