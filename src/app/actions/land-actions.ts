"use server";

import { z } from "zod";
import { collection, addDoc, updateDoc, doc, getDocs, query, where, orderBy, serverTimestamp, Timestamp, GeoPoint } from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
    landListingSchema,
    landListingUpdateSchema,
    landVerificationSchema,
    landSearchSchema,
    type LandListingData,
    type LandSearchFilters
} from "@/lib/validations/land";
import { AuditActionType, type LandListing } from "@/types/strict";
import { createAuditLog } from "@/lib/audit-logger";
import { auth } from "@/lib/auth";

/**
 * Create a new land listing
 */
export async function createLandListing(
    data: z.infer<typeof landListingSchema>
) {
    const session = await auth();
    if (!session) {
        return { success: false, error: "Unauthorized" };
    }

    try {
        const validated = landListingSchema.parse(data);

        // Create GeoPoint for Firestore geolocation
        const geoPoint = new GeoPoint(validated.location.lat, validated.location.lng);

        // Create land listing in Firestore
        const listingRef = await addDoc(collection(db, 'land_listings'), {
            ...validated,
            location: {
                ...validated.location,
                geopoint: geoPoint, // For geospatial queries
            },
            ownerId: session.user.id,
            status: 'pending_verification',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            verifiedAt: null,
            verifiedBy: null,
            rejectionReason: null,
        });

        // Audit log
        await createAuditLog({
            userId: session.user.id,
            actionType: AuditActionType.CONTENT_APPROVE, // Can add LAND_CREATE to enum
            resourceId: listingRef.id,
            resourceType: 'land_listing',
            metadata: {
                title: validated.title,
                acreage: validated.acreage,
                price: validated.price,
                location: `${validated.location.city}, ${validated.location.state}`,
            },
        });

        return {
            success: true,
            listingId: listingRef.id,
            userId: session.user.id,
        };
    } catch (error) {
        if (error instanceof z.ZodError) {
            return {
                success: false,
                error: "Validation error",
                details: error.errors.map(e => e.message),
            };
        }
        return { success: false, error: "Failed to create land listing" };
    }
}

/**
 * Get all land listings with optional filters
 */
export async function getLandListings(filters?: z.infer<typeof landSearchSchema>) {
    try {
        let listingsQuery = query(
            collection(db, 'land_listings'),
            orderBy('createdAt', 'desc')
        );

        // Apply status filter if provided
        if (filters?.status) {
            listingsQuery = query(
                collection(db, 'land_listings'),
                where('status', '==', filters.status),
                orderBy('createdAt', 'desc')
            );
        }

        const snapshot = await getDocs(listingsQuery);

        let listings = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                ...data,
                location: {
                    ...data.location,
                    lat: data.location.geopoint?.latitude || data.location.lat,
                    lng: data.location.geopoint?.longitude || data.location.lng,
                },
                createdAt: (data.createdAt as Timestamp)?.toDate() || new Date(),
                updatedAt: (data.updatedAt as Timestamp)?.toDate() || new Date(),
                verifiedAt: data.verifiedAt ? (data.verifiedAt as Timestamp).toDate() : null,
            } as LandListing;
        });

        // Apply client-side filters
        if (filters) {
            listings = listings.filter(listing => {
                if (filters.minPrice && listing.price < filters.minPrice) return false;
                if (filters.maxPrice && listing.price > filters.maxPrice) return false;
                if (filters.minAcreage && listing.acreage < filters.minAcreage) return false;
                if (filters.maxAcreage && listing.acreage > filters.maxAcreage) return false;
                if (filters.soilQuality && listing.soilQuality !== filters.soilQuality) return false;
                if (filters.state && listing.location.state !== filters.state) return false;
                if (filters.city && listing.location.city !== filters.city) return false;
                if (filters.waterAccess !== undefined && listing.waterAccess !== filters.waterAccess) return false;
                if (filters.electricityAccess !== undefined && listing.electricityAccess !== filters.electricityAccess) return false;
                if (filters.roadAccess !== undefined && listing.roadAccess !== filters.roadAccess) return false;
                return true;
            });
        }

        return {
            success: true,
            listings,
        };
    } catch (error) {
        return { success: false, error: "Failed to fetch land listings", listings: [] };
    }
}

