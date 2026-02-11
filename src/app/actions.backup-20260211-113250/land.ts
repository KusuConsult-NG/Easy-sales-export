"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase";
import { collection, query, where, getDocs } from "firebase/firestore";
import type { LandListing } from "@/types/strict";

/**
 * Get verified land listings
 */
export async function getVerifiedLandListings(): Promise<LandListing[]> {
    try {
        const q = query(
            collection(db, "land_listings"),
            where("verificationStatus", "==", "verified")
        );

        const snapshot = await getDocs(q);
        const listings: LandListing[] = [];

        snapshot.forEach((doc) => {
            listings.push({ id: doc.id, ...doc.data() } as LandListing);
        });

        return listings;
    } catch (error) {
        console.error("Error fetching verified listings:", error);
        return [];
    }
}
