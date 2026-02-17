"use server";

import { auth } from "@/lib/auth";
import { logger } from '@/lib/logger';
import { db } from "@/lib/firebase-admin";
import type { LandListing } from "@/types/strict";

/**
 * Get verified land listings
 */
export async function getVerifiedLandListings(): Promise<LandListing[]> {
    try {
        const q = db.collection("land_listings")
            .where("verificationStatus", "==", "verified")
            .limit(100); // Protection: Limit map pins to 100 for now

        const snapshot = await q.get();
        const listings: LandListing[] = [];

        snapshot.forEach((doc) => {
            listings.push({ id: doc.id, ...doc.data() } as LandListing);
        });

        return listings;
    } catch (error) {
        logger.error("Error fetching verified listings:", error);
        return [];
    }
}
