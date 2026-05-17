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
    | "ghost_users"
    | "all_except_approved_coop";

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
 * Resolves the seller broadcast list EXCLUSIVELY from seller_verifications (source of truth).
 * Fetches user emails from USERS collection by userId in batches of 30.
 */
async function getSellerBroadcastList(filters?: BroadcastFilters) {
    const audience = filters?.audience;
    const statusFilter = filters?.moduleStatus && filters.moduleStatus !== "all" ? filters.moduleStatus : null;

    // 1. Read all seller_verifications records (source of truth — 627 records)
    const sellerSnap = await db.collection(COLLECTIONS.SELLER_VERIFICATIONS).get();

    const moduleStats = { total: 0, approved: 0, pending: 0, rejected: 0, suspended: 0 };
    const sellerEntries: { userId: string; status: string }[] = [];

    for (const doc of sellerSnap.docs) {
        const d = doc.data();
        const userId = d.userId;
        if (!userId) continue;

        let status = d.status || "pending";
        if (status === "under_review") status = "pending";

        moduleStats.total++;
        if (status === "approved") moduleStats.approved++;
        else if (status === "pending") moduleStats.pending++;
        else if (status === "rejected") moduleStats.rejected++;
        else if (status === "suspended") moduleStats.suspended++;

        // Apply status filter if set
        if (statusFilter && status !== statusFilter) continue;

        sellerEntries.push({ userId, status });
    }

    // 2. Batch-resolve emails from USERS collection (chunks of 30 to avoid limits)
    const emailMap = new Map<string, Recipient>();
    const missingEmailUserIds: string[] = []; // fallback candidates
    const CHUNK = 30;

    for (let i = 0; i < sellerEntries.length; i += CHUNK) {
        const chunk = sellerEntries.slice(i, i + CHUNK);
        const refs = chunk.map(e => db.collection(COLLECTIONS.USERS).doc(e.userId));
        const userDocs = await db.getAll(...refs);

        userDocs.forEach((userDoc, idx) => {
            if (!userDoc.exists) {
                // User doc missing entirely — try Auth fallback
                missingEmailUserIds.push(chunk[idx].userId);
                return;
            }
            const d = userDoc.data() as any;
            const rawEmail = d.email || d.userEmail;
            if (!rawEmail) {
                // User doc exists but has no email — try Auth fallback
                missingEmailUserIds.push(userDoc.id);
                return;
            }
            const normalizedEmail = rawEmail.toLowerCase().trim();
            if (emailMap.has(normalizedEmail)) return;

            const lastActiveRaw = d.updatedAt || d.createdAt;
            emailMap.set(normalizedEmail, {
                uid: userDoc.id,
                email: normalizedEmail,
                name: d.fullName || d.firstName || "Member",
                state: d.state || d.stateOfOrigin || d.address?.state || d.verificationProfile?.address?.state || "Unknown",
                onboardingCompleted: d.onboardingCompleted || false,
                lastActive: lastActiveRaw?.toDate ? lastActiveRaw.toDate() : (lastActiveRaw ? new Date(lastActiveRaw) : new Date()),
            });
        });
    }

    // 3. Firebase Auth fallback — recover emails for sellers whose USERS doc has no email field
    if (missingEmailUserIds.length > 0) {
        logger.info(`[BroadcastLogic][Sellers] Falling back to Firebase Auth for ${missingEmailUserIds.length} sellers with no USERS email...`);
        const { getAuth } = await import("firebase-admin/auth");
        const auth = getAuth();

        for (let i = 0; i < missingEmailUserIds.length; i += 100) {
            const chunk = missingEmailUserIds.slice(i, i + 100);
            try {
                const result = await auth.getUsers(chunk.map(uid => ({ uid })));
                result.users.forEach(authUser => {
                    if (!authUser.email) return;
                    const normalizedEmail = authUser.email.toLowerCase().trim();
                    if (emailMap.has(normalizedEmail)) return;
                    emailMap.set(normalizedEmail, {
                        uid: authUser.uid,
                        email: normalizedEmail,
                        name: authUser.displayName || "Member",
                        state: "Unknown",
                        onboardingCompleted: false,
                        lastActive: new Date(),
                    });
                });
            } catch (authErr) {
                logger.error("[BroadcastLogic][Sellers] Auth fallback error:", authErr);
            }
        }
    }

    const uniqueList = Array.from(emailMap.values());
    logger.info(`[BroadcastLogic][Sellers] seller_verifications: ${sellerSnap.size}, matched entries: ${sellerEntries.length}, unique emails: ${uniqueList.length}`);

    return {
        success: true as const,
        error: null,
        data: {
            recipients: uniqueList,
            count: uniqueList.length,
            originalDocCount: sellerSnap.size,
            moduleStats,
        },
    };
}

