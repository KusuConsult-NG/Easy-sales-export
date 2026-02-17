import { z } from "zod";

/**
 * Product Creation Schema
 */
export const productSchema = z.object({
    title: z.string().min(3, "Title must be at least 3 characters").max(100, "Title too long"),
    description: z.string().min(10, "Description must be at least 10 characters"),
    category: z.string().min(1, "Category is required"),

    // Pricing
    retailPrice: z.number().positive("Retail price must be positive"),
    bulkPrice: z.number().positive("Bulk price must be positive").optional(),
    exportPrice: z.number().positive("Export price must be positive").optional(),

    // Quantities & Unit
    availableQuantity: z.number().int().nonnegative("Available quantity cannot be negative"),
    minimumOrderQuantity: z.number().int().positive("Minimum order quantity must be at least 1"),
    bulkMinQuantity: z.number().int().positive().optional(),
    exportMinQuantity: z.number().int().positive().optional(),
    unit: z.string().min(1, "Unit is required (e.g. kg, bags)"),

    // Location
    state: z.string().min(2, "State is required"),
    lga: z.string().min(2, "LGA is required"),

    // Delivery
    deliveryMethod: z.string().min(1, "Delivery method required"), // "pickup" | "delivery" | "both"
    estimatedDeliveryDays: z.number().int().nonnegative().optional(),

    // Verification
    certifications: z.array(z.string()).optional(),

    // Flags
    bulkAvailable: z.boolean().optional(),
    exportReady: z.boolean().optional(),

    // Media (URLs handled by uploader, but we validate existence here if passed as string array, 
    // though the action handles files. This schema validates the METADATA).
    videoUrl: z.string().url("Invalid video URL").optional().or(z.literal("")),
});

export type ProductInput = z.infer<typeof productSchema>;
