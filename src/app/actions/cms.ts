"use server";

import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from '@/lib/logger';
import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session-guard";
import { FieldValue } from "@/lib/firestore-compat";
import { createAdminAuditLog, logAdminAction } from "@/lib/audit-log";
import { isAdmin } from "@/lib/admin-permissions";

/** Helper: verify admin session */
async function requireAdmin(): Promise<{ id: string } | null> { const sessionResult = await requireSession();
    if (!sessionResult.session) return null;
    const { session } = sessionResult;
    if (!session?.user?.id || !isAdmin(session.user.roles)) { return null;
    }
    return { id: session.user.id };
}

/**
 * Content Management System (CMS)
 * Announcements, Banners, notifications
 */

export interface Announcement { id?: string;
    title: string;
    content: string;
    type: "info" | "warning" | "success" | "emergency";
    targetAudience: "all" | "members" | "exporters" | "admins" | "vendors";
    priority: "low" | "medium" | "high" | "urgent";
    publishedAt: Date | any;
    expiresAt?: Date | any;
    createdBy: string;
    createdAt: Date | any;
    active: boolean; }

export interface Banner { id?: string;
    title: string;
    message: string;
    type: "promotional" | "informational" | "alert";
    link?: string;
    buttonText?: string;
    imageUrl?: string;
    startDate: Date;
    endDate: Date;
    position: "top" | "bottom" | "popup";
    createdBy: string;
    createdAt: Date | any;
    active: boolean; }

/** The audiences an announcement may be addressed to. */
const AUDIENCES = ["all", "members", "exporters", "admins", "vendors"] as const;
type AudienceName = (typeof AUDIENCES)[number];

/**
 * Which audiences a caller actually belongs to.
 *
 * "all" is in the set unconditionally, including for a caller with no session —
 * a public announcement on the landing page is the point of this endpoint, and
 * action-auth-baseline.json records leaving it unauthenticated as a decision.
 *
 * Everything else is decided by the caller's roles, because the alternative is
 * letting the caller decide, which is what this replaced.
 */
function entitledAudiences(roles: string[] | undefined): Set<AudienceName> {
    const entitled = new Set<AudienceName>(["all"]);
    const held = roles ?? [];

    if (isAdmin(held)) entitled.add("admins");
    if (held.some((r) => r === "seller" || r === "marketplace_seller")) entitled.add("vendors");
    if (held.some((r) => r === "export_participant" || r === "export_admin")) entitled.add("exporters");
    if (held.some((r) => r === "cooperative_member" || r === "cooperative_admin")) entitled.add("members");

    return entitled;
}

/**
 * Create announcement
 */
export async function createAnnouncementAction(data: { title: string;
    content: string;
    type: "info" | "warning" | "success" | "emergency";
    targetAudience: "all" | "members" | "exporters" | "admins" | "vendors";
    priority: "low" | "medium" | "high" | "urgent";
    expiresAt?: string;
    adminId: string; }): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> { try {
        const admin = await requireAdmin();
        if (!admin) return { success: false as const, error: "Unauthorized: Admin access required", data: null };

        // These are TypeScript unions on a server action, which means they are
        // erased before the request arrives — the parameter types constrain the
        // admin page's callsite and nothing else.
        //
        // For targetAudience that matters beyond tidiness: it is the field the
        // read path now decides entitlement from, and an unrecognised value
        // there is an announcement no one is ever entitled to see. Rejecting it
        // here is better than writing a notice that silently never appears.
        if (!AUDIENCES.includes(data.targetAudience as AudienceName)) {
            return { success: false as const, error: "Unknown target audience", data: null };
        }
        if (data.expiresAt !== undefined && Number.isNaN(new Date(data.expiresAt).getTime())) {
            return { success: false as const, error: "Expiry date is not a valid date", data: null };
        }

        const announcement: Omit<Announcement, "id"> = { title: data.title,
            content: data.content,
            type: data.type,
            targetAudience: data.targetAudience,
            priority: data.priority,
            publishedAt: FieldValue.serverTimestamp(),
            expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined,
            createdBy: admin.id,
            createdAt: FieldValue.serverTimestamp(),
            active: true };

        const docRef = await db.collection(COLLECTIONS.ANNOUNCEMENTS).add(announcement);

        await logAdminAction(
            "announcement_created",
            admin.id,
            docRef.id,
            "announcement"
        );

        return { error: null, success: true as const, announcementId: docRef.id , data: null };
    } catch (error) { logger.error("Announcement creation error:", error);
        return { success: false as const, error: "Failed to create announcement", data: null };
    }
}

