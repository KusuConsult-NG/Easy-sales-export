import { z } from "zod";
import { SoilQuality } from "@/types/strict";

/**
 * Zod schema for creating a land listing
 */
export const landListingSchema = z.object({
    title: z.string().min(10, "Title must be at least 10 characters").max(200, "Title too long"),
    description: z.string().min(20, "Description must be at least 20 characters").max(2000, "Description too long"),

    location: z.object({
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        address: z.string().min(5, "Address required"),
        city: z.string().min(2, "City required"),
        state: z.string().min(2, "State required"),
        lga: z.string().optional(), // Added for compatibility
    }),

    price: z.number().positive("Price must be positive"),
    size: z.number().positive("Size must be positive"), // in Hectares

    soilQuality: z.nativeEnum(SoilQuality).optional(),
    waterSource: z.enum(["borehole", "river", "rain", "dam", "none"]).optional(),
    category: z.union([z.string(), z.array(z.string())]).optional(),

    availableForSale: z.boolean().optional(),
    availableForRent: z.boolean().optional(),
    availableForLease: z.boolean().optional(),
    type: z.enum(["sale", "rent", "lease"]).optional(),
    escrowAvailable: z.boolean().optional(),

    features: z.array(z.string()),
    images: z.array(z.string().url()).min(1, "At least one image required"),
});

export type LandListingInput = z.infer<typeof landListingSchema>;

/**
 * Farm Nation Listing Schema
 * Matches formatting of PropertyListingInput in server actions
 */
export const farmNationListingSchema = z.object({
    name: z.string().min(5, "Name must be at least 5 characters"),
    description: z.string().min(10, "Description must be at least 10 characters"),
    location: z.string().min(2, "Location address is required"),
    state: z.string().min(2, "State is required"),
    lga: z.string().min(2, "LGA is required"),
    price: z.number().positive("Price must be positive"),
    size: z.number().positive("Size must be positive"),
    type: z.enum(["sale", "rent", "lease"]),
    category: z.union([z.string(), z.array(z.string())]),
    features: z.array(z.string()),
    leaseDuration: z.number().optional(),
});

/**
 * Zod schema for updating land listing
 */
export const landListingUpdateSchema = landListingSchema.partial().extend({
    listingId: z.string().min(1, "Listing ID required"),
});

/**
 * Zod schema for land listing verification (Admin)
 */
export const landVerificationSchema = z.object({
    listingId: z.string().min(1, "Listing ID required"),
    verified: z.boolean(),
    rejectionReason: z.string().optional(),
    notes: z.string().optional(),
});

/**
 * Zod schema for land search filters
 */
export const landSearchSchema = z.object({
    minPrice: z.number().optional(),
    maxPrice: z.number().optional(),
    minSize: z.number().optional(),
    maxSize: z.number().optional(),
    soilQuality: z.nativeEnum(SoilQuality).optional(),
    state: z.string().optional(),
    city: z.string().optional(),
    waterAccess: z.boolean().optional(),
    electricityAccess: z.boolean().optional(),
    roadAccess: z.boolean().optional(),
    status: z.enum(['pending_verification', 'verified', 'rejected']).optional(),
    limit: z.number().optional(),
});

export type LandListingData = z.infer<typeof landListingSchema>;
export type LandListingUpdateData = z.infer<typeof landListingUpdateSchema>;
export type LandVerificationData = z.infer<typeof landVerificationSchema>;
export type LandSearchFilters = z.infer<typeof landSearchSchema>;
