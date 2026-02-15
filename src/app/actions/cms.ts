"use server";

import { db } from "@/lib/firebase-admin";
import { logger } from '@/lib/logger';
import { FieldValue } from "firebase-admin/firestore";
import { createAuditLog, logAdminAction } from "@/lib/audit-log";

/**
 * Content Management System (CMS)
 * Announcements, Banners, notifications
 */

export interface Announcement {
    id?: string;
    title: string;
    content: string;
    type: "info" | "warning" | "success" | "emergency";
    targetAudience: "all" | "members" | "exporters" | "admins" | "vendors";
    priority: "low" | "medium" | "high" | "urgent";
    publishedAt: Date | any;
    expiresAt?: Date | any;
    createdBy: string;
    createdAt: Date | any;
    active: boolean;
}

export interface Banner {
    id?: string;
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
    active: boolean;
}

/**
 * Create announcement
 */
export async function createAnnouncementAction(data: {
    title: string;
    content: string;
    type: "info" | "warning" | "success" | "emergency";
    targetAudience: "all" | "members" | "exporters" | "admins" | "vendors";
    priority: "low" | "medium" | "high" | "urgent";
    expiresAt?: string;
    adminId: string;
}): Promise<{ success: boolean; error?: string; announcementId?: string }> {
    try {
        const announcement: Omit<Announcement, "id"> = {
            title: data.title,
            content: data.content,
            type: data.type,
            targetAudience: data.targetAudience,
            priority: data.priority,
            publishedAt: FieldValue.serverTimestamp(),
            expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined,
            createdBy: data.adminId,
            createdAt: FieldValue.serverTimestamp(),
            active: true,
        };

        const docRef = await db.collection("announcements").add(announcement);

        await logAdminAction(
            "announcement_created",
            data.adminId,
            docRef.id,
            "announcement"
        );

        return { success: true, announcementId: docRef.id };
    } catch (error) {
        logger.error("Announcement creation error:", error);
        return { success: false, error: "Failed to create announcement" };
    }
}

/**
 * Get active announcements
 */
export async function getActiveAnnouncementsAction(
    targetAudience: string = "all"
): Promise<Announcement[]> {
    try {
        const now = new Date();

        const q = db.collection("announcements").where("active", "==", true);

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
                    active: data.active,
                } as Announcement;
            })
            .filter((announcement) => {
                // Filter by target audience
                if (announcement.targetAudience !== "all" && announcement.targetAudience !== targetAudience) {
                    return false;
                }

                // Filter by expiry
                if (announcement.expiresAt && new Date(announcement.expiresAt as any).getTime() < now.getTime()) {
                    return false;
                }

                return true;
            });
    } catch (error) {
        logger.error("Failed to fetch announcements:", error);
        return [];
    }
}

/**
 * Deactivate announcement
 */
export async function deactivateAnnouncementAction(
    announcementId: string,
    adminId: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const announcementRef = db.collection("announcements").doc(announcementId);

        await announcementRef.update({
            active: false,
        });

        await logAdminAction(
            "announcement_deactivated",
            adminId,
            announcementId,
            "announcement"
        );

        return { success: true };
    } catch (error) {
        logger.error("Deactivation error:", error);
        return { success: false, error: "Failed to deactivate announcement" };
    }
}

/**
 * Create banner
 */
export async function createBannerAction(data: {
    title: string;
    message: string;
    type: "promotional" | "informational" | "alert";
    link?: string;
    buttonText?: string;
    imageUrl?: string;
    startDate: string;
    endDate: string;
    position: "top" | "bottom" | "popup";
    adminId: string;
}): Promise<{ success: boolean; error?: string; bannerId?: string }> {
    try {
        const banner: Omit<Banner, "id"> = {
            title: data.title,
            message: data.message,
            type: data.type,
            link: data.link,
            buttonText: data.buttonText,
            imageUrl: data.imageUrl,
            startDate: new Date(data.startDate),
            endDate: new Date(data.endDate),
            position: data.position,
            createdBy: data.adminId,
            createdAt: FieldValue.serverTimestamp(),
            active: true,
        };

        const docRef = await db.collection("banners").add(banner);

        await logAdminAction(
            "banner_created",
            data.adminId,
            docRef.id,
            "banner"
        );

        return { success: true, bannerId: docRef.id };
    } catch (error) {
        logger.error("Banner creation error:", error);
        return { success: false, error: "Failed to create banner" };
    }
}

/**
 * Get active banners
 */
export async function getActiveBannersAction(): Promise<Banner[]> {
    try {
        const now = new Date();

        const q = db.collection("banners").where("active", "==", true);

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
                    active: data.active,
                } as Banner;
            })
            .filter((banner) => {
                const start = new Date(banner.startDate);
                const end = new Date(banner.endDate);
                return now >= start && now <= end;
            });
    } catch (error) {
        logger.error("Failed to fetch banners:", error);
        return [];
    }
}

/**
 * Deactivate banner
 */
export async function deactivateBannerAction(
    bannerId: string,
    adminId: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const bannerRef = db.collection("banners").doc(bannerId);

        await bannerRef.update({
            active: false,
        });

        await logAdminAction(
            "banner_deactivated",
            adminId,
            bannerId,
            "banner"
        );

        return { success: true };
    } catch (error) {
        logger.error("Deactivation error:", error);
        return { success: false, error: "Failed to deactivate banner" };
    }
}