/**
 * Get active announcements
 */
export async function getActiveAnnouncementsAction(
    targetAudience: string = "all"
): Promise<Announcement[]> { try {
        // The audience was whichever one the caller asked for.
        //
        // `targetAudience` is an access control — the admin UI offers "admins"
        // in its dropdown, so announcements addressed to staff alone genuinely
        // exist — and the filter below decided membership from the ARGUMENT:
        //
        //     if (a.targetAudience !== "all" && a.targetAudience !== targetAudience)
        //
        // Passing "admins" therefore returned every admin-only announcement, and
        // this endpoint has no session at all. Anyone, signed in or not, could
        // read internal notices by naming the audience they wanted to be in.
        //
        // Staying public is right and is a recorded decision; what was wrong is
        // that the segment was self-declared. Entitlement now comes from the
        // caller's roles, and the parameter is kept as a NARROWING filter only,
        // so it can no longer widen what is returned. Both existing callers pass
        // "all" or nothing and see exactly what they saw before.
        const sessionResult = await requireSession();
        const entitled = entitledAudiences(sessionResult.session?.user?.roles);

        const now = new Date();

        const q = db.collection(COLLECTIONS.ANNOUNCEMENTS).where("active", "==", true);

        const snapshot = await q.get();

        return snapshot.docs
            .map((doc) => {
                const data = doc.data();
                return {
                    id: doc.id,
                    title: data.title,
                    content: data.content,
                    type: data.type,
                    targetAudience: data.targetAudience,
                    priority: data.priority,
                    publishedAt: data.publishedAt,
                    expiresAt: data.expiresAt,
                    createdBy: data.createdBy,
                    createdAt: data.createdAt,
                    active: data.active } as Announcement;
            })
            .filter((announcement) => {
                // Entitlement first. An audience this caller is not in is never
                // returned, whatever they asked for. An announcement carrying an
                // unrecognised audience is not in the set either, so it fails
                // closed rather than leaking to everyone.
                if (!entitled.has(announcement.targetAudience as AudienceName)) {
                    return false;
                }

                // Then the caller's own filter, unchanged — it can only narrow
                // what entitlement already allowed.
                if (announcement.targetAudience !== "all" && announcement.targetAudience !== targetAudience) {
                    return false;
                }

                // Filter by expiry
                if (announcement.expiresAt) { const expDate = typeof announcement.expiresAt.toDate === 'function'
                        ? announcement.expiresAt.toDate()
                        : new Date(announcement.expiresAt as string | number | Date);
                    if (expDate.getTime() < now.getTime()) {
                        return false;
                    }
                }

                return true;
            });
    } catch (error) { logger.error("Failed to fetch announcements:", error);
        return [];
    }
}

/**
 * Deactivate announcement
 */
export async function deactivateAnnouncementAction(
    announcementId: string,
    adminId: string
): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> { try {
        const admin = await requireAdmin();
        if (!admin) return { success: false as const, error: "Unauthorized: Admin access required", data: null };
        const announcementRef = db.collection(COLLECTIONS.ANNOUNCEMENTS).doc(announcementId);

        await announcementRef.update({ active: false,
            updatedAt: FieldValue.serverTimestamp() });

        await logAdminAction(
            "announcement_deactivated",
            admin.id,
            announcementId,
            "announcement"
        );

        return { error: null, success: true as const , data: null };
    } catch (error) { logger.error("Deactivation error:", error);
        return { success: false as const, error: "Failed to deactivate announcement", data: null };
    }
}

