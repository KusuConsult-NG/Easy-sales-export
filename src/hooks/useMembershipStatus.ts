"use client";

import { useEffect, useState } from "react";
import { doc, collection, query, where, onSnapshot } from "firebase/firestore";
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
        let collectionName: string = COLLECTIONS.COOPERATIVE_MEMBERS;
        if (moduleType === "wave") collectionName = COLLECTIONS.WAVE_APPLICATIONS;
        if (moduleType === "academy") collectionName = COLLECTIONS.ACADEMY_APPLICATIONS;
        if (moduleType === "export") collectionName = COLLECTIONS.EXPORT_APPLICATIONS;
        if (moduleType === "farm-nation") collectionName = COLLECTIONS.FARM_NATION_APPLICATIONS;

        let unsubDoc: (() => void) | null = null;

        // Primary: query by the `userId` field (modern approach for generated doc IDs)
        const q = query(collection(db, collectionName), where("userId", "==", userId));
        
        const unsubQuery = onSnapshot(q, (querySnap) => {
            if (!querySnap.empty) {
                // Clean up fallback listener if it exists
                if (unsubDoc) {
                    unsubDoc();
                    unsubDoc = null;
                }
                // Sort by createdAt desc if multiple, otherwise just take the first
                const docsData = querySnap.docs.map(d => d.data());
                docsData.sort((a, b) => {
                    const timeA = a.updatedAt?.toMillis?.() || a.createdAt?.toMillis?.() || 0;
                    const timeB = b.updatedAt?.toMillis?.() || b.createdAt?.toMillis?.() || 0;
                    return timeB - timeA;
                });
                
                const docData = docsData[0];
                setData(docData);
                setStatus(docData.status || docData.membershipStatus || "pending");
            } else {
                // Fallback: check if the document ID is the userId (legacy approach)
                // Only register fallback if not already active
                if (!unsubDoc) {
                    unsubDoc = onSnapshot(doc(db, collectionName, userId), (docSnap) => {
                        if (docSnap.exists()) {
                            const docData = docSnap.data();
                            setData(docData);
                            setStatus(docData.status || docData.membershipStatus || "pending");
                        } else {
                            setStatus("not_found");
                        }
                    }, (error) => {
                        console.error(`[useMembershipStatus] Doc listener error for ${moduleType}:`, error);
                        setStatus("error");
                    });
                }
            }
        }, (error) => {
            console.error(`[useMembershipStatus] Query listener error for ${moduleType}:`, error);
            setStatus("error");
        });

        return () => {
            unsubQuery();
            if (unsubDoc) {
                unsubDoc();
            }
        };
    }, [userId, moduleType]);

    return { status, data, isLoading: status === "loading" };
}
