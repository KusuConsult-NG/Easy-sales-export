import { db } from './firebase-admin';
import { COLLECTIONS } from './types/firestore';
import { logger } from './logger';
import { User } from './types/firestore';

/**
 * High-Precision Mutually Exclusive Segmenter
 * Categorizes users based on their engagement depth.
 */
export function categorizeUser(data: any): BroadcastAudience {
    const regs = data.serviceRegistrations || {};
    
    // 1. Check for Active Engagement (Any approved/paid/completed module)
    const hasApproved = Object.values(regs).some((r: any) => 
        r.status === "approved" || r.status === "active" || r.status === "paid" || r.status === "completed"
    );
    if (hasApproved) return "active_users";

    // 2. Check for Pending Applications
    const hasPending = Object.values(regs).some((r: any) => 
        r.status === "pending" || r.status === "submitted" || r.status === "under_review" || r.status === "briefing"
    );
    if (hasPending) return "pending_users";

    // 3. Check for Stalled Progress (Started profile/KYC but no applications)
    const hasStartedAny = Object.values(regs).some((r: any) => r.status && r.status !== "not_started");
    const hasBank = (data.verificationProfile?.bankDetails?.bankName && data.verificationProfile?.bankDetails?.bankName !== "N/A") || (data.bankDetails?.bankName);
    const hasAddress = (data.verificationProfile?.address?.state && data.verificationProfile?.address?.state !== "N/A") || (data.address?.state);
    
    if (hasStartedAny || hasBank || hasAddress) return "stalled_users";

    // 4. Ghost User (No activity detected)
    return "ghost_users";
}

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
    | "pending_users"
    | "active_users"
    | "ghost_users";

export interface BroadcastFilters {
    audience: BroadcastAudience;
    state?: string;
    sellerStatus?: "all" | "pending" | "approved" | "suspended";
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
        logger.info(`[BroadcastLogic] Generating clean list using stream (Audience: ${filters?.audience || 'all'})...`);