async function getAbandonedFailedBroadcastList(filters?: BroadcastFilters) {
    logger.info(`[BroadcastLogic] Generating abandoned/failed transactions list...`);
    const emailMap = new Map<string, Recipient>();
    const moduleStats = { total: 0, approved: 0, pending: 0, rejected: 0, suspended: 0 };
    
    const snap = await db.collection(COLLECTIONS.FAILED_PAYMENTS).get();
    const userIdsToResolve: string[] = [];

    for (const doc of snap.docs) {
        const data = doc.data();
        // Paystack stores email as `customerEmail`, NOT `email`.
        // Also check metadata.email and generic `email` as fallbacks.
        const rawEmail = data.customerEmail || data.email || data.metadata?.email;
        const rawName = data.customerName || data.name || data.metadata?.name || "User";
        const failedAt = data.failedAt || data.abandonedAt;
        const lastActive = failedAt?.toDate ? failedAt.toDate() : (failedAt ? new Date(failedAt) : new Date());

        if (rawEmail) {
            const normalizedEmail = rawEmail.toLowerCase().trim();
            if (!emailMap.has(normalizedEmail)) {
                emailMap.set(normalizedEmail, {
                    uid: data.userId || doc.id,
                    email: normalizedEmail,
                    name: rawName,
                    state: "Unknown",
                    onboardingCompleted: false,
                    lastActive,
                });
            }
        } else if (data.userId) {
            userIdsToResolve.push(data.userId);
        }
    }

    logger.info(`[BroadcastLogic][AbandonedFailed] snap.size=${snap.size}, from_email=${emailMap.size}, userIds_to_resolve=${userIdsToResolve.length}`);

    if (userIdsToResolve.length > 0) {
        const uniqueIds = Array.from(new Set(userIdsToResolve));
        const missingAuthIds: string[] = [];

        for (let i = 0; i < uniqueIds.length; i += 100) {
            const chunk = uniqueIds.slice(i, i + 100);
            const snaps = await db.getAll(...chunk.map(id => db.collection(COLLECTIONS.USERS).doc(id)));
            snaps.forEach((userSnap: any, idx: number) => {
                if (userSnap.exists) {
                    const u = userSnap.data();
                    const rawEmail = u?.email || u?.userEmail;
                    if (rawEmail) {
                        const normalizedEmail = rawEmail.toLowerCase().trim();
                        if (!emailMap.has(normalizedEmail)) {
                            emailMap.set(normalizedEmail, {
                                uid: userSnap.id,
                                email: normalizedEmail,
                                name: u?.fullName || u?.firstName || u?.name || "User",
                                state: u?.state || u?.stateOfOrigin || u?.address?.state || "Unknown",
                                onboardingCompleted: u?.onboardingCompleted || false,
                                lastActive: new Date(),
                            });
                        }
                    } else {
                        // User doc exists but no email field — try Auth fallback
                        missingAuthIds.push(userSnap.id);
                    }
                } else {
                    // User doc missing entirely — try Auth fallback
                    missingAuthIds.push(chunk[idx]);
                }
            });
        }

        // Firebase Auth fallback for users with no Firestore email
        if (missingAuthIds.length > 0) {
            logger.info(`[BroadcastLogic][AbandonedFailed] Auth fallback for ${missingAuthIds.length} users...`);
            try {
                const { getAuth } = await import("firebase-admin/auth");
                const auth = getAuth();
                for (let i = 0; i < missingAuthIds.length; i += 100) {
                    const chunk = missingAuthIds.slice(i, i + 100);
                    const result = await auth.getUsers(chunk.map(uid => ({ uid })));
                    result.users.forEach(authUser => {
                        if (!authUser.email) return;
                        const normalizedEmail = authUser.email.toLowerCase().trim();
                        if (emailMap.has(normalizedEmail)) return;
                        emailMap.set(normalizedEmail, {
                            uid: authUser.uid,
                            email: normalizedEmail,
                            name: authUser.displayName || "User",
                            state: "Unknown",
                            onboardingCompleted: false,
                            lastActive: new Date(),
                        });
                    });
                }
            } catch (authErr) {
                logger.error("[BroadcastLogic][AbandonedFailed] Auth fallback error:", authErr);
            }
        }
    }
    
    const uniqueList = Array.from(emailMap.values());
    logger.info(`[BroadcastLogic][AbandonedFailed] FINAL: ${snap.size} payment docs -> ${uniqueList.length} unique recipients`);

    return {
        success: true as const,
        error: null,
        data: {
            recipients: uniqueList,
            count: uniqueList.length,
            originalDocCount: snap.size,
            moduleStats,
        },
    };
}
async function getUnpaidApplicantsBroadcastList(filters?: BroadcastFilters) {
    logger.info(`[BroadcastLogic] Generating unpaid applicants list...`);
    const emailMap = new Map<string, Recipient>();
    const moduleStats = { total: 0, approved: 0, pending: 0, rejected: 0, suspended: 0 };
    
    const [coopSnap, acadSnap] = await Promise.all([
        db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).where("paymentStatus", "in", ["pending", "unpaid", "failed"]).get(),
        db.collection(COLLECTIONS.ACADEMY_APPLICATIONS).where("paymentStatus", "in", ["pending", "unpaid", "failed"]).get(),
    ]);

    const userIdsToResolve: string[] = [];

    const processDoc = (doc: any, isAcademy = false) => {
        const data = doc.data();
        let rawEmail = data.email || data.userEmail;
        let name = data.fullName || `${data.firstName || ''} ${data.lastName || ''}`.trim() || "User";
        let state = data.state || data.address?.state || "Unknown";

        if (isAcademy && data.personalInfo) {
            rawEmail = rawEmail || data.personalInfo.email;
            name = data.personalInfo.fullName || `${data.personalInfo.firstName || ''} ${data.personalInfo.lastName || ''}`.trim() || name;
            state = data.personalInfo.state || data.personalInfo.stateOfOrigin || state;
        }

        if (rawEmail) {
            const normalizedEmail = rawEmail.toLowerCase().trim();
            if (!emailMap.has(normalizedEmail)) {
                emailMap.set(normalizedEmail, {
                    uid: data.userId || doc.id,
                    email: normalizedEmail,
                    name,
                    state,
                    onboardingCompleted: false,
                    lastActive: new Date()
                });
            }
        } else if (data.userId) {
            userIdsToResolve.push(data.userId);
        }
    };

    coopSnap.docs.forEach((d: any) => processDoc(d));
    acadSnap.docs.forEach((d: any) => processDoc(d, true));

    if (userIdsToResolve.length > 0) {
        const uniqueIds = Array.from(new Set(userIdsToResolve));
        for (let i = 0; i < uniqueIds.length; i += 100) {
            const chunk = uniqueIds.slice(i, i + 100);
            const snaps = await db.getAll(...chunk.map(id => db.collection(COLLECTIONS.USERS).doc(id)));
            snaps.forEach((userSnap: any) => {
                if (userSnap.exists) {
                    const u = userSnap.data();
                    const rawEmail = u?.email || u?.userEmail;
                    if (rawEmail) {
                        const normalizedEmail = rawEmail.toLowerCase().trim();
                        if (!emailMap.has(normalizedEmail)) {
                            emailMap.set(normalizedEmail, {
                                uid: userSnap.id,
                                email: normalizedEmail,
                                name: u?.fullName || u?.name || "User",
                                state: u?.state || u?.stateOfOrigin || u?.address?.state || "Unknown",
                                onboardingCompleted: false,
                                lastActive: new Date()
                            });
                        }
                    }
                }
            });
        }
    }
    
    const uniqueList = Array.from(emailMap.values());
    logger.info(`[BroadcastLogic] unpaid applicants: coop=${coopSnap.size}, acad=${acadSnap.size}, unique emails: ${uniqueList.length}`);

    return {
        success: true as const,
        error: null,
        data: {
            recipients: uniqueList,
            count: uniqueList.length,
            originalDocCount: coopSnap.size + acadSnap.size,
            moduleStats,
        },
    };
}