/**
 * Get verified land listings only (public view)
 */
export async function getVerifiedLandListings(filters?: z.infer<typeof landSearchSchema>) {
    return getLandListings({ ...filters, status: 'verified' });
}

/**
 * Get a specific land listing by ID
 */
export async function getLandListing(listingId: string) {
    try {
        const listingsQuery = query(
            collection(db, 'land_listings'),
            where('__name__', '==', listingId)
        );

        const snapshot = await getDocs(listingsQuery);

        if (snapshot.empty) {
            return { success: false, error: "Listing not found", listing: null };
        }

        const data = snapshot.docs[0].data();

        const listing: LandListing = {
            id: snapshot.docs[0].id,
            ...data,
            location: {
                ...data.location,
                lat: data.location.geopoint?.latitude || data.location.lat,
                lng: data.location.geopoint?.longitude || data.location.lng,
            },
            createdAt: (data.createdAt as Timestamp)?.toDate() || new Date(),
            updatedAt: (data.updatedAt as Timestamp)?.toDate() || new Date(),
            verifiedAt: data.verifiedAt ? (data.verifiedAt as Timestamp).toDate() : null,
        } as LandListing;

        return {
            success: true,
            listing,
        };
    } catch (error) {
        return { success: false, error: "Failed to fetch listing", listing: null };
    }
}

/**
 * Get user's own land listings
 */
export async function getMyLandListings() {
    const session = await auth();
    if (!session) {
        return { success: false, error: "Unauthorized", listings: [] };
    }

    try {
        const listingsQuery = query(
            collection(db, 'land_listings'),
            where('ownerId', '==', session.user.id),
            orderBy('createdAt', 'desc')
        );

        const snapshot = await getDocs(listingsQuery);

        const listings = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                ...data,
                location: {
                    ...data.location,
                    lat: data.location.geopoint?.latitude || data.location.lat,
                    lng: data.location.geopoint?.longitude || data.location.lng,
                },
                createdAt: (data.createdAt as Timestamp)?.toDate() || new Date(),
                updatedAt: (data.updatedAt as Timestamp)?.toDate() || new Date(),
                verifiedAt: data.verifiedAt ? (data.verifiedAt as Timestamp).toDate() : null,
            } as LandListing;
        });

        return {
            success: true,
            listings,
        };
    } catch (error) {
        return { success: false, error: "Failed to fetch your listings", listings: [] };
    }
}

/**
 * Update a land listing (owner only)
 */
export async function updateLandListing(
    data: z.infer<typeof landListingUpdateSchema>
) {
    const session = await auth();
    if (!session) {
        return { success: false, error: "Unauthorized" };
    }

    try {
        const validated = landListingUpdateSchema.parse(data);

        // Check ownership
        const listingResult = await getLandListing(validated.listingId);
        if (!listingResult.success || !listingResult.listing) {
            return { success: false, error: "Listing not found" };
        }

        if (listingResult.listing.ownerId !== session.user.id && session.user.role !== 'admin') {
            return { success: false, error: "Unauthorized to edit this listing" };
        }

        const { listingId, ...updateData } = validated;

        // If location is updated, create new GeoPoint
        if (updateData.location) {
            const geoPoint = new GeoPoint(updateData.location.lat, updateData.location.lng);
            updateData.location = {
                ...updateData.location,
                geopoint: geoPoint,
            } as any;
        }

        await updateDoc(doc(db, 'land_listings', listingId), {
            ...updateData,
            updatedAt: serverTimestamp(),
            // Reset to pending if content changed
            status: 'pending_verification',
        });

        // Audit log
        await createAuditLog({
            userId: session.user.id,
            actionType: AuditActionType.CONTENT_APPROVE,
            resourceId: listingId,
            resourceType: 'land_listing',
            metadata: {
                action: 'update',
            },
        });

        return { success: true, userId: session.user.id };
    } catch (error) {
        if (error instanceof z.ZodError) {
            return {
                success: false,
                error: "Validation error",
                details: error.errors.map(e => e.message),
            };
        }
        return { success: false, error: "Failed to update listing" };
    }
}

/**
 * Verify or reject a land listing (Admin only)
 */