        // Targeted projection to minimize bandwidth
        const query = db.collection(COLLECTIONS.USERS)
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
                "verificationProfile",
                "bankDetails",
                "marketplaceAccountType",
                "roles"
            )
            .orderBy("updatedAt", "desc");

        const emailMap = new Map<string, Recipient>();
        let totalScanned = 0;
        let matchedAudienceCount = 0;

        const moduleStats = {
            total: 0,
            approved: 0,
            pending: 0,
            rejected: 0,
            suspended: 0
        };

        // Use streaming to handle high-scale user counts (37k+) safely
        await new Promise((resolve, reject) => {
            query.stream()
                .on("data", (doc) => {
                    totalScanned++;
                    const data = doc.data();
                    
                    // 1. Extract and normalize email
                    const rawEmail = data.email || data.userEmail;
                    if (!rawEmail) return;
                    
                    const normalizedEmail = rawEmail.toLowerCase().trim();

                    // 2. Apply Date Range Filter if present
                    if (filters?.startDate || filters?.endDate) {
                        const created = data.createdAt?.toDate ? data.createdAt.toDate() : new Date(data.createdAt);
                        if (filters.startDate && created < new Date(filters.startDate)) return;
                        if (filters.endDate && created > new Date(filters.endDate)) return;
                    }

                    // 3. High-Precision Audience Segmenting
                    const userSegment = categorizeUser(data);
                    
                    let matchesAudience = false;
                    if (!filters || filters.audience === "all") {
                        matchesAudience = true;
                    } else if (filters.audience === userSegment) {
                        matchesAudience = true;
                    } else {
                        // Fallback to legacy specific module filters
                        const regs = data.serviceRegistrations || {};
                        const statusFilter = filters.moduleStatus && filters.moduleStatus !== "all"
                            ? filters.moduleStatus
                            : null;

                        let inModule = false;
                        let userStatus = "";

                        if (filters.audience === "marketplace_onboarded") {
                            const mReg = regs.marketplace;
                            if (mReg || data.marketplaceAccountType || (data.roles && (data.roles.includes("buyer") || data.roles.includes("seller")))) { 
                                inModule = true; 
                                userStatus = mReg?.status || "approved"; 
                            }
                        } else if (filters.audience === "buyers") {
                            if (data.marketplaceAccountType === "buyer" || data.marketplaceAccountType === "both" || (data.roles && data.roles.includes("buyer"))) { 
                                inModule = true; 
                                userStatus = "approved"; 
                            }
                        } else if (filters.audience === "sellers" || filters.audience === "wholesale_sellers" || filters.audience === "retail_sellers") {
                            if (data.marketplaceAccountType === "seller" || data.marketplaceAccountType === "both" || (data.roles && data.roles.includes("seller"))) { 
                                // Best effort mapping for sellers since we are reading from USERS collection
                                inModule = true; 
                                const mReg = regs.marketplace;
                                userStatus = mReg?.status || "approved"; 
                            }
                        } else if (filters.audience === "cooperative_members") {
                            const cReg = regs.cooperative;
                            if (cReg) { inModule = true; userStatus = cReg.status || "pending"; }
                        } else if (filters.audience === "wave_applicants") {
                            const wReg = regs.wave;
                            if (wReg) { inModule = true; userStatus = wReg.status || "pending"; }
                        } else if (filters.audience === "academy_users") {
                            const aReg = regs.academy;
                            if (aReg) { inModule = true; userStatus = aReg.status || "pending"; }
                        } else if (filters.audience === "farm_nation_users") {
                            const fReg = regs.farm_nation || regs.farmNation;
                            if (fReg) { inModule = true; userStatus = fReg.status || "pending"; }
                        } else if (filters.audience === "export_users") {
                            const eReg = regs.export;
                            if (eReg) { inModule = true; userStatus = eReg.status || "pending"; }
                        }

                        if (inModule) {
                            moduleStats.total++;
                            if (userStatus === "approved") moduleStats.approved++;
                            else if (userStatus === "pending") moduleStats.pending++;
                            else if (userStatus === "rejected") moduleStats.rejected++;
                            else if (userStatus === "suspended") moduleStats.suspended++;
                            
                            matchesAudience = statusFilter ? userStatus === statusFilter : true;
                        } else {
                            if (filters.audience === "pending_applicants") {
                                matchesAudience = Object.values(regs).some((r: any) => r.status === "pending" || r.status === "submitted");
                            } else if (filters.audience === "unpaid_applicants") {
                                matchesAudience = Object.values(regs).some((r: any) => r.paymentStatus === "pending" || r.paymentStatus === "failed");
                            }
                        }
                    }

                    if (matchesAudience) {
                        matchedAudienceCount++;
                        
                        // 4. Deduplication
                        if (!emailMap.has(normalizedEmail)) {
                            const lastActiveRaw = data.updatedAt || data.createdAt;
                            emailMap.set(normalizedEmail, {
                                uid: doc.id,
                                email: normalizedEmail,
                                name: data.fullName || data.firstName || 'Member',
                                state: data.stateOfOrigin || data.address?.state || data.verificationProfile?.address?.state || 'Unknown',
                                onboardingCompleted: data.onboardingCompleted || false,
                                lastActive: lastActiveRaw?.toDate ? lastActiveRaw.toDate() : (lastActiveRaw ? new Date(lastActiveRaw) : new Date())
                            });
                        }
                    }
                })
                .on("end", resolve)
                .on("error", reject);
        });

        logger.info(`[BroadcastLogic] Clean Sweep complete. Scanned: ${totalScanned}, Matched: ${matchedAudienceCount}, Unique: ${emailMap.size}`);

        const uniqueList = Array.from(emailMap.values());

        return {
            success: true as const,
            error: null,
            data: {
                recipients: uniqueList,
                count: uniqueList.length,
                originalDocCount: totalScanned,
                moduleStats
            }
        };

    } catch (error) {
        logger.error("[BroadcastLogic] List generation failed:", error);
        return { success: false as const, error: "Failed to generate broadcast list.", data: null };
    }
}
