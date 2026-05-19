/**
 * Marketplace Domain Constants
 *
 * @easy-sales/marketplace/constants
 */

export const MARKETPLACE_CONFIG = {
    platformFeePercent: 5, // 5% platform fee
    processingTimeDays: "2-3", // "2-3 business days"
} as const;

export const PRODUCT_CATEGORIES = [
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
    "other"
] as const;

export const ORDER_STATUSES = [
    "pending_payment",
    "payment_received",
    "confirmed",
    "processing",
    "shipped",
    "delivered",
    "completed",
    "cancelled",
    "disputed"
] as const;

export const ESCROW_STATUSES = [
    "pending",
    "funded",
    "in_transit",
    "delivered",
    "released",
    "refunded",
    "disputed",
    "cancelled",
    "completed"
] as const;
