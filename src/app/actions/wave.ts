"use server";

import { doc, setDoc, getDoc, collection, addDoc, query, where, getDocs, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { COLLECTIONS } from "@/lib/types/firestore";
import { createAuditLog } from "@/lib/audit-log";

/**
 * WAVE (Women in Agribusiness Ventures & Exports) Actions
 * Female-only enforcement and resource management
 */

export interface WaveResource {
    id?: string;
    title: string;
    description: string;
    category: "document" | "video" | "template" | "guide";
    fileUrl: string;
    fileName: string;
    fileSize: number;
    uploadedAt: Timestamp;
    uploadedBy: string;
    downloads: number;
}

export interface WaveTrainingEvent {
    id?: string;
    title: string;
    description: string;
    instructor: string;
    date: Date;
    duration: string;
    maxParticipants: number;
    currentParticipants: number;
    meetingLink?: string;
    status: "upcoming" | "ongoing" | "completed" | "cancelled";
    createdAt: Timestamp;
}

/**
 * Check if user is eligible for WAVE (female only)
 */
export async function checkWaveEligibilityAction(userId: string): Promise<{
    eligible: boolean;
    reason?: string;
}> {
    try {
        const userRef = doc(db, COLLECTIONS.USERS, userId);
        const userDoc = await getDoc(userRef);

        if (!userDoc.exists()) {
            return { eligible: false, reason: "User not found" };
        }

        const userData = userDoc.data();

        if (userData.gender !== "female") {
            return {
                eligible: false,
                reason: "WAVE program is exclusively for women entrepreneurs"
            };
        }

        return { eligible: true };
    } catch (error) {
        console.error("WAVE eligibility check error:", error);
        return { eligible: false, reason: "Failed to check eligibility" };
    }
}

/**
 * Enroll user in WAVE program
 */
export async function enrollInWaveAction(userId: string): Promise<{
    success: boolean;
    error?: string;
}> {
    try {
        const eligibility = await checkWaveEligibilityAction(userId);

        if (!eligibility.eligible) {
            return { success: false, error: eligibility.reason };
        }

        await setDoc(
            doc(db, "wave_members", userId),
            {
                enrolledAt: Timestamp.now(),
                active: true,
            },
            { merge: true }
        );

        await createAuditLog({
            action: "user_update",
            userId,
            targetType: "wave_enrollment",
        });

        return { success: true };
    } catch (error) {
        console.error("WAVE enrollment error:", error);
        return { success: false, error: "Failed to enroll in WAVE program" };
    }
}

/**
 * Get WAVE resources
 */
export async function getWaveResourcesAction(category?: string): Promise<WaveResource[]> {
    try {
        let q = query(collection(db, "wave_resources"));

        if (category) {
            q = query(q, where("category", "==", category));
        }

        const snapshot = await getDocs(q);

        return snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
        })) as WaveResource[];
    } catch (error) {
        console.error("Failed to fetch WAVE resources:", error);
        return [];
    }
}

/**
 * Get upcoming WAVE training events
 */
export async function getWaveTrainingEventsAction(): Promise<WaveTrainingEvent[]> {
    try {
        const q = query(
            collection(db, "wave_training_events"),
            where("status", "in", ["upcoming", "ongoing"])
        );

        const snapshot = await getDocs(q);

        return snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
        })) as WaveTrainingEvent[];
    } catch (error) {
        console.error("Failed to fetch training events:", error);
        return [];
    }
}

/**
 * Register for training event
 */
export async function registerForTrainingAction(
    userId: string,
    eventId: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const eventRef = doc(db, "wave_training_events", eventId);
        const eventDoc = await getDoc(eventRef);

        if (!eventDoc.exists()) {
            return { success: false, error: "Event not found" };
        }

        const event = eventDoc.data() as WaveTrainingEvent;

        if (event.currentParticipants >= event.maxParticipants) {
            return { success: false, error: "Event is full" };
        }

        await addDoc(collection(db, "wave_training_registrations"), {
            userId,
            eventId,
            registeredAt: Timestamp.now(),
            attended: false,
        });

        await createAuditLog({
            action: "user_update",
            userId,
            targetId: eventId,
            targetType: "training_registration",
        });

        return { success: true };
    } catch (error) {
        console.error("Training registration error:", error);
        return { success: false, error: "Failed to register for training" };
    }
}
