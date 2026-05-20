/**
 * Marketplace Domain Service Contracts
 *
 * @easy-sales/marketplace/contracts
 */

import type { ActionResponse } from "../../config/src/index";
import type {
    SellerVerification,
    Product,
    Order,
    EscrowTransaction,
    Dispute,
    ProductReview,
    SellerReview,
    ShoppingCart,
    CartItem,
    Wallet,
    WalletTransaction,
    SellerDashboardStats,
    BuyerDashboardStats,
} from "./types";

export interface MarketplaceServiceContract {
    // ─── Verification & Onboarding ───────────────────────────────────────────
    checkMarketplaceStatus(): Promise<ActionResponse<{ status: string; accountType: string } | null>>;
    submitSellerVerification(formData: FormData): Promise<ActionResponse<null>>;
    getSellerVerification(): Promise<ActionResponse<{ verification: SellerVerification | null }>>;
    submitMarketplaceOnboarding(formData: FormData): Promise<ActionResponse<null>>;

    // ─── Product Management ──────────────────────────────────────────────────
    createProduct(formData: FormData): Promise<ActionResponse<{ productId: string }>>;
    getMarketplaceProducts(params?: {
        category?: string;
        search?: string;
        minPrice?: number;
        maxPrice?: number;
        location?: string;
        sortBy?: string;
        limit?: number;
    }): Promise<ActionResponse<{ products: Product[] }>>;
    getProductById(productId: string): Promise<ActionResponse<Product>>;
    deleteProduct(productId: string): Promise<ActionResponse<{ success: boolean; message: string }>>;

    // ─── Cart & Shopping ─────────────────────────────────────────────────────
    getCart(): Promise<ActionResponse<ShoppingCart | null>>;
    addToCart(item: CartItem): Promise<ActionResponse<ShoppingCart>>;
    removeFromCart(productId: string): Promise<ActionResponse<ShoppingCart>>;
    updateCartItemQuantity(productId: string, quantity: number): Promise<ActionResponse<ShoppingCart>>;

    // ─── Checkout & Orders ───────────────────────────────────────────────────
    createOrder(params: {
        items: CartItem[];
        deliveryAddress: Order["deliveryAddress"];
        paymentMethod: Order["paymentMethod"];
    }): Promise<ActionResponse<Order>>;
    getOrderById(orderId: string): Promise<ActionResponse<Order>>;
    getBuyerOrders(): Promise<ActionResponse<Order[]>>;
    getSellerOrders(): Promise<ActionResponse<Order[]>>;
    confirmDelivery(orderId: string): Promise<ActionResponse<null>>;

    // ─── Wallet Operations ───────────────────────────────────────────────────
    getWallet(): Promise<ActionResponse<Wallet | null>>;
    getWalletTransactions(): Promise<ActionResponse<WalletTransaction[]>>;
    fundWallet(amount: number): Promise<ActionResponse<{ authorizationUrl: string; reference: string }>>;
    withdrawFromWallet(amount: number): Promise<ActionResponse<null>>;

    // ─── Escrow & Disputes ───────────────────────────────────────────────────
    getEscrowTransaction(escrowId: string): Promise<ActionResponse<EscrowTransaction | null>>;
    initiateDispute(orderId: string, reason: string, description: string, evidenceUrls?: string[]): Promise<ActionResponse<Dispute>>;
    getDisputeById(disputeId: string): Promise<ActionResponse<Dispute | null>>;

    // ─── Dashboard Stats ─────────────────────────────────────────────────────
    getSellerDashboardStats(): Promise<ActionResponse<SellerDashboardStats>>;
    getBuyerDashboardStats(): Promise<ActionResponse<BuyerDashboardStats>>;
}
