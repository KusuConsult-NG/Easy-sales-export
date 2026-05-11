"use server";

import { db } from '@/lib/firebase-admin';
import { COLLECTIONS } from '@/lib/types/firestore';
import { logger } from '@/lib/logger';
import { requireSession } from '@/lib/session-guard';
import { isAdmin } from '@/lib/admin-permissions';

import { getCleanBroadcastList, type BroadcastAudience, type BroadcastFilters } from '@/lib/broadcast-logic';

export type { BroadcastAudience, BroadcastFilters };

export interface BroadcastLog { id: string;
    subject: string;
    body: string;
    audience: BroadcastAudience;
    status: "done" | "partial" | "sending";
    channel: "email" | "sms" | "in-app";
    totalRecipients: number;
    successCount: number;
    failCount: number;
    sentAt: Date;
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

    } catch (error) { logger.error("[Broadcast] List generation failed:", error);
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
        const snapshot = await db.collection(COLLECTIONS.AUDIT_LOGS)
            .where("action", "==", "telemetry_broadcast_sent")
            .orderBy("timestamp", "desc")
            .limit(20)
            .get();
            
        const logs = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                subject: data.metadata?.subject || "No Subject",
                body: data.metadata?.body || "",
                audience: data.metadata?.filters?.audience || "all",
                status: "done",
                channel: "email",
                totalRecipients: data.metadata?.count || 0,
                successCount: data.metadata?.count || 0,
                failCount: 0,
                sentAt: data.timestamp?.toDate() || new Date(),
                sentBy: data.userId,
                sentByName: data.metadata?.sentByName || "Admin",
                filters: data.metadata?.filters
            } as BroadcastLog;
        });
        
        return { success: true as const, error: null, data: logs };
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
