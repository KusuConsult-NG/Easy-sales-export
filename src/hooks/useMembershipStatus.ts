"use client";

import { useEffect, useState } from "react";
import { doc, collection, query, where, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { COLLECTIONS } from "@/lib/types/firestore";
import { useFirebaseAuthed } from "./useFirebaseAuthed";
import { useSession } from "next-auth/react";

const MODULE_TO_REG_KEY: Record<string, string> = {
    wave: "wave",
    academy: "academy",
    export: "export",
    cooperative: "cooperatives",
    cooperatives: "cooperatives",
    "farm-nation": "farmNation",
    farmNation: "farmNation",
    marketplace: "marketplace",
};

/**
 * Real-time Membership Status Guard
 * 
 * Bypasses all Next.js server-side caching to provide immediate UI feedback
 * when an admin approves a member. Connects directly to Firestore via client SDK.
 * 
 * @param userId - The ID of the current user
 * @param moduleType - The module ID (e.g., 'wave', 'cooperative', 'academy')
 * @param userEmail - The email of the current user (optional fallback)
 */
export function useMembershipStatus(userId: string | undefined, moduleType: string, userEmail?: string) {
    const { data: session } = useSession();
    
    // Get the initial/session status if present
    const regKey = MODULE_TO_REG_KEY[moduleType];
    let sessionStatus = session?.user 
        ? (session.user as any)?.serviceRegistrations?.[regKey]?.status 
        : undefined;
    if (regKey === "cooperatives" && !sessionStatus) {
        sessionStatus = (session?.user as any)?.serviceRegistrations?.["cooperative"]?.status;
    }
    if (regKey === "farmNation" && !sessionStatus) {
        sessionStatus = (session?.user as any)?.serviceRegistrations?.["farm_nation"]?.status;
    }

    const [status, setStatus] = useState<string>(() => {
        return sessionStatus || "loading";
    });
    const [data, setData] = useState<any>(null);
    const isAuthed = useFirebaseAuthed(userId);

    // Sync status with session status when it becomes available
    useEffect(() => {
        if (sessionStatus && status === "loading") {
            setStatus(sessionStatus);
        }
    }, [sessionStatus, status]);

    useEffect(() => {
        if (!userId) {
            setStatus("unauthenticated");
            return;
        }
        if (!isAuthed) {
            if (sessionStatus) {
                setStatus(sessionStatus);
            } else {
                setStatus("loading");
            }
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
        let unsubQuery: (() => void) | null = null;

        // ── STEP 1: Direct User Document Listener ───────────────────────────
        // Check users collection first (stale-JWT-safe, never fails with permissions)
        const userDocRef = doc(db, COLLECTIONS.USERS || "users", userId);
        const unsubUser = onSnapshot(userDocRef, (userSnap) => {
            if (userSnap.exists()) {
                const userData = userSnap.data();
                const regKey = MODULE_TO_REG_KEY[moduleType];
                if (regKey) {
                    const serviceRegistrations = userData.serviceRegistrations || {};
                    let registration = serviceRegistrations[regKey];
                    if (regKey === "cooperatives") {
                        registration = serviceRegistrations["cooperatives"] || serviceRegistrations["cooperative"];
                    }
                    if (regKey === "farmNation") {
                        registration = serviceRegistrations["farmNation"] || serviceRegistrations["farm_nation"];
                    }
                    const s = registration?.status;
                    if (s === "approved" || s === "active" || s === "verified" || s === "paid") {
                        setData(registration);
                        setStatus(s);
                        
                        // Clean up other listeners since we confirmed access
                        if (unsubQuery) { unsubQuery(); unsubQuery = null; }
                        if (unsubEmail) { unsubEmail(); unsubEmail = null; }
                        if (unsubDoc) { unsubDoc(); unsubDoc = null; }
                        return;
                    }
                }
            }
            
            // If user doc doesn't confirm approved status, start query-based checks
            if (!unsubQuery) {
                startQueryListeners();
            }
        }, (error) => {
            console.error(`[useMembershipStatus] User doc listener error:`, error);
            if (!unsubQuery) {
                startQueryListeners();
            }
        });

        function startQueryListeners() {
            // Primary: query by the `userId` field (modern approach for generated doc IDs)
            const q = query(collection(db, collectionName), where("userId", "==", userId));
            
            unsubQuery = onSnapshot(q, (querySnap) => {
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
                                startDocFallback();
                            }
                        }, (error) => {
                            console.error(`[useMembershipStatus] Email query listener error for ${moduleType}:`, error);
                            // Fallback if query lacks permissions
                            startDocFallback();
                        });
                    } else if (!userEmail) {
                        startDocFallback();
                    }
                }
            }, (error) => {
                console.error(`[useMembershipStatus] Query listener error for ${moduleType}:`, error);
                setStatus("error");
            });
        }

        function startDocFallback() {
            if (!userId) return;
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

        return () => {
            unsubUser();
            if (unsubQuery) {
                unsubQuery();
            }
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