/**
 * Resolves the broadcast list EXCLUSIVELY from a specific module collection (source of truth).
 * Fetches user emails from USERS collection by userId in batches of 30.
 */
async function getCollectionBroadcastList(collectionName: string, filters?: BroadcastFilters, statusField: string = "status", userIdField: string = "userId") {
    const statusFilter = filters?.moduleStatus && filters.moduleStatus !== "all" ? filters.moduleStatus : null;

    const moduleSnap = await db.collection(collectionName).get();

    const moduleStats = { total: 0, approved: 0, pending: 0, rejected: 0, suspended: 0 };
    const userEntries: { userId: string; status: string }[] = [];
    
    let paidUserIds: Set<string> | null = null;
    if (collectionName === COLLECTIONS.COOPERATIVE_MEMBERS) {
        const paymentsSnap = await db.collection("processedPayments")
            .where("type", "==", "cooperative_membership_registration")
            .where("status", "==", "completed")
            .get();
        paidUserIds = new Set(paymentsSnap.docs.map(doc => doc.data().userId));
    }

    if (collectionName === COLLECTIONS.COOPERATIVE_MEMBERS) {
        // Cooperative Members are defined by their payment. Some might not have a member doc yet.
        const memberDocs = new Map(moduleSnap.docs.map(doc => [doc.data()[userIdField] || doc.id, doc.data()]));
        
        for (const userId of paidUserIds!) {
            const d = memberDocs.get(userId) || {};
            let status = d[statusField] || d.membershipStatus || d.status || "pending";
            if (status === "under_review" || status === "submitted" || status === "pending_review") status = "pending";

            moduleStats.total++;
            if (status === "approved" || status === "active" || status === "paid" || status === "completed") moduleStats.approved++;
            else if (status === "pending") moduleStats.pending++;
            else if (status === "rejected") moduleStats.rejected++;
            else if (status === "suspended") moduleStats.suspended++;

            if (statusFilter === "not_approved") {
                if (status === "approved" || status === "active" || status === "paid" || status === "completed") continue;
            } else if (statusFilter === "approved") {
                if (status !== "approved" && status !== "active" && status !== "paid" && status !== "completed") continue;
            } else if (statusFilter && status !== statusFilter) {
                continue;
            }

            userEntries.push({ userId, status });
        }
    } else {
        for (const doc of moduleSnap.docs) {
            const d = doc.data();
            const userId = d[userIdField] || doc.id; // Fallback to doc id if userId is missing
            if (!userId) continue;

            let status = d[statusField] || d.membershipStatus || d.status || "pending";
            if (status === "under_review" || status === "submitted" || status === "pending_review") status = "pending";

            // Enforce payment condition for Academy
            if (collectionName === COLLECTIONS.ACADEMY_APPLICATIONS) {
                if (status !== "approved" && !["completed", "paid", "successful"].includes(d.paymentStatus)) {
                    continue;
                }
            }

            // Must not count "not_started" users as enrolled
            if (status === "not_started") continue;

            moduleStats.total++;
            if (status === "approved" || status === "active" || status === "paid" || status === "completed") moduleStats.approved++;
            else if (status === "pending") moduleStats.pending++;
            else if (status === "rejected") moduleStats.rejected++;
            else if (status === "suspended") moduleStats.suspended++;

            // Apply status filter if set
            if (statusFilter === "not_approved") {
                if (status === "approved" || status === "active" || status === "paid" || status === "completed") continue;
            } else if (statusFilter === "approved") {
                if (status !== "approved" && status !== "active" && status !== "paid" && status !== "completed") continue;
            } else if (statusFilter && status !== statusFilter) {
                continue;
            }

            userEntries.push({ userId, status });
        }
    }

    // Batch-resolve emails from USERS collection (chunks of 30 to avoid limits)
    const emailMap = new Map<string, Recipient>();
    const missingEmailUserIds: string[] = []; // fallback candidates
    const CHUNK = 30;

    for (let i = 0; i < userEntries.length; i += CHUNK) {
        const chunk = userEntries.slice(i, i + CHUNK);
        const refs = chunk.map(e => db.collection(COLLECTIONS.USERS).doc(e.userId));
        const userDocs = await db.getAll(...refs);

        userDocs.forEach((userDoc, idx) => {
            if (!userDoc.exists) {
                missingEmailUserIds.push(chunk[idx].userId);
                return;
            }
            const d = userDoc.data() as any;
            const rawEmail = d.email || d.userEmail;
            if (!rawEmail) {
                missingEmailUserIds.push(userDoc.id);
                return;
            }
            const normalizedEmail = rawEmail.toLowerCase().trim();
            if (emailMap.has(normalizedEmail)) return;

            const lastActiveRaw = d.updatedAt || d.createdAt;
            emailMap.set(normalizedEmail, {
                uid: userDoc.id,
                email: normalizedEmail,
                name: d.fullName || d.firstName || "Member",
                state: d.state || d.stateOfOrigin || d.address?.state || d.verificationProfile?.address?.state || "Unknown",
                onboardingCompleted: d.onboardingCompleted || false,
                lastActive: lastActiveRaw?.toDate ? lastActiveRaw.toDate() : (lastActiveRaw ? new Date(lastActiveRaw) : new Date()),
            });
        });
    }

    // Firebase Auth fallback
    if (missingEmailUserIds.length > 0) {
        logger.info(`[BroadcastLogic][${collectionName}] Falling back to Auth for ${missingEmailUserIds.length} users with no USERS email...`);
        const { getAuth } = await import("firebase-admin/auth");
        const auth = getAuth();

        for (let i = 0; i < missingEmailUserIds.length; i += 100) {
            const chunk = missingEmailUserIds.slice(i, i + 100);
            try {
                const result = await auth.getUsers(chunk.map(uid => ({ uid })));
                result.users.forEach(authUser => {
                    if (!authUser.email) return;
                    const normalizedEmail = authUser.email.toLowerCase().trim();
                    if (emailMap.has(normalizedEmail)) return;
                    emailMap.set(normalizedEmail, {
                        uid: authUser.uid,
                        email: normalizedEmail,
                        name: authUser.displayName || "Member",
                        state: "Unknown",
                        onboardingCompleted: false,
                        lastActive: new Date(),
                    });
                });
            } catch (authErr) {
                logger.error(`[BroadcastLogic][${collectionName}] Auth fallback error:`, authErr);
            }
        }
    }

    const uniqueList = Array.from(emailMap.values());
    logger.info(`[BroadcastLogic][${collectionName}] Docs: ${moduleSnap.size}, matched: ${userEntries.length}, emails: ${uniqueList.length}`);

    return {
        success: true as const,
        error: null,
        data: {
            recipients: uniqueList,
            count: uniqueList.length,
            originalDocCount: moduleSnap.size,
            moduleStats,
        },
    };
}