export async function verifyLandListing(
    data: z.infer<typeof landVerificationSchema>
) {
    const session = await auth();
    if (!session || session.user.role !== 'admin') {
        return { success: false, error: "Unauthorized - Admin only" };
    }

    try {
        const validated = landVerificationSchema.parse(data);

        const updateData: Record<string, unknown> = {
            status: validated.verified ? 'verified' : 'rejected',
            verifiedBy: session.user.id,
            verifiedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
        };

        if (validated.notes) {
            updateData.verificationNotes = validated.notes;
        }

        if (!validated.verified && validated.rejectionReason) {
            updateData.rejectionReason = validated.rejectionReason;
        }

        await updateDoc(doc(db, 'land_listings', validated.listingId), updateData);

        // Audit log
        await createAuditLog({
            userId: session.user.id,
            actionType: validated.verified ? AuditActionType.CONTENT_APPROVE : AuditActionType.CONTENT_REJECT,
            resourceId: validated.listingId,
            resourceType: 'land_listing',
            metadata: {
                verified: validated.verified,
                notes: validated.notes,
                rejectionReason: validated.rejectionReason,
            },
        });

        return { success: true, userId: session.user.id };
    } catch (error) {
        if (error instanceof z.ZodError) {
            return {
                success: false,
                error: "Validation error",
                details: error.errors.map(e => e.message),
            };
        }
        return { success: false, error: "Failed to verify listing" };
    }
}

/**
 * Delete a land listing (owner or admin only)
 */
export async function deleteLandListing(listingId: string) {
    const session = await auth();
    if (!session) {
        return { success: false, error: "Unauthorized" };
    }

    try {
        // Check ownership
        const listingResult = await getLandListing(listingId);
        if (!listingResult.success || !listingResult.listing) {
            return { success: false, error: "Listing not found" };
        }

        if (listingResult.listing.ownerId !== session.user.id && session.user.role !== 'admin') {
            return { success: false, error: "Unauthorized to delete this listing" };
        }

        // Soft delete by updating status
        await updateDoc(doc(db, 'land_listings', listingId), {
            status: 'deleted',
            deletedAt: serverTimestamp(),
            deletedBy: session.user.id,
            updatedAt: serverTimestamp(),
        });

        // Audit log
        await createAuditLog({
            userId: session.user.id,
            actionType: AuditActionType.CONTENT_REJECT,
            resourceId: listingId,
            resourceType: 'land_listing',
            metadata: {
                action: 'delete',
            },
        });

        return { success: true, userId: session.user.id };
    } catch (error) {
        return { success: false, error: "Failed to delete listing" };
    }
}

/**
 * Get land listing statistics (Admin only)
 */
export async function getLandStatistics() {
    const session = await auth();
    if (!session || session.user.role !== 'admin') {
        return {
            success: false,
            error: "Unauthorized - Admin only",
            stats: null
        };
    }

    try {
        const snapshot = await getDocs(collection(db, 'land_listings'));

        const stats = {
            total: 0,
            pending: 0,
            verified: 0,
            rejected: 0,
            totalAcreage: 0,
            totalValue: 0,
            averagePrice: 0,
            byState: {} as Record<string, number>,
            bySoilQuality: {} as Record<string, number>,
        };

        snapshot.docs.forEach(doc => {
            const data = doc.data();

            // Skip deleted
            if (data.status === 'deleted') return;

            stats.total++;
            stats.totalAcreage += data.acreage || 0;
            stats.totalValue += data.price || 0;

            if (data.status === 'pending_verification') stats.pending++;
            else if (data.status === 'verified') stats.verified++;
            else if (data.status === 'rejected') stats.rejected++;

            // By state
            const state = data.location?.state || 'Unknown';
            stats.byState[state] = (stats.byState[state] || 0) + 1;

            // By soil quality
            const quality = data.soilQuality || 'Unknown';
            stats.bySoilQuality[quality] = (stats.bySoilQuality[quality] || 0) + 1;
        });

        if (stats.total > 0) {
            stats.averagePrice = Math.round(stats.totalValue / stats.total);
        }

        return {
            success: true,
            stats,
        };
    } catch (error) {
        return { success: false, error: "Failed to fetch statistics", stats: null };
    }
}
