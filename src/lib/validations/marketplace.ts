import { z } from "zod";
import { OFFLINE_CHECKOUT_METHODS } from "@/lib/offline-checkout";

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
    /**
     * Declared, because it was collected and then silently discarded.
     *
     * Both product forms gather certifications and both creators parse them out
     * of the request — and this schema did not have the field, so Zod stripped
     * it from `validatedData` and createProductAction wrote a product without
     * them. marketplace/products/[id] has a whole section that renders
     * `product.certifications`, and it could only ever be empty for a product
     * created through the server action.
     *
     * (/api/marketplace/create-product does not run this schema, which is why
     * products from that path DID have certifications — the same
     * two-writers-disagree shape as the status defect.)
     */
    certifications: z.array(z.string()).default([]),
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
    /**
     *   #379 THE VALUES THE WRITERS ACTUALLY WRITE, DERIVED RATHER THAN
     *        RESTATED.
     *
     *        This listed "payment_on_delivery" and NOT "bank_transfer", while
     *        _payment_orders.ts writes both. #334 recorded the disagreement:
     *        three layers, three vocabularies. It has never bitten, because the
     *        live order writer sets no paymentMethod at all and takes the
     *        default below — but both dashboards parse through this schema
     *        inside a try/catch that falls back to the RAW document, so a
     *        bank-transfer order would have skipped validation silently rather
     *        than failing visibly.
     *
     *        Spread from OFFLINE_CHECKOUT_METHODS so the read side cannot drift
     *        from the write side again. Those two are refused at the door today
     *        (#379); rows written before that, and any written if an owner
     *        enables them, still parse.
     */
    paymentMethod: z.enum(["escrow", "wallet", ...OFFLINE_CHECKOUT_METHODS]).default("escrow"),
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
    /**
     *   #443 THE ONLY FIELD IN THIS SCHEMA THAT COULD NOT HEAL, AND THE ONE
     *        THAT TOOK THE BUYER DASHBOARD DOWN.
     *
     *        Every field INSIDE this object has a default. The object itself
     *        had none, so it was the one required key in an otherwise
     *        self-healing schema — and a stored order without it failed the
     *        whole parse. Both order-list actions caught that failure and
     *        returned the RAW document instead, still typed as `Order`, so
     *        `items` arrived undefined and `{order.items.length}` unwound
     *        /marketplace/buyer/dashboard into its error boundary. Seen
     *        happening, in Chromium, against a real stored row.
     *
     *        `.prefault({})` rather than `.default({})`: a default is returned
     *        as written, so `.default({})` would have produced a bare `{}` and
     *        left `deliveryAddress.recipientName` undefined for every healed
     *        row. A prefault is PARSED, so the six defaults below actually
     *        apply.
     */
    deliveryAddress: z.object({
        recipientName: z.string().default("Guest"),
        recipientPhone: z.string().default(""),
        street: z.string().default(""),
        city: z.string().default(""),
        state: z.string().default(""),
        lga: z.string().default(""),
    }).prefault({}),
    buyerConfirmed: z.boolean().default(false),
    buyerConfirmedAt: dateSchema.optional(),
    escrowReleased: z.boolean().default(false),
    escrowReleasedAt: dateSchema.optional(),
    escrowTransactionId: z.string().optional(),
    paymentStatus: z.string().optional(),
    paymentReference: z.string().optional(),
    /**
     *   #443 SIX FIELDS THE APP WRITES AND READS THAT THIS SCHEMA DID NOT
     *        DESCRIBE.
     *
     *        serializeOrder strips an order to this schema on the way to the
     *        browser, which is what keeps the payload bounded (#151, #341).
     *        That only works if the schema is an honest description of the
     *        entity: anything the screens read and the schema omits would
     *        simply vanish. Each of these is read by a screen, and each — bar
     *        one, named below — has a writer.
     *
     *        estimatedDeliveryDate is READ BY THREE ORDER SCREENS AND WRITTEN
     *        BY NOTHING. Recorded, not invented: it is declared optional here
     *        so the strip does not change what those screens see (undefined
     *        before, undefined after). Giving it a real value is a product
     *        decision about who promises a delivery date, not a repair.
     */
    sellerIds: z.array(z.string()).default([]),
    buyerPhone: z.string().optional(),
    trackingNumber: z.string().optional(),
    estimatedDeliveryDate: dateSchema.optional(),
    reviewSubmitted: z.boolean().default(false),
    sellerAmountPaid: z.number().optional(),
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
