/**
 * Additional WAVE Server Actions for Member Dashboard
 */

"use server";

import { doc, getDoc, collection, query, where, getDocs, updateDoc, increment, addDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { auth } from "@/lib/auth";

/**
 * Check if current user is enrolled in WAVE
 */
export async function checkWaveMembershipAction(): Promise<{
    enrolled: boolean;
    memberData?: any;
}> {
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return { enrolled: false };
        }

        const memberRef = doc(db, "wave_members", session.user.id);
        const memberDoc = await getDoc(memberRef);

        if (!memberDoc.exists() || !memberDoc.data().active) {
            return { enrolled: false };
        }

        return {
            enrolled: true,
            memberData: {
                id: memberDoc.id,
                ...memberDoc.data(),
            },
        };
    } catch (error) {
        console.error("WAVE membership check error:", error);
        return { enrolled: false };
    }
}

/**
 * Get member dashboard stats
 */
export async function getWaveMemberStatsAction(): Promise<{
    success: boolean;
    stats?: {
        resourcesAccessed: number;
        trainingsRegistered: number;
        trainingsCompleted: number;
        daysActive: number;
    };
    error?: string;
}> {
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return { success: false, error: "Not authenticated" };
        }

        const membership = await checkWaveMembershipAction();
        if (!membership.enrolled) {
            return { success: false, error: "Not enrolled in WAVE" };
        }

        // Get resources accessed
        const resourceAccessQuery = query(
            collection(db, "wave_resource_access"),
            where("userId", "==", session.user.id)
        );
        const resourceAccessSnap = await getDocs(resourceAccessQuery);

        // Get training registrations
        const trainingQuery = query(
            collection(db, "wave_training_registrations"),
            where("userId", "==", session.user.id)
        );
        const trainingSnap = await getDocs(trainingQuery);

        const trainingsCompleted = trainingSnap.docs.filter(
            (doc) => doc.data().attended === true
        ).length;

        // Calculate days active
        const enrolledAt = membership.memberData.enrolledAt.toDate();
        const daysActive = Math.floor(
            (Date.now() - enrolledAt.getTime()) / (1000 * 60 * 60 * 24)
        );

        return {
            success: true,
            stats: {
                resourcesAccessed: resourceAccessSnap.size,
                trainingsRegistered: trainingSnap.size,
                trainingsCompleted,
                daysActive,
            },
        };
    } catch (error) {
        console.error("Failed to get member stats:", error);
        return { success: false, error: "Failed to fetch stats" };
    }
}

/**
 * Track resource access
 */
export async function trackResourceAccessAction(resourceId: string): Promise<{
    success: boolean;
    error?: string;
}> {
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return { success: false, error: "Not authenticated" };
        }

        // Check if already accessed
        const accessQuery = query(
            collection(db, "wave_resource_access"),
            where("userId", "==", session.user.id),
            where("resourceId", "==", resourceId)
        );
        const accessSnap = await getDocs(accessQuery);

        if (accessSnap.empty) {
            // First time access
            await addDoc(collection(db, "wave_resource_access"), {
                userId: session.user.id,
                resourceId,
                accessedAt: new Date(),
                accessCount: 1,
            });
        } else {
            // Increment access count
            const accessDoc = accessSnap.docs[0];
            await updateDoc(doc(db, "wave_resource_access", accessDoc.id), {
                accessCount: increment(1),
                lastAccessedAt: new Date(),
            });
        }

        // Increment resource downloads
        await updateDoc(doc(db, "wave_resources", resourceId), {
            downloads: increment(1),
        });

        return { success: true };
    } catch (error) {
        console.error("Failed to track resource access:", error);
        return { success: false, error: "Failed to track access" };
    }
}

/**
 * Get user's training registrations
 */
export async function getUserTrainingRegistrationsAction(): Promise<{
    success: boolean;
    registrations?: any[];
    error?: string;
}> {
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return { success: false, error: "Not authenticated" };
        }

        const q = query(
            collection(db, "wave_training_registrations"),
            where("userId", "==", session.user.id)
        );
        const snap = await getDocs(q);

        const registrations = snap.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
        }));

        return { success: true, registrations };
    } catch (error) {
        console.error("Failed to get registrations:", error);
        return { success: false, error: "Failed to fetch registrations" };
    }
}
