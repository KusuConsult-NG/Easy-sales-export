import { z } from "zod";

/**
 * Marketplace Zod Schemas
 * Used for data-scrubbing and ensuring data integrity across the platform.
 * These schemas "heal" corrupted legacy data by providing sensible defaults.
 */

// Helper for Firestore Timestamps / Dates
const dateSchema = z.preprocess((arg) => {
    if (arg instanceof Date) return arg;
    if (typeof arg === 'object' && arg !== null && 'seconds' in arg) {
        return new Date((arg as any).seconds * 1000);
    }
    if (typeof arg === 'string') return new Date(arg);
    return new Date(); // Default to now if missing
}, z.date());

export const PricingTierSchema = z.object({
    type: z.enum(["retail", "bulk", "export"]),
    price: z.number().default(0),
    minQuantity: z.number().default(1),
});

export const ProductCategorySchema = z.enum([
    "poultry",
    "sea_foods",
    "horticultural",
    "natural_oils",
    "spices_herbs_seasonings",
    "beverages",
    "dairy",
    "organics",
    "gmos",
    "health_wellness",
    "grains",
    "vegetables",
    "fruits",
    "livestock",
    "fishery",
    "processed",
    "equipment",
    "other",
    "nuts",
    "spices",
    "roots",
    "organic",
]);

export const ProductSchema = z.object({
    id: z.string(),
    sellerId: z.string(),
    title: z.string().default("Untitled Product"),
    description: z.string().default("No description provided"),
    category: ProductCategorySchema.default("other"),
    images: z.array(z.string()).default([]),
    videoUrl: z.string().optional(),
    pricingTiers: z.array(PricingTierSchema).default([{ type: "retail", price: 0, minQuantity: 1 }]),
    availableQuantity: z.number().default(0),
    minimumOrderQuantity: z.number().default(1),
    unit: z.string().default("units"),
    location: z.object({
        state: z.string().default("Lagos"),
        lga: z.string().default("Unknown"),
        nearestMarket: z.string().default("Unknown"),
    }).default({ state: "Lagos", lga: "Unknown", nearestMarket: "Unknown" }),
    deliveryMethod: z.enum(["pickup", "delivery", "both"]).default("delivery"),
    estimatedDeliveryDays: z.number().optional(),
    status: z.enum(["draft", "active", "suspended", "out_of_stock", "deleted", "pending", "rejected"]).default("draft"),
    bulkAvailable: z.boolean().default(false),
    exportReady: z.boolean().default(false),
    views: z.number().default(0),
    orders: z.number().default(0),
    rating: z.number().default(0),
    reviewCount: z.number().default(0),
    sellerName: z.string().default("Easy Sales Seller"),
    sellerVerified: z.boolean().default(false),
    sellerCategory: z.enum(["wholesale", "retail"]).default("retail"),
    createdAt: dateSchema,
    updatedAt: dateSchema,
    _version: z.number().default(0),
});

export const OrderItemSchema = z.object({
    productId: z.string(),
    productTitle: z.string().default("Product"),
    quantity: z.number().default(1),
    unitPrice: z.number().default(0),
    totalPrice: z.number().default(0),
    tier: z.enum(["retail", "bulk", "export"]).default("retail"),
});

export const OrderSchema = z.object({
    id: z.string(),
    orderId: z.string().optional(),
    orderNumber: z.string().default("ORDER-UNKNOWN"),
    buyerId: z.string(),
    sellerId: z.string(),
    productIds: z.array(z.string()).default([]),
    items: z.array(OrderItemSchema).default([]),
    subtotal: z.number().default(0),
    deliveryFee: z.number().default(0),
    serviceFee: z.number().default(0),
    totalAmount: z.number().default(0),
    paymentMethod: z.enum(["escrow", "wallet", "payment_on_delivery"]).default("escrow"),
    status: z.enum([
        "pending_payment",
        "payment_received",
        "processing",
        "shipped",
        "delivered",
        "completed",
        "cancelled",
        "disputed",
    ]).default("pending_payment"),
    deliveryAddress: z.object({
        recipientName: z.string().default("Guest"),
        recipientPhone: z.string().default(""),
        street: z.string().default(""),
        city: z.string().default(""),
        state: z.string().default(""),
        lga: z.string().default(""),
    }),
    buyerConfirmed: z.boolean().default(false),
    buyerConfirmedAt: dateSchema.optional(),
    escrowReleased: z.boolean().default(false),
    escrowReleasedAt: dateSchema.optional(),
    escrowTransactionId: z.string().optional(),
    paymentStatus: z.string().optional(),
    paymentReference: z.string().optional(),
    createdAt: dateSchema,
    updatedAt: dateSchema,
    _version: z.number().default(0),
});

export const SellerAnalyticsSchema = z.object({
    totalSales: z.number().default(0),
    activeListings: z.number().default(0),
    pendingOrders: z.number().default(0),
    monthlyRevenue: z.number().default(0),
    conversionRate: z.number().default(0),
    averageRating: z.number().default(0),
    prevMonthRevenue: z.number().default(0),
    prevTotalSales: z.number().default(0),
    prevActiveListings: z.number().default(0),
});

export const MarketplaceOnboardingSchema = z.object({
    shopName: z.string().min(3, "Shop name must be at least 3 characters"),
    shopDescription: z.string().min(10, "Description must be at least 10 characters"),
    category: z.string(),
    accountType: z.enum(["seller", "both"]),
    allowsPaymentOnDelivery: z.boolean().default(false),
    state: z.string(),
    lga: z.string(),
    address: z.string(),
});

export const SellerVerificationSchema = z.object({
    phoneNumber: z.string().min(7, "Phone number is too short").max(20, "Phone number is too long"),
    nin: z.string().optional().or(z.literal("")),
    bvn: z.string().optional().or(z.literal("")),
    cac: z.string().optional().or(z.literal("")),
    bankAccount: z.object({
        accountNumber: z.string().length(10, "Account number must be 10 digits"),
        bankName: z.string().min(2, "Bank name is required"),
        accountName: z.string().min(2, "Account name is required"),
        bankCode: z.string().min(2, "Bank code is required"),
    }),
    address: z.object({
        street: z.string().min(2, "Street address is required"),
        city: z.string().min(2, "City is required"),
        state: z.string().min(2, "State is required"),
        lga: z.string().min(2, "LGA is required"),
        country: z.string().default("Nigeria"),
    }),
});
