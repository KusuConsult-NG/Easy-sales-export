/**
 * Additional WAVE Server Actions for Member Dashboard
 */

"use server";

import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { ownedProfileIds, filterByOwner } from "@/lib/owned-profile-ids";
import { logger } from '@/lib/logger';
import { FieldValue } from "@/lib/firestore-compat";
import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session-guard";
import { serializeDoc, serializeDocs } from "@/lib/firestore-serialize";

import { ActionResponse } from "@/lib/safe-action";
import { isInWaveProgramme } from "@/lib/wave-access";

/**
 * Check if current user is enrolled in WAVE
 */
export async function checkWaveMembershipAction(): Promise<ActionResponse<{ enrolled: boolean; memberData?: any }>> { 
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: true as const, error: null, data: { enrolled: false } };
        }

        const memberDoc = await db.collection(COLLECTIONS.WAVE_MEMBERS).doc(session.user.id).get();

        if (!memberDoc.exists || !memberDoc.data()?.active) { // Check for admin bypass first
            const { isAdmin } = await import("@/lib/admin-permissions");
            if (isAdmin(session.user.roles)) { return { error: null, success: true as const, data: {
                        enrolled: true, memberData: serializeDoc(session.user.id, {
                            name: session.user.name || "Administrator", email: session.user.email, roles: session.user.roles, active: true, status: "approved", enrolledAt: new Date() })
                    }
                };
            }

            // Auto-Healing: If user has role but no doc, create/reactivate it
            // This handles cases where registration succeeded (role assigned) but doc creation failed
            // or environment mismatch caused data loss
            /*
             *   #929 — THE SHARED IN-PROGRAMME LIST, not a fourth copy.
             *
             *   This read `approved || enrolled`. Swept across every writer of
             *   serviceRegistrations.wave.status, nothing has ever written
             *   "enrolled" — so that disjunct could not fire — while "active",
             *   which a legacy row can carry, was missing. The heal exists for
             *   exactly the member whose WAVE_MEMBERS row failed to be created,
             *   and it was declining to heal one shape of her.
             *
             *   The `wave_member` role stays spelled out here: it is this heal's
             *   own legacy spelling, not part of the platform's access rule.
             */
            const hasRole = session.user.roles?.some((r: string) => r === "wave_member")
                || isInWaveProgramme({
                    roles: session.user.roles as string[] | undefined,
                    waveRegStatus: (session.user as any).serviceRegistrations?.wave?.status ?? null,
                });

            if (hasRole) {
                logger.info(`[Auto-Heal] Creating missing wave_members doc for ${session.user.id}`);
                const now = new Date();
                const memberData = { userId: session.user.id,
                    email: session.user.email,
                    name: session.user.name || "WAVE Participant",
                    roles: ["wave_participant"],
                    active: true,
                    status: "approved",
                    enrolledAt: now,
                    lastHealedAt: now,
                    createdAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp() };

                await db.collection(COLLECTIONS.WAVE_MEMBERS).doc(session.user.id).set(memberData, { merge: true });

                return { error: null, success: true as const, data: {
                        enrolled: true, memberData: serializeDoc(session.user.id, memberData)
 }
                };
            }

            return { error: null, success: true as const, data: { enrolled: false } };
        }

        return { error: null, success: true as const, data: {
                enrolled: true, memberData: serializeDoc(memberDoc.id, memberDoc.data()) }
        };
    } catch (error) { logger.error("WAVE membership check error:", error);
        return { success: false as const, error: "Failed to check membership", data: null };
    }
}

/**
 * Get member dashboard stats
 */
