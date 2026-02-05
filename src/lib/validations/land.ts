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
    }),

    acreage: z.number().min(0.1, "Acreage must be at least 0.1").max(10000, "Acreage too large"),
    soilQuality: z.nativeEnum(SoilQuality),
    price: z.number().min(1000, "Price must be at least ₦1,000").max(1000000000, "Price too high"),

    waterAccess: z.boolean(),
    electricityAccess: z.boolean(),
    roadAccess: z.boolean(),

    images: z.array(z.string().url()).min(1, "At least one image required").max(10, "Maximum 10 images"),
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
    minAcreage: z.number().optional(),
    maxAcreage: z.number().optional(),
    soilQuality: z.nativeEnum(SoilQuality).optional(),
    state: z.string().optional(),
    city: z.string().optional(),
    waterAccess: z.boolean().optional(),
    electricityAccess: z.boolean().optional(),
    roadAccess: z.boolean().optional(),
    status: z.enum(['pending_verification', 'verified', 'rejected']).optional(),
});

export type LandListingData = z.infer<typeof landListingSchema>;
export type LandListingUpdateData = z.infer<typeof landListingUpdateSchema>;
export type LandVerificationData = z.infer<typeof landVerificationSchema>;
export type LandSearchFilters = z.infer<typeof landSearchSchema>;
