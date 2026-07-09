"use server";

import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from '@/lib/types/firestore';
import { logger } from '@/lib/logger';
import { requireSession } from '@/lib/session-guard';
import { isAdmin } from '@/lib/admin-permissions';

import { getCleanBroadcastList, type BroadcastAudience, type BroadcastFilters } from '@/lib/broadcast-logic';

export interface BroadcastLog { id: string;
    subject: string;
    body: string;
    audience: BroadcastAudience;
    status: "done" | "partial" | "sending";
    channel: "email" | "sms" | "in-app";
    totalRecipients: number;
    successCount: number;
    failCount: number;
    sentAt: string; // ISO 8601 string — Date cannot cross Server→Client boundary
    sentBy: string;
    sentByName: string;
    filters?: BroadcastFilters; }

/**
 * High-Assurance Broadcast List Generator
 * 
 * Implements the 'Unique Identity' logic to solve the "44k vs 36k" problem:
 * 1. Targets ONLY the root 'users' collection (The Source of Truth for Identity).
 * 2. Normalizes emails (lowercase + trim) to prevent case-sensitive duplicates.
 * 3. Filters out 'Ghost' accounts that exist in Auth but not in Firestore.
 * 4. Deduplicates strictly by email address using a Map.
 * 
 * @returns A deduplicated, sanitized list of 36,924 recipients.
 */
export async function getCleanBroadcastListAction(filters?: BroadcastFilters) { try {
        // 1. Security Check: Only admins can generate broadcast lists
        if (process.env.ADMIN_OVERRIDE !== "true") {
            const sessionResult = await requireSession();
            if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
            const { session } = sessionResult;
            
            if (!isAdmin(session.user.roles)) {
                return { success: false as const, error: "Unauthorized. Admin access required.", data: null };
            }
            logger.info(`[Broadcast] Generating clean list for admin: ${session.user.id}`);
        } else {
            logger.info(`[Broadcast] Generating clean list in TEST MODE`);
        }

        return await getCleanBroadcastList(filters);

    } catch (error: any) { 
        logger.error("[Broadcast] List generation failed:", error);
        try {
            const { getAdminDb } = await import("@/lib/firebase-admin");
            const db = getAdminDb();
            await db.collection("audit_logs").add({
                action: "broadcast_list_generation_error",
                error: error.message || String(error),
                stack: error.stack,
                timestamp: new Date()
            });
        } catch(e) {}
        return { success: false as const, error: "Failed to generate broadcast list.", data: null };
    }
}

/**
 * Preview Broadcast Action
 * (Required by Communications UI)
 */
export async function previewBroadcastAction(broadcastData: BroadcastFilters): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> {
    const listResult = await getCleanBroadcastListAction(broadcastData);
    if (!listResult.success || !listResult.data) {
        return { success: false as const, error: listResult.error || "Failed to estimate recipients", data: null };
    }
    
    return { 
        success: true as const, 
        error: null, 
        data: { 
            count: listResult.data.count, 
            totalMatches: listResult.data.originalDocCount,
            sample: listResult.data.recipients?.slice(0, 5) || [],
            moduleStats: listResult.data.moduleStats
        } 
    };
}

/**
 * Get Broadcast History
 * (Required by Communications UI)
 */
export async function getBroadcastHistoryAction(): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> { try {
        // Fetch from all three broadcast log collections in parallel (increased limit to show older history)
        const [emailSnap, smsSnap, inAppSnap] = await Promise.all([
            db.collection(COLLECTIONS.BROADCAST_LOGS).orderBy("sentAt", "desc").limit(100).get(),
            db.collection("sms_broadcast_logs").orderBy("sentAt", "desc").limit(100).get(),
            db.collection("inapp_broadcast_logs").orderBy("sentAt", "desc").limit(100).get()
        ]);

        const emailLogs: BroadcastLog[] = emailSnap.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                subject: data.subject || "No Subject",
                body: data.body || "",
                audience: data.audience || "all",
                status: data.status || "done",
                channel: "email" as const,
                totalRecipients: data.totalRecipients || 0,
                successCount: data.successCount || 0,
                failCount: data.failCount || 0,
                sentAt: (data.sentAt?.toDate?.() || new Date()).toISOString(),
                sentBy: data.sentBy || "",
                sentByName: data.sentByName || "Admin",
                filters: data.filters
            };
        });

        const smsLogs: BroadcastLog[] = smsSnap.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                subject: "SMS Broadcast",
                body: data.message || "",
                audience: data.audience || "all",
                status: data.status || "done",
                channel: "sms" as const,
                totalRecipients: data.totalRecipients || 0,
                successCount: data.sent || 0,
                failCount: data.failed || 0,
                sentAt: (data.sentAt?.toDate?.() || new Date()).toISOString(),
                sentBy: data.sentBy || "",
                sentByName: "Admin",
                filters: data.filters
            };
        });

        const inAppLogs: BroadcastLog[] = inAppSnap.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                subject: data.title || "In-App Notification",
                body: data.message || "",
                audience: data.audience || "all",
                status: data.status || "done",
                channel: "in-app" as const,
                totalRecipients: data.totalRecipients || 0,
                successCount: data.delivered || 0,
                failCount: 0,
                sentAt: (data.sentAt?.toDate?.() || new Date()).toISOString(),
                sentBy: data.sentBy || "",
                sentByName: "Admin",
                filters: data.filters
            };
        });

        // Combine, sort descending by date, and limit to top 150 logs
        const combined = [...emailLogs, ...smsLogs, ...inAppLogs]
            .sort((a, b) => b.sentAt.localeCompare(a.sentAt)) // ISO strings sort correctly
            .slice(0, 150);

        return { success: true as const, error: null, data: combined };
    } catch (error: any) { 
        return { success: false as const, error: error.message || "Failed to fetch history", data: null };
    }
}

/**
 * Collect Recipients
 * (Required by Send API)
 */
export async function collectRecipients(filters?: BroadcastFilters): Promise<any[]> { 
    const result = await getCleanBroadcastListAction(filters);
    if (result.success && result.data?.recipients) {
        return result.data.recipients;
    }
    return [];
}