/**
 * Core logic for generating broadcast lists.
 * This is decoupled from 'use server' and 'server-only' to allow use in Node.js scripts.
 */
export async function getCleanBroadcastList(filters?: BroadcastFilters) {
    try {
        logger.info(`[BroadcastLogic] Generating clean list using stream (Audience: ${filters?.audience || 'all'})...`);

        // --- DEDICATED CSV UPLOAD PATH ---
        if (filters?.audience === "csv_upload") {
            if (!filters.csvEmails || filters.csvEmails.length === 0) {
                return { success: false as const, error: "No emails provided in CSV upload.", data: null };
            }
            const uniqueEmails = Array.from(new Set(filters.csvEmails.map(e => e.toLowerCase().trim())));
            const recipients = uniqueEmails.map(email => ({
                uid: email,
                email: email,
                name: "Member",
                state: "Unknown",
                onboardingCompleted: false,
                lastActive: new Date()
            }));

            return {
                success: true as const,
                error: null,
                data: {
                    recipients,
                    count: recipients.length,
                    originalDocCount: filters.csvEmails.length,
                    moduleStats: { total: 0, approved: 0, pending: 0, rejected: 0, suspended: 0 }
                }
            };
        }

        // --- DEDICATED SELLER PATH (Source of Truth: seller_verifications collection) ---
        if (
            filters?.audience === "sellers" ||
            filters?.audience === "wholesale_sellers" ||
            filters?.audience === "retail_sellers"
        ) {
            return getSellerBroadcastList(filters);
        }

        // --- DEDICATED ABANDONED / FAILED TRANSACTIONS PATH ---
        if (filters?.audience === "abandoned_failed_transactions") {
            return getAbandonedFailedBroadcastList(filters);
        }

        // --- DEDICATED UNPAID APPLICANTS PATH ---
        if (filters?.audience === "unpaid_applicants") {
            return getUnpaidApplicantsBroadcastList(filters);
        }

        // --- DEDICATED MODULE PATHS (Source of Truth: Module specific collections) ---
        if (filters?.audience === "cooperative_members") {
            return getCollectionBroadcastList(COLLECTIONS.COOPERATIVE_MEMBERS, filters, "membershipStatus");
        }
        if (filters?.audience === "wave_applicants") {
            return getCollectionBroadcastList(COLLECTIONS.WAVE_APPLICATIONS, filters, "status");
        }
        if (filters?.audience === "wave_briefing_registrants") {
            return getCollectionBroadcastList(COLLECTIONS.WAVE_BRIEFING_REGISTRATIONS, filters, "status");
        }
        if (filters?.audience === "farm_nation_users") {
            return getCollectionBroadcastList(COLLECTIONS.FARM_NATION_APPLICATIONS, filters, "status");
        }
        if (filters?.audience === "export_users") {
            return getCollectionBroadcastList(COLLECTIONS.EXPORT_APPLICATIONS, filters, "status");
        }
        if (filters?.audience === "academy_users") {
            return getCollectionBroadcastList(COLLECTIONS.ACADEMY_APPLICATIONS, filters, "status");
        }

        // Targeted projection to minimize bandwidth
        const query = db.collection(COLLECTIONS.USERS)
            .select(
                "email",
                "userEmail",
                "fullName",
                "firstName",
                "state",
                "stateOfOrigin",
                "address",
                "onboardingCompleted",
                "updatedAt",
                "createdAt",
                "serviceRegistrations",
                "verificationProfile",
                "bankDetails",
                "marketplaceAccountType",
                "roles",
                "sellerVerificationStatus",
                "status",
                "isSeller"
            );

        const emailMap = new Map<string, Recipient>();
        let totalScanned = 0;
        let matchedAudienceCount = 0;
        const missingEmailUserIds: { uid: string; data: any }[] = [];

        const moduleStats = {
            total: 0,
            approved: 0,
            pending: 0,
            rejected: 0,
            suspended: 0
        };

        // If audience requires excluding approved cooperative members, fetch their IDs first
        const excludeIds = new Set<string>();
        if (filters?.audience === "all_except_approved_coop") {
            const approvedCoopSnap = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).where("membershipStatus", "==", "approved").get();
            const activeCoopSnap = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).where("status", "==", "approved").get();
            approvedCoopSnap.docs.forEach(doc => excludeIds.add(doc.data().userId || doc.id));
            activeCoopSnap.docs.forEach(doc => excludeIds.add(doc.data().userId || doc.id));
        }

        // Use streaming to handle high-scale user counts (37k+) safely
        await new Promise((resolve, reject) => {
            query.stream()
                .on("data", (doc) => {
                    totalScanned++;
                    const data = doc.data();
                    
                    // Delay email extraction until matchesAudience is confirmed

                    // 2. Apply Date Range Filter if present
                    if (filters?.startDate || filters?.endDate) {
                        const created = data.createdAt?.toDate ? data.createdAt.toDate() : new Date(data.createdAt);
                        if (filters.startDate && created < new Date(filters.startDate)) return;
                        if (filters.endDate && created > new Date(filters.endDate)) return;
                    }

                    // 3. High-Precision Audience Segmenting
                    const userSegment = categorizeUser(data);
                    
                    let matchesAudience = false;
                    
                    // Exclude approved cooperative members if requested
                    if (filters?.audience === "all_except_approved_coop") {
                        if (excludeIds.has(doc.id)) {
                            return; // Skip this user
                        }
                        matchesAudience = true;
                    } else if (!filters || filters.audience === "all") {
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

                        const ENROLLED_STATUSES = new Set(['pending', 'under_review', 'approved', 'active', 'paid', 'completed', 'suspended']);

                        if (filters.audience === "marketplace_onboarded") {
                            const mReg = regs.marketplace;
                            if ((mReg && ENROLLED_STATUSES.has(mReg.status)) || data.marketplaceAccountType || (data.roles && (data.roles.includes("buyer") || data.roles.includes("seller")))) { 
                                inModule = true; 
                                userStatus = mReg?.status || "approved"; 
                            }
                        } else if (filters.audience === "buyers") {
                            if (data.marketplaceAccountType === "buyer" || data.marketplaceAccountType === "both" || (data.roles && data.roles.includes("buyer"))) { 
                                inModule = true; 
                                userStatus = "approved"; 
                            }
                        }

                        if (inModule) {
                            moduleStats.total++;
                            if (userStatus === "approved") moduleStats.approved++;
                            else if (userStatus === "pending") moduleStats.pending++;
                            else if (userStatus === "rejected") moduleStats.rejected++;
                            else if (userStatus === "suspended") moduleStats.suspended++;
                            
                            if (statusFilter === "not_approved") {
                                matchesAudience = userStatus !== "approved";
                            } else {
                                matchesAudience = statusFilter ? userStatus === statusFilter : true;
                            }
                        } else {
                            if (filters.audience === "pending_applicants") {
                                matchesAudience = Object.values(regs).some((r: any) => r.status === "pending" || r.status === "submitted");
                            } else if (filters.audience === "unpaid_applicants") {
                                matchesAudience = Object.values(regs).some((r: any) => r.paymentStatus === "pending" || r.paymentStatus === "failed");
                            } else if (filters.audience === "abandoned_failed_transactions") {
                                matchesAudience = Object.values(regs).some((r: any) => r.paymentStatus === "failed" || r.paymentStatus === "abandoned");
                            }
                        }
                    }

                    if (matchesAudience) {
                        matchedAudienceCount++;
                        
                        // Handle missing email fallback
                        const rawEmail = data.email || data.userEmail;
                        if (!rawEmail) {
                            missingEmailUserIds.push({ uid: doc.id, data });
                            return;
                        }
                        
                        const normalizedEmail = rawEmail.toLowerCase().trim();
                        
                        // 4. Deduplication
                        if (!emailMap.has(normalizedEmail)) {
                            const lastActiveRaw = data.updatedAt || data.createdAt;
                            emailMap.set(normalizedEmail, {
                                uid: doc.id,
                                email: normalizedEmail,
                                name: data.fullName || data.firstName || 'Member',
                                state: data.state || data.stateOfOrigin || data.address?.state || data.verificationProfile?.address?.state || 'Unknown',
                                onboardingCompleted: data.onboardingCompleted || false,
                                lastActive: lastActiveRaw?.toDate ? lastActiveRaw.toDate() : (lastActiveRaw ? new Date(lastActiveRaw) : new Date())
                            });
                        }
                    }
                })
                .on("end", resolve)
                .on("error", reject);
        });

        // 5. Firebase Auth fallback for users with no email in USERS doc
        if (missingEmailUserIds.length > 0) {
            logger.info(`[BroadcastLogic] Falling back to Firebase Auth for ${missingEmailUserIds.length} users with no USERS email...`);
            const { getAuth } = await import("firebase-admin/auth");
            const auth = getAuth();
            for (let i = 0; i < missingEmailUserIds.length; i += 100) {
                const chunk = missingEmailUserIds.slice(i, i + 100);
                try {
                    const result = await auth.getUsers(chunk.map(u => ({ uid: u.uid })));
                    result.users.forEach(authUser => {
                        if (!authUser.email) return;
                        const normalizedEmail = authUser.email.toLowerCase().trim();
                        if (emailMap.has(normalizedEmail)) return;
                        
                        const data = chunk.find(c => c.uid === authUser.uid)?.data || {};
                        const lastActiveRaw = data.updatedAt || data.createdAt;
                        
                        emailMap.set(normalizedEmail, {
                            uid: authUser.uid,
                            email: normalizedEmail,
                            name: authUser.displayName || data.fullName || data.firstName || "Member",
                            state: data.state || data.stateOfOrigin || data.address?.state || data.verificationProfile?.address?.state || "Unknown",
                            onboardingCompleted: data.onboardingCompleted || false,
                            lastActive: lastActiveRaw?.toDate ? lastActiveRaw.toDate() : (lastActiveRaw ? new Date(lastActiveRaw) : new Date()),
                        });
                    });
                } catch (authErr) {
                    logger.error("[BroadcastLogic] Auth fallback error:", authErr);
                }
            }
        }

        logger.info(`[BroadcastLogic] Clean Sweep complete. Scanned: ${totalScanned}, Matched: ${matchedAudienceCount}, Unique: ${emailMap.size}`);

        const uniqueList = Array.from(emailMap.values());

        return {
            success: true as const,
            error: null,
            data: {
                recipients: uniqueList,
                count: uniqueList.length,
                originalDocCount: matchedAudienceCount,
                moduleStats
            }
        };

    } catch (error) {
        logger.error("[BroadcastLogic] List generation failed:", error);
        return { success: false as const, error: "Failed to generate broadcast list.", data: null };
    }
}
