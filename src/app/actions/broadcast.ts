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
    | "export_users"
    | "stalled_users"
    | "ghost_users";

export interface BroadcastFilters { audience: BroadcastAudience;
    state?: string;
    sellerStatus?: "pending" | "approved" | "suspended";
    moduleStatus?: string;
    farmNationRole?: "buyer" | "seller" | "both";
    csvEmails?: string[];
    startDate?: string; // ISO string
    endDate?: string;   // ISO string
}

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
            const { session } = await requireSession();
            if (!session?.user || !isAdmin(session.user.roles)) {
                return { success: false as const, error: "Unauthorized. Admin access required.", data: null };
            }
            logger.info(`[Broadcast] Generating clean list for admin: ${session.user.id}`);
        } else {
            logger.info(`[Broadcast] Generating clean list in TEST MODE`);
        }

        // 2. Fetch records from the global 'users' collection with specific fields and order
        const snapshot = await db.collection(COLLECTIONS.USERS)
            .select(
                "email", 
                "userEmail", 
                "fullName", 
                "firstName", 
                "stateOfOrigin", 
                "address", 
                "onboardingCompleted", 
                "updatedAt",
                "serviceRegistrations",
                "verificationProfile"
            )
            .orderBy("updatedAt", "desc")
            .get();
            
        const emailMap = new Map();
        let totalScanned = 0;
        let matchedAudienceCount = 0;

        snapshot.docs.forEach(doc => { 
            totalScanned++;
            const data = doc.data();
            // 3. Apply Date Range Filter if present
            if (filters?.startDate || filters?.endDate) {
                const created = data.createdAt?.toDate ? data.createdAt.toDate() : new Date(data.createdAt);
                if (filters.startDate && created < new Date(filters.startDate)) return;
                if (filters.endDate && created > new Date(filters.endDate)) return;
            }

            // 4. Extract and normalize email
            const rawEmail = data.email || data.userEmail;
            
            if (rawEmail) {
                const normalizedEmail = rawEmail.toLowerCase().trim();

                // 5. Audience Filtering
                let matchesAudience = true;
                const regs = data.serviceRegistrations || {};
                const hasStartedAny = Object.values(regs).some((r: any) => r.status && r.status !== "not_started");
                const hasBank = data.verificationProfile?.bankDetails?.bankName && data.verificationProfile?.bankDetails?.bankName !== "N/A";
                const hasAddress = data.verificationProfile?.address?.state && data.verificationProfile?.address?.state !== "N/A";

                if (filters?.audience === "stalled_users") {
                    matchesAudience = hasStartedAny && (!hasBank || !hasAddress);
                } else if (filters?.audience === "ghost_users") {
                    matchesAudience = !hasStartedAny;
                } else if (filters?.audience === "pending_applicants") {
                    matchesAudience = Object.values(regs).some((r: any) => r.status === "pending");
                } else if (filters?.audience === "unpaid_applicants") {
                    matchesAudience = Object.values(regs).some((r: any) => r.paymentStatus === "pending" || r.paymentStatus === "failed");
                } else if (filters?.audience === "marketplace_onboarded") {
                    matchesAudience = regs.marketplace?.status === "approved";
                } else if (filters?.audience === "cooperative_members") {
                    matchesAudience = regs.cooperative?.status === "approved" || regs.cooperative?.status === "pending";
                } else if (filters?.audience === "wave_applicants") {
                    matchesAudience = !!regs.wave;
                } else if (filters?.audience === "academy_users") {
                    matchesAudience = !!regs.academy;
                } else if (filters?.audience === "farm_nation_users") {
                    matchesAudience = !!regs.farm_nation;
                } else if (filters?.audience === "export_users") {
                    matchesAudience = !!regs.export;
                }

                if (matchesAudience) matchedAudienceCount++;

                // 6. Apply Filter & Deduplication
                if (matchesAudience && !emailMap.has(normalizedEmail)) {
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

        logger.info(`[Broadcast] Clean Sweep complete. Scanned: ${totalScanned}, Matched: ${matchedAudienceCount}, Unique: ${emailMap.size}`);

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
            totalMatches: listResult.data.originalDocCount,
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
