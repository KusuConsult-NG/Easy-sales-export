"use client";

import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { COLLECTIONS } from "@/lib/types/firestore";

/**
 * Real-time Membership Status Guard
 * 
 * Bypasses all Next.js server-side caching to provide immediate UI feedback
 * when an admin approves a member. Connects directly to Firestore via client SDK.
 * 
 * @param userId - The ID of the current user
 * @param moduleType - The module ID (e.g., 'wave', 'cooperative', 'academy')
 */
export function useMembershipStatus(userId: string | undefined, moduleType: string) {
    const [status, setStatus] = useState<string>("loading");
    const [data, setData] = useState<any>(null);

    useEffect(() => {
        if (!userId) {
            setStatus("unauthenticated");
            return;
        }

        // Determine the correct collection based on the module
        let collectionName = COLLECTIONS.COOPERATIVE_MEMBERS;
        if (moduleType === "wave") collectionName = COLLECTIONS.WAVE_APPLICATIONS;
        if (moduleType === "academy") collectionName = COLLECTIONS.ACADEMY_APPLICATIONS;
        if (moduleType === "export") collectionName = COLLECTIONS.EXPORT_APPLICATIONS;
        if (moduleType === "farm-nation") collectionName = COLLECTIONS.FARM_NATION_APPLICATIONS;

        // Note: For some modules, the document ID is the userId, for others it might be separate.
        // Most modules in this Hub use userId as the primary key for membership/application records.
        const docRef = doc(db, collectionName, userId);

        const unsub = onSnapshot(docRef, (docSnap) => {
            if (docSnap.exists()) {
                const docData = docSnap.data();
                setData(docData);
                // Handle different status field names across modules
                setStatus(docData.status || docData.membershipStatus || "pending");
            } else {
                setStatus("not_found");
            }
        }, (error) => {
            console.error(`[useMembershipStatus] Listener error for ${moduleType}:`, error);
            setStatus("error");
        });

        return () => unsub();
    }, [userId, moduleType]);

    return { status, data, isLoading: status === "loading" };
}
