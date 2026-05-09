import { db } from './firebase-admin';
import { COLLECTIONS } from './types/firestore';
import { logger } from './logger';

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

export interface BroadcastFilters {
    audience: BroadcastAudience;
    state?: string;
    sellerStatus?: "pending" | "approved" | "suspended";
    moduleStatus?: string;
    farmNationRole?: "buyer" | "seller" | "both";
    csvEmails?: string[];
    startDate?: string; // ISO string
    endDate?: string;   // ISO string
}

export interface Recipient {
    uid: string;
    email: string;
    name: string;
    state: string;
    onboardingCompleted: boolean;
    lastActive: Date;
}

/**
 * Core logic for generating broadcast lists.
 * This is decoupled from 'use server' and 'server-only' to allow use in Node.js scripts.
 */
export async function getCleanBroadcastList(filters?: BroadcastFilters) {
    try {
        logger.info(`[BroadcastLogic] Generating clean list...`);

        // Fetch records from the global 'users' collection
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
                "createdAt",
                "serviceRegistrations",
                "verificationProfile"
            )
            .orderBy("updatedAt", "desc")
            .get();

        const emailMap = new Map<string, Recipient>();
        let totalScanned = 0;
        let matchedAudienceCount = 0;

        snapshot.docs.forEach(doc => {
            totalScanned++;
            const data = doc.data();
            
            // 1. Apply Date Range Filter if present
            if (filters?.startDate || filters?.endDate) {
                const created = data.createdAt?.toDate ? data.createdAt.toDate() : new Date(data.createdAt);
                if (filters.startDate && created < new Date(filters.startDate)) return;
                if (filters.endDate && created > new Date(filters.endDate)) return;
            }

            // 2. Extract and normalize email
            const rawEmail = data.email || data.userEmail;

            if (rawEmail) {
                const normalizedEmail = rawEmail.toLowerCase().trim();

                // 3. Audience Filtering
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

                // 4. Apply Filter & Deduplication
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

        logger.info(`[BroadcastLogic] Clean Sweep complete. Scanned: ${totalScanned}, Matched: ${matchedAudienceCount}, Unique: ${emailMap.size}`);

        const uniqueList = Array.from(emailMap.values());

        return {
            success: true as const,
            error: null,
            data: {
                recipients: uniqueList,
                count: uniqueList.length,
                originalDocCount: snapshot.size
            }
        };

    } catch (error) {
        logger.error("[BroadcastLogic] List generation failed:", error);
        return { success: false as const, error: "Failed to generate broadcast list.", data: null };
    }
}
