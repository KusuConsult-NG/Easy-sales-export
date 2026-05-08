/**
 * Additional WAVE Server Actions for Member Dashboard
 */

"use server";

import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from '@/lib/logger';
import { FieldValue } from "firebase-admin/firestore";
import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session-guard";
import { serializeDoc, serializeDocs } from "@/lib/firestore-serialize";

/**
 * Check if current user is enrolled in WAVE
 */
export async function checkWaveMembershipAction(): Promise<{ error: null, success: true | false; data?: { enrolled: boolean; memberData?: any }; meta?: any; error?: string }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        if (!session?.user?.id) {
            return { error: null, success: true as const, data: { enrolled: false } };
        }

        const memberDoc = await db.collection(COLLECTIONS.WAVE_MEMBERS).doc(session.user.id).get();

        if (!memberDoc.exists || !memberDoc.data()?.active) {
            // Check for admin bypass first
            const { isAdmin } = await import("@/lib/admin-permissions");
            if (isAdmin(session.user.roles)) {
                return {
                    error: null, success: true as const,
                    data: {
                        enrolled: true,
                        memberData: serializeDoc(session.user.id, {
                            name: session.user.name || "Administrator",
                            email: session.user.email,
                            roles: session.user.roles,
                            active: true,
                            status: "approved",
                            enrolledAt: new Date(),
                        })
                    }
                };
            }

            // Auto-Healing: If user has role but no doc, create/reactivate it
            // This handles cases where registration succeeded (role assigned) but doc creation failed
            // or environment mismatch caused data loss
            const hasRole = session.user.roles?.includes("wave_participant");

            if (hasRole) {
                logger.info(`[Auto-Heal] Creating missing wave_members doc for ${session.user.id}`);
                const now = new Date();
                const memberData = {
                    userId: session.user.id,
                    email: session.user.email,
                    name: session.user.name || "WAVE Participant",
                    roles: ["wave_participant"],
                    active: true,
                    status: "approved",
                    enrolledAt: now,
                    lastHealedAt: now,
                    createdAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp(),
                };

                await db.collection(COLLECTIONS.WAVE_MEMBERS).doc(session.user.id).set(memberData, { merge: true });

                return {
                    error: null, success: true as const,
                    data: {
                        enrolled: true,
                        memberData: serializeDoc(session.user.id, memberData)
                    }
                };
            }

            return { error: null, success: true as const, data: { enrolled: false } };
        }

        return {
            error: null, success: true as const,
            data: {
                enrolled: true,
                memberData: serializeDoc(memberDoc.id, memberDoc.data()),
            }
        };
    } catch (error) {
        logger.error("WAVE membership check error:", error);
        return { success: false as const, error: "Failed to check membership" };
    }
}

/**
 * Get member dashboard stats
 */
export async function getWaveMemberStatsAction(): Promise<{ error: null, success: true | false; data?: { stats: any }; meta?: any; error?: string }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false as const, error: "Not authenticated" };
        }

        const membershipResult = await checkWaveMembershipAction();
        if (!membershipResult.success || !membershipResult.data?.enrolled) {
            return { success: false as const, error: "Not enrolled in WAVE" };
        }
        
        const membership = membershipResult.data!;

        // Get resources accessed
        const resourceAccessSnap = await db.collection(COLLECTIONS.WAVE_RESOURCE_ACCESS)
            .where("userId", "==", session.user.id)
            .get();

        // Get training registrations
        const trainingSnap = await db.collection(COLLECTIONS.WAVE_TRAINING_REGISTRATIONS)
            .where("userId", "==", session.user.id)
            .get();

        const trainingsCompleted = trainingSnap.docs.filter(
            (doc) => doc.data().attended === true
        ).length;

        // Calculate days active
        const rawDate = membership.memberData.enrolledAt;
        const enrolledAt = rawDate?.toDate?.() || (rawDate instanceof Date ? rawDate : new Date(rawDate)) || new Date();
        const daysActive = Math.floor(
            (Date.now() - enrolledAt.getTime()) / (1000 * 60 * 60 * 24)
        );

        return {
            error: null, success: true as const,
            data: {
                stats: {
                    resourcesAccessed: resourceAccessSnap.size,
                    trainingsRegistered: trainingSnap.size,
                    trainingsCompleted,
                    daysActive,
                }
            },
        };
    } catch (error) {
        logger.error("Failed to get member stats:", error);
        return { success: false as const, error: "Failed to fetch stats" };
    }
}

/**
 * Track resource access
 */
export async function trackResourceAccessAction(resourceId: string): Promise<{ error: null, success: true | false; data?: any; meta?: any; error?: string }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false as const, error: "Not authenticated" };
        }

        // Check if already accessed
        const accessSnap = await db.collection(COLLECTIONS.WAVE_RESOURCE_ACCESS)
            .where("userId", "==", session.user.id)
            .where("resourceId", "==", resourceId)
            .get();

        if (accessSnap.empty) {
            // First time access
            await db.collection(COLLECTIONS.WAVE_RESOURCE_ACCESS).add({
                userId: session.user.id,
                resourceId,
                accessedAt: new Date(),
                accessCount: 1,
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
            });
        } else {
            // Increment access count
            const accessDoc = accessSnap.docs[0];
            await accessDoc.ref.update({
                accessCount: FieldValue.increment(1),
                lastAccessedAt: new Date(),
                updatedAt: FieldValue.serverTimestamp(),
            });
        }

        // Increment resource downloads
        await db.collection(COLLECTIONS.WAVE_RESOURCES).doc(resourceId).update({
            downloads: FieldValue.increment(1),
        });

        return { error: null, success: true };
    } catch (error) {
        logger.error("Failed to track resource access:", error);
        return { success: false as const, error: "Failed to track access" };
    }
}

/**
 * Get user's training registrations
 */
export async function getUserTrainingRegistrationsAction(): Promise<{ error: null, success: true | false; data?: { registrations: any[] }; meta?: any; error?: string }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false as const, error: "Not authenticated" };
        }

        const snap = await db.collection(COLLECTIONS.WAVE_TRAINING_REGISTRATIONS)
            .where("userId", "==", session.user.id)
            .get();

        const registrations = serializeDocs(snap.docs);

        return { error: null, success: true as const, data: { registrations } };
    } catch (error) {
        logger.error("Failed to get registrations:", error);
        return { success: false as const, error: "Failed to fetch registrations" };
    }
}
