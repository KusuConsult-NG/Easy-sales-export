/**
 * Farm Nation Types
 * 
 * Domain: Farm Nation (Land, Agriculture)
 * Part of the Platform Type Isolation — Phase 0 Migration
 */

export interface LandListing {
    id: string;
    title: string;
    description: string;
    location: string;
    size: string;
    price: number;
    userId: string;
    verified: boolean;
    createdAt: Date;
}
