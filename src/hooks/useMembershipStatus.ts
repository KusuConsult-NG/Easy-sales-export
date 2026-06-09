"use client";

import { useEffect, useState } from "react";
import { doc, collection, query, where, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { COLLECTIONS } from "@/lib/types/firestore";
import { useFirebaseAuthed } from "./useFirebaseAuthed";

/**
 * Real-time Membership Status Guard
 * 
 * Bypasses all Next.js server-side caching to provide immediate UI feedback
 * when an admin approves a member. Connects directly to Firestore via client SDK.
 *  * @param userId - The ID of the current user
 * @param moduleType - The module ID (e.g., 'wave', 'cooperative', 'academy')
 * @param userEmail - The email of the current user (optional fallback)
 */
export function useMembershipStatus(userId: string | undefined, moduleType: string, userEmail?: string) {
    const [status, setStatus] = useState<string>("loading");
    const [data, setData] = useState<any>(null);
    const isAuthed = useFirebaseAuthed(userId);

    useEffect(() => {
        if (!userId) {
            setStatus("unauthenticated");
            return;
        }
        if (!isAuthed) {
            setStatus("loading");
            return;
        }

        // Determine the correct collection based on the module
        let collectionName: string = COLLECTIONS.COOPERATIVE_MEMBERS;
        if (moduleType === "wave") collectionName = COLLECTIONS.WAVE_APPLICATIONS;
        if (moduleType === "academy") collectionName = COLLECTIONS.ACADEMY_APPLICATIONS;
        if (moduleType === "export") collectionName = COLLECTIONS.EXPORT_APPLICATIONS;
        if (moduleType === "farm-nation") collectionName = COLLECTIONS.FARM_NATION_APPLICATIONS;

        let unsubEmail: (() => void) | null = null;
        let unsubDoc: (() => void) | null = null;

        // Primary: query by the `userId` field (modern approach for generated doc IDs)
        const q = query(collection(db, collectionName), where("userId", "==", userId));
        
        const unsubQuery = onSnapshot(q, (querySnap) => {
            if (!querySnap.empty) {
                // Clean up fallback listeners if they exist
                if (unsubDoc) {
                    unsubDoc();
                    unsubDoc = null;
                }
                if (unsubEmail) {
                    unsubEmail();
                    unsubEmail = null;
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
                // Fallback 1: Query by email if available
                if (userEmail && !unsubEmail) {
                    const emailField = (collectionName === COLLECTIONS.COOPERATIVE_MEMBERS)
                        ? "email"
                        : (collectionName === COLLECTIONS.WAVE_APPLICATIONS || 
                           collectionName === COLLECTIONS.EXPORT_APPLICATIONS || 
                           collectionName === COLLECTIONS.FARM_NATION_APPLICATIONS)
                        ? "userEmail"
                        : "personalInfo.email";
                    const emailQ = query(collection(db, collectionName), where(emailField, "==", userEmail.toLowerCase()));
                    
                    unsubEmail = onSnapshot(emailQ, (emailSnap) => {
                        if (!emailSnap.empty) {
                            if (unsubDoc) {
                                unsubDoc();
                                unsubDoc = null;
                            }
                            
                            const docsData = emailSnap.docs.map(d => d.data());
                            docsData.sort((a, b) => {
                                const timeA = a.updatedAt?.toMillis?.() || a.createdAt?.toMillis?.() || 0;
                                const timeB = b.updatedAt?.toMillis?.() || b.createdAt?.toMillis?.() || 0;
                                return timeB - timeA;
                            });
                            const docData = docsData[0];
                            setData(docData);
                            setStatus(docData.status || docData.membershipStatus || "pending");
                        } else {
                            // Fallback 2: Check if document ID is userId (legacy approach)
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
                        console.error(`[useMembershipStatus] Email query listener error for ${moduleType}:`, error);
                    });
                } else if (!userEmail && !unsubDoc) {
                    // No email provided, check document ID directly
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
            if (unsubEmail) {
                unsubEmail();
            }
            if (unsubDoc) {
                unsubDoc();
            }
        };
    }, [userId, isAuthed, moduleType, userEmail]);

    return { status, data, isLoading: status === "loading" };
}