export async function getWaveMemberStatsAction(): Promise<ActionResponse<{ stats: { resourcesAccessed: number; trainingsRegistered: number; trainingsCompleted: number; daysActive: number } }>> { 
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        if (!session?.user?.id) { return { success: false as const, error: "Not authenticated", data: null };
        }

        const membershipResult = await checkWaveMembershipAction();
        if (!membershipResult.success || !membershipResult.data?.enrolled) { return { success: false as const, error: "Not enrolled in WAVE", data: null };
        }
        const membership = membershipResult.data!;

        //   Resolved ONCE and handed to both reads. Two resolutions of the
        //   same session id would cost two extra lookups to reach the same
        //   answer, and — as _wv_earnings showed — two chances to diverge.
        const ownedIds = await ownedProfileIds(session.user.id);

        // Get resources accessed
        const resourceAccessSnap = await filterByOwner(
            db.collection(COLLECTIONS.WAVE_RESOURCE_ACCESS), "userId", ownedIds,
        ).get();

        // Get training registrations
        const trainingSnap = await filterByOwner(
            db.collection(COLLECTIONS.WAVE_TRAINING_REGISTRATIONS), "userId", ownedIds,
        ).get();

        /**
         * #302 The counts exclude registrations whose event was cancelled.
         *
         * That is the whole reason the previous fix reached for deletion: a
         * registration against a withdrawn event kept inflating
         * trainingsRegistered. Excluding it here fixes the count without
         * destroying the member's record of having signed up — and attendance
         * still counts, because a training somebody actually attended happened,
         * whatever became of the event afterwards.
         */
        const liveRegistrations = trainingSnap.docs.filter(
            (doc) => doc.data().eventCancelled !== true
        );

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
            error: null, 
            success: true as const, 
            data: { 
                stats: {
                    resourcesAccessed: resourceAccessSnap.size,
                    trainingsRegistered: liveRegistrations.length,
                    trainingsCompleted,
                    daysActive: Math.max(0, daysActive)
                }
            } 
        };
    } catch (error) { logger.error("Failed to get member stats:", error);
        return { success: false as const, error: "Failed to fetch stats", data: null };
    }
}

/**
 * Track resource access
 */
export async function trackResourceAccessAction(resourceId: string): Promise<ActionResponse<null>> { 
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        if (!session?.user?.id) { return { success: false as const, error: "Not authenticated", data: null };
        }

        // The resource has to exist before anything is recorded about it.
        //
        // resourceId came from the caller and was never checked. The counter
        // update below is harmless on its own — the adapter turns update() on a
        // missing document into a logged no-op rather than creating one — but
        // the two access rows were written regardless. So any signed-in user
        // could add unbounded rows to wave_resource_access and to
        // wave_resource_downloads, the collection this file's own comment calls
        // "for access auditing", naming resources that do not exist.
        //
        // An audit trail anyone can fill with invented entries is worth less
        // than one that refuses them.
        const resourceDoc = await db.collection(COLLECTIONS.WAVE_RESOURCES).doc(resourceId).get();
        if (!resourceDoc.exists) {
            return { success: false as const, error: "Resource not found", data: null };
        }

        // Check if already accessed
        //
        //   Widened, and that makes this check STRONGER: it asks whether this
        //   person has already taken this resource, and one person with two
        //   profiles could answer no twice.
        const accessSnap = await filterByOwner(
            db.collection(COLLECTIONS.WAVE_RESOURCE_ACCESS), "userId",
            await ownedProfileIds(session.user.id),
        )
            .where("resourceId", "==", resourceId)
            .get();

        if (accessSnap.empty) { // First time access
            await db.collection(COLLECTIONS.WAVE_RESOURCE_ACCESS).add({
                userId: session.user.id,
                resourceId,
                accessedAt: new Date(),
                accessCount: 1,
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp() });
        } else { // Increment access count
            const accessDoc = accessSnap.docs[0];
            await accessDoc.ref.update({
                accessCount: FieldValue.increment(1),
                lastAccessedAt: new Date(),
                updatedAt: FieldValue.serverTimestamp() });
        }

        // Increment resource downloads
        await db.collection(COLLECTIONS.WAVE_RESOURCES).doc(resourceId).update({ downloads: FieldValue.increment(1) });

        // Log details to new "wave_resource_downloads" collection for access auditing
        await db.collection("wave_resource_downloads").add({
            userId: session.user.id,
            resourceId,
            downloadedAt: FieldValue.serverTimestamp(),
            email: session.user.email || "",
            name: session.user.name || "",
            createdAt: FieldValue.serverTimestamp()
        });

        return { error: null, success: true as const , data: null };
    } catch (error) { logger.error("Failed to track resource access:", error);
        return { success: false as const, error: "Failed to track access", data: null };
    }
}

/**
 * Get user's training registrations
 */
export async function getUserTrainingRegistrationsAction(): Promise<ActionResponse<{ registrations: any[] }>> { 
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        if (!session?.user?.id) { return { success: false as const, error: "Not authenticated", data: null };
        }

        const snap = await filterByOwner(
            db.collection(COLLECTIONS.WAVE_TRAINING_REGISTRATIONS), "userId",
            await ownedProfileIds(session.user.id),
        ).get();

        const registrations = serializeDocs(snap.docs);

        return { error: null, success: true as const, data: { registrations } };
    } catch (error) { logger.error("Failed to get registrations:", error);
        return { success: false as const, error: "Failed to fetch registrations", data: null };
    }
}