/**
 * Create banner
 */
export async function createBannerAction(data: { title: string;
    message: string;
    type: "promotional" | "informational" | "alert";
    link?: string;
    buttonText?: string;
    imageUrl?: string;
    startDate: string;
    endDate: string;
    position: "top" | "bottom" | "popup";
    adminId: string; }): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> { try {
        const admin = await requireAdmin();
        if (!admin) return { success: false as const, error: "Unauthorized: Admin access required", data: null };

        // A banner is shown by `now >= startDate && now <= endDate`, evaluated
        // in getActiveBannersAction. An unparseable date becomes Invalid Date,
        // every comparison against it is false, and the banner simply never
        // appears — while this action returns success and the admin page lists
        // it as live. The same is true of an end date before the start.
        //
        // Both are cheap to reject and impossible to notice later.
        const startDate = new Date(data.startDate);
        const endDate = new Date(data.endDate);
        if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
            return { success: false as const, error: "Start and end dates must be valid dates", data: null };
        }
        if (endDate.getTime() < startDate.getTime()) {
            return { success: false as const, error: "The end date cannot be before the start date", data: null };
        }

        const banner: Omit<Banner, "id"> = { title: data.title,
            message: data.message,
            type: data.type,
            link: data.link,
            buttonText: data.buttonText,
            imageUrl: data.imageUrl,
            startDate,
            endDate,
            position: data.position,
            createdBy: admin.id,
            createdAt: FieldValue.serverTimestamp(),
            active: true };

        const docRef = await db.collection(COLLECTIONS.BANNERS).add(banner);

        await logAdminAction(
            "banner_created",
            admin.id,
            docRef.id,
            "banner"
        );

        return { error: null, success: true as const, bannerId: docRef.id , data: null };
    } catch (error) { logger.error("Banner creation error:", error);
        return { success: false as const, error: "Failed to create banner", data: null };
    }
}

/**
 * Get active banners
 */
export async function getActiveBannersAction(): Promise<Banner[]> { try {
        const now = new Date();

        const q = db.collection(COLLECTIONS.BANNERS).where("active", "==", true);

        const snapshot = await q.get();

        return snapshot.docs
            .map((doc) => {
                const data = doc.data();
                return {
                    id: doc.id,
                    title: data.title,
                    message: data.message,
                    type: data.type,
                    link: data.link,
                    buttonText: data.buttonText,
                    imageUrl: data.imageUrl,
                    startDate: data.startDate,
                    endDate: data.endDate,
                    position: data.position,
                    createdBy: data.createdBy,
                    createdAt: data.createdAt,
                    active: data.active } as Banner;
            })
            .filter((banner) => { const start = new Date(banner.startDate);
                const end = new Date(banner.endDate);
                return now >= start && now <= end;
            });
    } catch (error) { logger.error("Failed to fetch banners:", error);
        return [];
    }
}

/**
 * Deactivate banner
 */
export async function deactivateBannerAction(
    bannerId: string,
    adminId: string
): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> { try {
        const admin = await requireAdmin();
        if (!admin) return { success: false as const, error: "Unauthorized: Admin access required", data: null };
        const bannerRef = db.collection(COLLECTIONS.BANNERS).doc(bannerId);

        await bannerRef.update({ active: false,
            updatedAt: FieldValue.serverTimestamp() });

        await logAdminAction(
            "banner_deactivated",
            admin.id,
            bannerId,
            "banner"
        );

        return { error: null, success: true as const , data: null };
    } catch (error) { logger.error("Deactivation error:", error);
        return { success: false as const, error: "Failed to deactivate banner", data: null };
    }
}
