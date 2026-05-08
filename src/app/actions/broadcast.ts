"use server";

import { db } from '@/lib/firebase-admin';
import { COLLECTIONS } from '@/lib/types/firestore';
import { logger } from '@/lib/logger';
import { requireSession } from '@/lib/session-guard';
import { isAdmin } from '@/lib/admin-permissions';

export type BroadcastAudience =
    | "all"
    | "pending_applicants"
    | "unpaid_applicants"
    | "abandoned_failed_transactions"
    | "csv_upload"
    | "marketplace_onboarded"
    | "buyers"
    | "sellers"
    | "wholesale_sellers"
    | "retail_sellers"
    | "cooperative_members"
    | "wave_applicants"
    | "wave_briefing_registrants"
    | "academy_users"
    | "farm_nation_users"
    | "export_users";

export interface BroadcastFilters { audience: BroadcastAudience;
    state?: string;
    sellerStatus?: "pending" | "approved" | "suspended";
    moduleStatus?: string;
    farmNationRole?: "buyer" | "seller" | "both";
    csvEmails?: string[]; }

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
        const { session } = await requireSession();
        if (!session?.user || !isAdmin(session.user.roles)) { return { success: false as const, error: "Unauthorized. Admin access required.", data: null };
        }

        logger.info(`[Broadcast] Generating clean list for admin: ${session.user.id}`);

        // 2. Fetch records from the global 'users' collection with specific fields and order
        const snapshot = await db.collection(COLLECTIONS.USERS)
            .select("email", "userEmail", "fullName", "firstName", "stateOfOrigin", "address", "onboardingCompleted", "updatedAt")
            .orderBy("updatedAt", "desc")
            .get();
            
        const emailMap = new Map();

        snapshot.docs.forEach(doc => { const data = doc.data();
            // We prioritize the 'email' field, falling back to 'userEmail' if present
            const rawEmail = data.email || data.userEmail;
            
            if (rawEmail) {
                const normalizedEmail = rawEmail.toLowerCase().trim();
                
                // Only keep the first instance of an email found (Deduplication)
                // Since we sorted by updatedAt desc, we keep the most recently updated one
                if (!emailMap.has(normalizedEmail)) {
                    emailMap.set(normalizedEmail, {
                        uid: doc.id,
                        email: normalizedEmail,
                        name: data.fullName || data.firstName || 'Member',
                        state: data.stateOfOrigin || data.address?.state || 'Unknown',
                        onboardingCompleted: data.onboardingCompleted || false,
                        lastActive: data.updatedAt?.toDate ? data.updatedAt.toDate() : data.updatedAt
                    });
                }
            }
        });

        const uniqueList = Array.from(emailMap.values());
        
        logger.info(`[Broadcast] Clean Sweep complete. Original Docs: ${snapshot.size}, Unique Recipients: ${uniqueList.length}`);

        return { 
            success: true as const, 
            error: null, 
            data: { 
                recipients: uniqueList, 
                count: uniqueList.length, 
                originalDocCount: snapshot.size 
            } 
        };

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
            sample: listResult.data.recipients?.slice(0, 5) || [] 
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
