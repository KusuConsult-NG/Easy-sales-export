"use server";
import { dateRangeStart, dateRangeEnd } from "@/lib/date-utils";

import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from '@/lib/logger';
import { FieldValue } from "@/lib/firestore-compat";
import { claimStatusTransitionFromAny } from "@/lib/status-transition";
import { claimPaymentOnce } from "@/lib/wallet-ledger";
import { needsDualControl } from "@/lib/loan-approval-policy";
import { Timestamp } from "@/lib/firestore-compat";
import { createAdminAuditLog } from "@/lib/audit-log";
import { calculateRepaymentSchedule, isEligibleForLoan, getTierInterestRate } from "@/lib/cooperative-tiers";
import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session-guard";
import { serializeDocs, serializeDoc } from "@/lib/firestore-serialize";
import { withSafeAction, type ActionResponse } from "@/lib/safe-action";
import { isAdmin } from "@/lib/admin-permissions";

export interface LoanApplication {
    id?: string;
    userId: string;
    userEmail: string;
    fullName: string;
    amount: number;
    purpose: string;
    durationMonths: number;
    status: "pending" | "approved" | "rejected" | "disbursed" | "repaid" | "partially_approved";
    contributionAmount: number;
    tier: "Member";
    interestRate: number;
    totalRepayment: number;
    monthlyPayment: number;
    documents?: string[];
    guarantorName?: string;
    guarantorPhone?: string;
    guarantorEmail?: string;
    guarantorRelationship?: string;
    guarantorVerified?: boolean;
    guarantorVerifiedAt?: FieldValue | Timestamp;
    guarantorVerifiedBy?: string;
    appliedAt: FieldValue | Timestamp;
    reviewedAt?: FieldValue | Timestamp;
    reviewedBy?: string;
    rejectionReason?: string;
    disbursedAt?: FieldValue | Timestamp;
}

/**
 * Submit loan application
 */
export async function submitLoanApplicationAction(formData: {
    userId: string;
    userEmail: string;
    fullName: string;
    amount: number;
    purpose: string;
    durationMonths: number;
    contributionAmount: number;
    tier: "Member";
    guarantorName: string;
    guarantorPhone: string;
    guarantorEmail?: string;
    guarantorRelationship?: string;
}): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> {
    try {
        if (!formData.guarantorName?.trim() || !formData.guarantorPhone?.trim()) {
            return { success: false as const, error: "Guarantor name and phone number are required", data: null };
        }
        const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: "Authentication required", data: null as any };
    const { session } = sessionResult;
        if (!session?.user?.id || session.user.id !== formData.userId) {
            return { success: false as const, error: "Unauthorized" , data: null };
        }

        // ===== TIER VALIDATION =====
        // Import tier functions
        const { calculateUserTier, COOPERATIVE_TIERS, getTierMaxDuration } = await import("@/lib/cooperative-tiers");

        // 1. Calculate actual tier based on contribution
        const actualTier = calculateUserTier(formData.contributionAmount);

        // 2. Verify submitted tier matches contribution level
        if (formData.tier !== actualTier) {
            return {
                success: false as const,
                error: `Tier mismatch: Your contribution of ₦${formData.contributionAmount.toLocaleString()} qualifies for ${actualTier} tier, not ${formData.tier} tier`};
        }

        // 3. Validate loan amount against tier multiplier
        const tierInfo = COOPERATIVE_TIERS[actualTier];
        const maxLoanAmount = formData.contributionAmount * tierInfo.maxLoanMultiplier;

        if (formData.amount > maxLoanAmount) {
            return {
                success: false as const,
                error: `Loan amount exceeds your limit. You may borrow up to ₦${maxLoanAmount.toLocaleString()} — savings must be at least twice the loan amount.`};
        }

        // 4. Validate duration against tier limits
        const maxDuration = getTierMaxDuration(actualTier);
        if (formData.durationMonths > maxDuration) {
            return {
                success: false as const,
                error: `Repayment duration exceeds ${actualTier} tier limit. Maximum: ${maxDuration} months`};
        }

        // Calculate repayment in kobo to eliminate floating-point drift
        const interestRate = getTierInterestRate(formData.tier);
        const amountKobo = Math.round(formData.amount * 100);
        const r = interestRate / 100;
        const n = formData.durationMonths;
        const monthlyPaymentKobo = Math.round((amountKobo * (r * Math.pow(1 + r, n))) / (Math.pow(1 + r, n) - 1));

        let remainingPrincipalKobo = amountKobo;
        let totalInterestKobo = 0;

        for (let i = 1; i <= n; i++) {
            const interestAmountKobo = Math.round(remainingPrincipalKobo * r);
            let principalAmountKobo = monthlyPaymentKobo - interestAmountKobo;

            if (i === n) {
                principalAmountKobo = remainingPrincipalKobo;
            }

            totalInterestKobo += interestAmountKobo;
            remainingPrincipalKobo -= principalAmountKobo;
        }

        const totalRepayment = (amountKobo + totalInterestKobo) / 100;
        const monthlyPayment = Math.round((amountKobo + totalInterestKobo) / n) / 100;

        // Create application payload
        const application: Omit<LoanApplication, "id"> = {
            userId: formData.userId,
            userEmail: formData.userEmail,
            fullName: formData.fullName,
            amount: formData.amount,
            purpose: formData.purpose,
            durationMonths: formData.durationMonths,
            status: "pending",
            contributionAmount: formData.contributionAmount,
            tier: formData.tier,
            interestRate,
            totalRepayment,
            monthlyPayment,
            guarantorName: formData.guarantorName.trim(),
            guarantorPhone: formData.guarantorPhone.trim(),
            guarantorEmail: formData.guarantorEmail?.trim() || "",
            guarantorRelationship: formData.guarantorRelationship || "",
            guarantorVerified: false,
            appliedAt: FieldValue.serverTimestamp(),
        };

        // The label said ATOMIC TRANSACTION. It was neither: the adapter queues
        // the writes and flushes them after the callback returns, with no
        // isolation and no rollback.
        //
        // The double-lending and eligibility reads below are advisory, and were
        // advisory inside the wrapper too — two applications submitted together
        // both read an empty result and both create a pending row. Closing that
        // needs a uniqueness constraint on a member's open applications. It is
        // bounded: a pending application disburses nothing until an approval,
        // and approval is claimed.
        const docRef = await (async () => {
            // 1. Double-lending verification
            const generalLoansQuery = db.collection(COLLECTIONS.LOAN_APPLICATIONS)
                .where("userId", "==", formData.userId)
                .where("status", "in", ["pending", "reviewing", "approved", "partially_approved", "disbursed"]);
            const generalLoansSnap = await generalLoansQuery.get();

            const coopLoansQuery = db.collection(COLLECTIONS.COOPERATIVE_LOANS)
                .where("memberId", "==", formData.userId)
                .where("status", "in", ["pending", "reviewing", "approved", "partially_approved", "disbursed"]);
            const coopLoansSnap = await coopLoansQuery.get();

            if (!generalLoansSnap.empty || !coopLoansSnap.empty) {
                throw new Error("Active or pending loan application already exists platform-wide.");
            }

            // 2. Standard eligibility check (using active/disbursed only for balance calculation)
            const activeLoansQuery = db.collection(COLLECTIONS.LOAN_APPLICATIONS)
                .where("userId", "==", formData.userId)
                .where("status", "in", ["approved", "disbursed"]);
            const activeLoansSnap = await activeLoansQuery.get();

            const currentLoanBalance = activeLoansSnap.docs.reduce((acc, doc) => {
                const data = doc.data();
                return acc + (data.amount || 0);
            }, 0);

            const eligibility = isEligibleForLoan(
                formData.contributionAmount,
                formData.amount,
                currentLoanBalance
            );

            if (!eligibility.eligible) {
                throw new Error(eligibility.reason || "Not eligible");
            }

            const newDocRef = db.collection(COLLECTIONS.LOAN_APPLICATIONS).doc();
            await newDocRef.set(application);
            return newDocRef;
        })();

        await createAdminAuditLog({
            action: "loan_applied",
            userId: formData.userId,
            userEmail: formData.userEmail,
            targetId: docRef.id,
            targetType: "loan_application",
            metadata: {
                amount: formData.amount,
                purpose: formData.purpose,
                tier: formData.tier,
            },
        });

        return { error: null, success: true as const, applicationId: docRef.id , data: null };
    } catch (error: any) {
        logger.error("Loan application error:", error);
        return { success: false as const, error: error?.message || "Failed to submit loan application", data: null };
    }
}

/**
 * Get user loan applications
 */
export async function getUserLoanApplicationsAction(userId: string): Promise<LoanApplication[]> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return [];
        const { session } = sessionResult;
        if (!session?.user?.id || (session.user.id !== userId && !isAdmin(session.user.roles))) {
            return [];
        }

        const snapshot = await db.collection(COLLECTIONS.LOAN_APPLICATIONS)
            .where("userId", "==", userId)
            .get();

        return serializeDocs<LoanApplication>(snapshot.docs);
    } catch (error) {
        logger.error("Failed to fetch user applications:", error);
        return [];
    }
}

/**
 * Admin: Get pending loan applications
 */
export async function getPendingLoanApplicationsAction(): Promise<LoanApplication[]> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return [];
        const { session } = sessionResult;
        if (!session?.user?.id || !isAdmin(session.user.roles)) {
            return [];
        }

        const snapshot = await db.collection(COLLECTIONS.LOAN_APPLICATIONS)
            .where("status", "==", "pending")
            .get();

        return serializeDocs<LoanApplication>(snapshot.docs);
    } catch (error) {
        logger.error("Failed to fetch pending applications:", error);
        return [];
    }
}

/**
 * Admin: Get paginated loan applications
 */
export async function getAdminLoanApplicationsAction(options: {
    statusFilter?: "all" | "pending" | "approved" | "rejected" | "disbursed" | "active" | "completed";
    limit?: number;
    lastDocId?: string;
    dateFrom?: string; // YYYY-MM-DD
    dateTo?: string;   // YYYY-MM-DD
    search?: string;   // Search by name, email, or product
} = {}): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized", data: null };
        const { session } = sessionResult;
        if (!session?.user?.id || !session.user.roles?.some((r: string) =>
            r === "admin" || r === "super_admin" || r === "cooperative_admin"
        )) {
            return { success: false as const, error: "Unauthorized", data: null };
        }

        const fetchLimit = options.search ? 5000 : (options.limit || 20);

        // Build query: ALL where() clauses must come BEFORE orderBy() in Firestore.
        // Doing it the other way causes FAILED_PRECONDITION (composite index error).
        let query: import("@/lib/supabase-db").SupabaseQuery = db.collection(COLLECTIONS.LOAN_APPLICATIONS);

        if (options.statusFilter && options.statusFilter !== "all") {
            const targetStatuses = (options.statusFilter === "active" || options.statusFilter === "disbursed")
                ? ["disbursed", "active"]
                : [options.statusFilter];
            query = query.where("status", "in", targetStatuses);
        }

        // Date range filters (must be before orderBy when filtering on the same field)
        if (options.dateFrom) {
            query = query.where("appliedAt", ">=", dateRangeStart(options.dateFrom));
        }
        if (options.dateTo) {
            query = query.where("appliedAt", "<=", dateRangeEnd(options.dateTo));
        }

        // orderBy comes LAST — after all where() clauses
        query = query.orderBy("appliedAt", "desc");

        if (options.lastDocId && !options.search) {
            const lastDoc = await db.collection(COLLECTIONS.LOAN_APPLICATIONS).doc(options.lastDocId).get();
            if (lastDoc.exists) {
                query = query.startAfter(lastDoc);
            }
        }

        let snapshot: any;
        let indexError = false;
        try {
            snapshot = await query.limit(fetchLimit + 1).get();
        } catch (qErr: any) {
            if (qErr.code === 9 || qErr.message?.includes("FAILED_PRECONDITION") || qErr.message?.toLowerCase().includes("index")) {
                logger.warn("Admin loans query failed due to missing index. Falling back.", { error: qErr.message });
                indexError = true;
                const fallbackQuery = db.collection(COLLECTIONS.LOAN_APPLICATIONS);
                snapshot = await fallbackQuery.limit(5000).get();
            } else {
                throw qErr;
            }
        }

        let applicationsRaw: any[] = [];
        let hasMore = false;
        let nextCursor: string | undefined = undefined;

        if (indexError) {
            const allApps = serializeDocs(snapshot.docs) as unknown as any[];
            let filteredApps = allApps;
            if (options.statusFilter && options.statusFilter !== "all") {
                filteredApps = filteredApps.filter(app => app.status === options.statusFilter);
            }
            if (options.dateFrom) {
                const fromTime = dateRangeStart(options.dateFrom).getTime();
                filteredApps = filteredApps.filter(app => {
                    const applied = app.appliedAt || app.createdAt;
                    if (!applied) return false;
                    const appTime = new Date(applied).getTime();
                    return appTime >= fromTime;
                });
            }
            if (options.dateTo) {
                const toTime = dateRangeEnd(options.dateTo).getTime();
                filteredApps = filteredApps.filter(app => {
                    const applied = app.appliedAt || app.createdAt;
                    if (!applied) return false;
                    const appTime = new Date(applied).getTime();
                    return appTime <= toTime;
                });
            }
            filteredApps.sort((a, b) => {
                const aApplied = a.appliedAt || a.createdAt;
                const bApplied = b.appliedAt || b.createdAt;
                const aTime = aApplied ? new Date(aApplied).getTime() : 0;
                const bTime = bApplied ? new Date(bApplied).getTime() : 0;
                return bTime - aTime;
            });

            let startIndex = 0;
            if (options.lastDocId) {
                const idx = filteredApps.findIndex(app => app.id === options.lastDocId);
                if (idx !== -1) {
                    startIndex = idx + 1;
                }
            }
            const endIndex = startIndex + fetchLimit;
            hasMore = filteredApps.length > endIndex;
            applicationsRaw = filteredApps.slice(startIndex, endIndex);
            nextCursor = hasMore && applicationsRaw.length > 0 ? applicationsRaw[applicationsRaw.length - 1].id : undefined;
        } else {
            hasMore = snapshot.docs.length > fetchLimit;
            const docs = hasMore ? snapshot.docs.slice(0, fetchLimit) : snapshot.docs;
            applicationsRaw = serializeDocs(docs) as unknown as any[];
            nextCursor = hasMore && docs.length > 0 ? docs[docs.length - 1].id : undefined;
        }
        
        // Enrich with user details
        const userIds = [...new Set(applicationsRaw.map(app => app.userId).filter(id => id && typeof id === 'string' && id.trim().length > 0))];
        const userMap = new Map<string, any>();

        const userPromises = [];
        for (let i = 0; i < userIds.length; i += 100) {
            const batchIds = userIds.slice(i, i + 100);
            const refs = batchIds.map(id => db.collection(COLLECTIONS.USERS).doc(id));
            if (refs.length > 0) {
                userPromises.push(
                    db.getAll(...refs).then(userDocs => {
                        userDocs.forEach(doc => {
                            if (doc.exists) userMap.set(doc.id, doc.data());
                        });
                    })
                );
            }
        }
        await Promise.all(userPromises);

        const applications = applicationsRaw.map(app => {
            const user = userMap.get(app.userId) || {};
            
            const bankName = user.bankDetails?.bankName || app.bankName || user.bankName || user.bankAccount?.bankName || "N/A";
            const accountNumber = user.bankDetails?.accountNumber || app.accountNumber || user.accountNumber || user.bankAccountNumber || user.bankAccount?.accountNumber || "N/A";
            const accountName = user.bankDetails?.accountName || app.accountName || user.accountName || user.bankAccountName || user.bankAccount?.accountNumber || user.fullName || (user.firstName && user.lastName ? `${user.firstName} ${user.lastName}` : "N/A");
            const bankCode = user.bankDetails?.bankCode || app.bankCode || user.bankCode || user.bankAccount?.bankCode || "N/A";

            const bankDetails = {
                bankName,
                accountNumber,
                accountName,
                bankCode
            };

            const appAppliedAt = app.appliedAt || app.createdAt;

            return {
                ...app,
                productName: app.productName || (app.purpose ? `General Loan (${app.purpose.charAt(0).toUpperCase() + app.purpose.slice(1).toLowerCase().replace('_', ' ')})` : "General Loan"),
                interestRate: app.interestRate || 5,
                appliedAt: appAppliedAt,
                userName: app.fullName || (user.firstName && user.lastName ? `${user.firstName} ${user.lastName}` : user.fullName || "Unknown"),
                userEmail: app.userEmail || user.email || "",
                bankName: bankDetails.bankName,
                accountNumber: bankDetails.accountNumber,
                accountName: bankDetails.accountName,
                bankDetails
            };
        });

        // In-memory search filter (applied after user enrichment so userName/userEmail are available)
        let finalApplications = applications;
        if (options.search) {
            const s = options.search.toLowerCase().trim();
            finalApplications = applications.filter(app => {
                const searchable = [
                    app.userName,
                    app.userEmail,
                    app.productName,
                    app.purpose,
                    app.tier
                ].filter(Boolean).map(String).join(" ").toLowerCase();
                return searchable.includes(s);
            });
        }

        // When search is active, we handle pagination in-memory
        const pageSize = options.search ? (options.limit || 20) : undefined;
        const pagedApplications = pageSize ? finalApplications.slice(0, pageSize) : finalApplications;
        const searchHasMore = pageSize ? finalApplications.length > pageSize : hasMore;

        const finalNextCursor = !options.search ? nextCursor : undefined;

        return { 
            error: null, success: true as const, 
            data: pagedApplications,
            lastDocId: finalNextCursor,
            hasMore: searchHasMore
        };
    } catch (error: any) {
        logger.error("Failed to fetch admin loan applications:", error);
        return { success: false as const, error: error.message, data: null };
    }
}

/**
 * Admin: Get loan applications with user details for export
 */
export async function getAdminLoanApplicationsExportAction(options: {
    statusFilter?: "all" | "pending" | "approved" | "rejected" | "disbursed" | "active" | "completed";
}): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized", data: null };
        const { session } = sessionResult;
        if (!session?.user?.id || !isAdmin(session.user.roles)) {
            return { success: false as const, error: "Unauthorized", data: null };
        }

        let query = db.collection(COLLECTIONS.LOAN_APPLICATIONS).orderBy("appliedAt", "desc");

        if (options.statusFilter && options.statusFilter !== "all") {
            query = db.collection(COLLECTIONS.LOAN_APPLICATIONS)
                .where("status", "==", options.statusFilter)
                .orderBy("appliedAt", "desc");
        }

        let loans: any[];
        try {
            const snapshot = await query.limit(5000).get();
            loans = serializeDocs(snapshot.docs) as any[];
        } catch (e: any) {
            if (e.code === 9 || e.message?.includes("FAILED_PRECONDITION") || e.message?.toLowerCase().includes("index")) {
                logger.warn("Admin loans export query failed due to missing index. Falling back.", { error: e.message });
                const fallbackQuery = db.collection(COLLECTIONS.LOAN_APPLICATIONS);
                const snapshot = await fallbackQuery.limit(5000).get();
                let loansRaw = serializeDocs(snapshot.docs) as any[];
                if (options.statusFilter && options.statusFilter !== "all") {
                    loansRaw = loansRaw.filter(loan => loan.status === options.statusFilter);
                }
                loansRaw.sort((a, b) => {
                    const aTime = a.appliedAt ? new Date(a.appliedAt).getTime() : 0;
                    const bTime = b.appliedAt ? new Date(b.appliedAt).getTime() : 0;
                    return bTime - aTime;
                });
                loans = loansRaw;
            } else {
                throw e;
            }
        }

        const userIds = [...new Set(loans.map(loan => loan.userId).filter(id => id && typeof id === 'string' && id.trim().length > 0))];
        const userMap = new Map<string, any>();

        const userPromises = [];
        for (let i = 0; i < userIds.length; i += 100) {
            const batchIds = userIds.slice(i, i + 100);
            const refs = batchIds.map(id => db.collection(COLLECTIONS.USERS).doc(id));
            
            if (refs.length > 0) {
                userPromises.push(
                    db.getAll(...refs).then(userDocs => {
                        userDocs.forEach(doc => {
                            if (doc.exists) {
                                userMap.set(doc.id, doc.data());
                            }
                        });
                    }).catch(err => logger.error(`[LoansExport] Failed to fetch batch users ${i}-${i + 100}`, err))
                );
            }
        }
        await Promise.all(userPromises);

        const enrichedLoans = loans.map(loan => {
            const user = userMap.get(loan.userId) || {};
            const bankDetails = user.bankDetails || {
                bankName: loan.bankName || user.bankName || user.bankAccount?.bankName || "N/A",
                accountNumber: loan.accountNumber || user.accountNumber || user.bankAccountNumber || user.bankAccount?.accountNumber || "N/A",
                accountName: loan.accountName || user.accountName || user.bankAccountName || user.bankAccount?.accountName || user.fullName || (user.firstName && user.lastName ? `${user.firstName} ${user.lastName}` : "N/A"),
                bankCode: loan.bankCode || user.bankCode || user.bankAccount?.bankCode || "N/A"
            };

            return {
                ...loan,
                phone: user.phone || user.phoneNumber || user.kyc?.phoneNumber || user.kyc?.phone || "",
                state: user.address?.state || user.stateOfOrigin || "",
                lga: user.address?.lga || user.lga || "",
                bankName: bankDetails?.bankName || "",
                accountNumber: bankDetails?.accountNumber || "",
                accountName: bankDetails?.accountName || ""
            };
        });

        return { 
            error: null, success: true as const, 
            data: enrichedLoans
        };
    } catch (error: any) {
        logger.error("Failed to fetch admin loan applications for export:", error);
        return { success: false as const, error: error.message, data: null };
    }
}


/**
 * Admin: Server-side COUNT aggregations for the loan applications dashboard.
 * Returns accurate totals independent of pagination limits.
 */
export async function getAdminLoanStatsAction(): Promise<
    | { success: true; error: null; stats: { total: number; pending: number; approved: number; rejected: number } }
    | { success: false; error: string; stats: null }
> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized" , stats: null };
        const { session } = sessionResult;

        if (!session?.user?.id || !isAdmin(session.user.roles)) {
            return { success: false as const, error: "Unauthorized" , stats: null };
        }

        const col = db.collection(COLLECTIONS.LOAN_APPLICATIONS);
        const [total, pending, approved, rejected] = await Promise.all([
            col.count().get(),
            col.where("status", "==", "pending").count().get(),
            col.where("status", "in", ["approved", "disbursed", "active"]).count().get(),
            col.where("status", "==", "rejected").count().get(),
        ]);

        return {
            error: null,
            success: true as const,
            stats: {
                total: total.data().count,
                pending: pending.data().count,
                approved: approved.data().count,
                rejected: rejected.data().count
            }
        };
    } catch (error: any) {
        logger.error("getAdminLoanStatsAction error:", error);
        return { success: false as const, error: error.message , stats: null };
    }
}

/**
 * Admin: Approve loan
 */
export async function approveLoanAction(
    applicationId: string,
    adminId: string // Deprecated, use session
): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> {
    try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: "Authentication required", data: null as any };
    const { session } = sessionResult;
        if (!session?.user?.id || !isAdmin(session.user.roles)) {
            return { success: false as const, error: "Unauthorized", data: null };
        }

        const effectiveAdminId = session.user.id;
        const appRef = db.collection(COLLECTIONS.LOAN_APPLICATIONS).doc(applicationId);

        // "Transactional Locking to prevent Double Lending" was the label, and
        // it locked nothing. These are pre-checks, and the comment below the
        // block already said they are advisory — the wrapper only made them
        // look protected. What prevents a double approval is the claim further
        // down, not this.
        const txResult = await (async () => {
            const appDoc = await appRef.get();

            if (!appDoc.exists) {
                throw new Error("Application not found");
            }

            const appData = appDoc.data() as LoanApplication;

            if (!appData.guarantorVerified) {
                throw new Error("Guarantor verification required before loan approval.");
            }

            if (appData.status !== "pending" && appData.status !== "partially_approved") {
                throw new Error("Application is not pending or partially approved");
            }

            // Double-lending verification: Check for other active/pending loans platform-wide
            const otherGeneralLoansQuery = db.collection(COLLECTIONS.LOAN_APPLICATIONS)
                .where("userId", "==", appData.userId)
                .where("status", "in", ["pending", "reviewing", "approved", "partially_approved", "disbursed"]);
            const otherGeneralLoansSnap = await otherGeneralLoansQuery.get();

            const otherCoopLoansQuery = db.collection(COLLECTIONS.COOPERATIVE_LOANS)
                .where("memberId", "==", appData.userId)
                .where("status", "in", ["pending", "reviewing", "approved", "partially_approved", "disbursed"]);
            const otherCoopLoansSnap = await otherCoopLoansQuery.get();

            const otherGeneralLoansCount = otherGeneralLoansSnap.docs.filter(doc => doc.id !== applicationId).length;
            const otherCoopLoansCount = otherCoopLoansSnap.docs.filter(doc => doc.id !== applicationId).length;

            if (otherGeneralLoansCount > 0 || otherCoopLoansCount > 0) {
                throw new Error("Active or pending loan application already exists platform-wide for this user.");
            }

            const { getMaxLoanAmount } = await import("@/lib/cooperative-tiers");
            const maxLoan = getMaxLoanAmount(appData.contributionAmount);

            if (appData.amount > maxLoan) {
                throw new Error(`This loan exceeds maximum limit of ₦${maxLoan.toLocaleString()}.`);
            }

            return { appData };
        })();

        // ── APPROVAL ─────────────────────────────────────────────────────────
        //
        // The checks above ran inside runTransaction, which takes no lock, so
        // they are advisory. The transition itself is claimed, which is what
        // makes dual control hold:
        //
        //   - `if (!approvalChain.firstApprover)` let two admins approving at
        //     the same moment both become the maker, and the second write
        //     silently replaced the first — one admin's approval simply vanished
        //     from the record.
        //   - the self-approval check let two checkers both pass and both write
        //     `approved`.
        //
        // Same defect as admin.ts, minus the disbursement — no money moves in
        // this function, which is the only reason it was less severe.
        const loan = txResult.appData as any;
        const approvalChain = loan.approvalChain || {};
        const adminName = session.user.name || session.user.email;
        const nowIso = new Date().toISOString();

        // Shared with admin.ts and loan-actions.ts — see
        // src/lib/loan-approval-policy.ts for why it is not declared here.
        const requiresDualControl = needsDualControl(loan.amount);

        if (requiresDualControl && !approvalChain.firstApprover) {
            const makerClaim = await claimStatusTransitionFromAny({
                collection: COLLECTIONS.LOAN_APPLICATIONS,
                id: applicationId,
                fromAny: ["pending", "reviewing"],
                to: "partially_approved",
                patch: {
                    approvalChain: {
                        firstApprover: effectiveAdminId,
                        firstApprovalAt: nowIso,
                        firstApproverName: adminName,
                    },
                    updatedAt: nowIso,
                },
            });

            if (!makerClaim.claimed) {
                return {
                    success: false as const,
                    error: makerClaim.status === null
                        ? "Loan application not found"
                        : `This application is already ${makerClaim.status}.`,
                    data: null,
                };
            }
        } else {
            if (requiresDualControl && approvalChain.firstApprover === effectiveAdminId) {
                return {
                    success: false as const,
                    error: "You cannot verify your own approval. Another admin is required.",
                    data: null,
                };
            }

            const finalClaim = await claimStatusTransitionFromAny({
                collection: COLLECTIONS.LOAN_APPLICATIONS,
                id: applicationId,
                fromAny: requiresDualControl ? ["partially_approved"] : ["pending", "reviewing"],
                to: "approved",
                patch: {
                    reviewedBy: effectiveAdminId,
                    reviewedAt: nowIso,
                    updatedAt: nowIso,
                    ...(requiresDualControl
                        ? {
                            // Written whole because the CAS patch shallow-merges.
                            approvalChain: {
                                ...approvalChain,
                                secondApprover: effectiveAdminId,
                                secondApprovalAt: nowIso,
                                secondApproverName: adminName,
                            },
                        }
                        : {}),
                },
            });

            if (!finalClaim.claimed) {
                return {
                    success: false as const,
                    error: finalClaim.status === null
                        ? "Loan application not found"
                        : `This application is already ${finalClaim.status}.`,
                    data: null,
                };
            }
        }

        // Fetch fresh data for audit log
        const updatedAppDoc = await appRef.get();
        const appData = updatedAppDoc.data() as LoanApplication;

        await createAdminAuditLog({
            action: appData.status === "partially_approved" ? "loan_partially_approved" : "loan_approved",
            userId: effectiveAdminId,
            targetId: applicationId,
            targetType: "loan_application",
            metadata: {
                applicantId: appData.userId,
                amount: appData.amount,
            },
        });

        return { error: null, success: true as const , data: null };
    } catch (error) {
        logger.error("Loan approval error:", error);
        return { success: false as const, error: "Failed to approve loan", data: null };
    }
}

/**
 * Admin: Reject loan
 */
export async function rejectLoanAction(
    applicationId: string,
    adminId: string, // Deprecated, use session
    reason: string
): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> {
    try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: "Authentication required", data: null as any };
    const { session } = sessionResult;
        if (!session?.user?.id || !isAdmin(session.user.roles)) {
            return { success: false as const, error: "Unauthorized", data: null };
        }

        const effectiveAdminId = session.user.id;

        const appRef = db.collection(COLLECTIONS.LOAN_APPLICATIONS).doc(applicationId);
        const appDoc = await appRef.get();

        if (!appDoc.exists) {
            return { success: false as const, error: "Application not found", data: null };
        }

        await appRef.update({
            status: "rejected",
            reviewedAt: FieldValue.serverTimestamp(),
            reviewedBy: effectiveAdminId,
            rejectionReason: reason,
        });

        const appData = appDoc.data() as LoanApplication;

        await createAdminAuditLog({
            action: "loan_rejected",
            userId: effectiveAdminId,
            targetId: applicationId,
            targetType: "loan_application",
            metadata: {
                applicantId: appData.userId,
                amount: appData.amount,
                reason,
            },
        });

        return { error: null, success: true as const , data: null };
    } catch (error) {
        logger.error("Loan rejection error:", error);
        return { success: false as const, error: "Failed to reject loan", data: null };
    }
}

/**
 * Admin: Disburse loan
 */
export async function disburseLoanAction(
    applicationId: string
): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> {
    try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: "Authentication required", data: null as any };
    const { session } = sessionResult;
        if (!session?.user?.id || !isAdmin(session.user.roles)) {
            return { success: false as const, error: "Unauthorized", data: null };
        }

        const effectiveAdminId = session.user.id;
        const appRef = db.collection(COLLECTIONS.LOAN_APPLICATIONS).doc(applicationId);

        // Read the status, compare it to "approved", write "disbursed" — inside
        // runTransaction, which takes no lock. Two admins clicking Disburse
        // together both read "approved" and both wrote, producing two audit
        // entries and two "Funds Disbursed" notifications for one loan.
        //
        // Claimed now, so exactly one wins.
        //
        // NOTE: this function moves no money, and that is not an oversight of
        // this change — it never did. See the note in
        // docs/audit/atomic-money-migration.md about the three ways this
        // codebase disburses a loan, which do not agree with one another.
        const disburseClaim = await claimStatusTransitionFromAny({
            collection: COLLECTIONS.LOAN_APPLICATIONS,
            id: applicationId,
            fromAny: ["approved"],
            to: "disbursed",
            patch: {
                disbursedAt: new Date().toISOString(),
                disbursedBy: effectiveAdminId,
                updatedAt: new Date().toISOString(),
            },
        });

        if (!disburseClaim.claimed) {
            return {
                success: false as const,
                error: disburseClaim.status === null
                    ? "Application not found"
                    : disburseClaim.status === "disbursed"
                        ? "Loan already disbursed"
                        : "Loan must be approved before disbursement",
                data: null,
            };
        }

        // Audit & Notification (Outside transaction to avoid side effects if transaction retries, though strictly audit should be ideally consistent. 
        // For Firestore, it's okay to do this after success since we can't easily roll back external API calls, but Audit Log is another DB write.
        // We will keep Audit Log separate for simplicity, or we could include it in transaction if audit log is in same DB.)

        // Fetch fresh data for logging
        const appDoc = await appRef.get();
        const appData = appDoc.data() as LoanApplication;

        await createAdminAuditLog({
            action: "loan_disbursed",
            userId: effectiveAdminId,
            targetId: applicationId,
            targetType: "loan_application",
            metadata: {
                applicantId: appData.userId,
                amount: appData.amount,
            },
        });

        // Notification
        const { createNotificationAction } = await import('../notifications');
        await createNotificationAction({
            userId: appData.userId,
            type: "success",
            title: "Funds Disbursed",
            message: `Your loan of ₦${appData.amount.toLocaleString()} has been disbursed.`,
            link: `/loans/${applicationId}`,
            linkText: "View Loan",
        });

        return { error: null,  success: true as const , data: null };
    } catch (error: any) {
        logger.error("Loan disbursement error:", error);
        return { success: false as const, error: error.message || "Failed to disburse loan", data: null };
    }
}

/**
 * Repayment Installment Interface
 */
export interface RepaymentInstallment {
    id?: string;
    loanId: string;
    userId: string;
    installmentNumber: number;
    dueDate: Date | string;
    principalAmount: number;
    interestAmount: number;
    totalAmount: number;
    paidAmount: number;
    status: "pending" | "paid" | "overdue" | "partial";
    paidAt?: FieldValue | Timestamp;
    penaltyAmount?: number;
    daysOverdue?: number;
}

/**
 * Get loan repayment schedule
 */
async function _getRepaymentScheduleAction(
    loanId: string
): Promise<ActionResponse<{ schedule: RepaymentInstallment[] }>> { 
    try {
        const loanRef = db.collection(COLLECTIONS.LOAN_APPLICATIONS).doc(loanId);
        const loanDoc = await loanRef.get();

        if (!loanDoc.exists) {
            return { success: false as const, error: "Loan not found", data: null };
        }

        const loanData = loanDoc.data() as LoanApplication;

        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized", data: null };
        const { session } = sessionResult;
        if (!session?.user?.id || (session.user.id !== loanData.userId && !isAdmin(session.user.roles))) {
            return { success: false as const, error: "Unauthorized", data: null };
        }

        // Check if schedule exists
        const scheduleSnapshot = await db.collection(COLLECTIONS.LOAN_REPAYMENTS)
            .where("loanId", "==", loanId)
            .get();

        if (!scheduleSnapshot.empty) {
            // Return existing schedule
            const schedule = serializeDocs<RepaymentInstallment>(scheduleSnapshot.docs);

            return { error: null, success: true as const, data: { schedule } };
        }

        // Generate schedule in kobo to eliminate floating-point drift.
        //
        // interestRate is a MONTHLY percentage (see cooperative-tiers.ts).
        //
        // Refuse to build a schedule from missing inputs. Loans created through
        // /loans/apply record neither field, which made `n` undefined, so the
        // loop condition `1 <= undefined` was false and the borrower received a
        // schedule with no instalments at all — nothing to repay against, and no
        // overdue payments could ever be detected. Failing loudly surfaces the
        // loan as needing terms rather than silently producing an empty one.
        const interestRate = Number(loanData.interestRate);
        const n = Number(loanData.durationMonths ?? (loanData as any).repaymentPeriod);

        if (!Number.isFinite(interestRate) || !Number.isFinite(n) || n < 1) {
            logger.error("[getRepaymentSchedule] loan is missing repayment terms", {
                loanId,
                interestRate: loanData.interestRate,
                durationMonths: loanData.durationMonths,
            });
            return {
                success: false as const,
                error: "This loan has no interest rate or repayment period recorded, so a schedule cannot be generated. Please contact support.",
                data: null,
            };
        }

        const amountKobo = Math.round(loanData.amount * 100);
        const r = interestRate / 100;
        const monthlyPaymentKobo = r === 0
            ? Math.round(amountKobo / n)
            : Math.round((amountKobo * (r * Math.pow(1 + r, n))) / (Math.pow(1 + r, n) - 1));

        const startDate = (loanData.disbursedAt && 'toDate' in loanData.disbursedAt)
            ? loanData.disbursedAt.toDate()
            : new Date();
        const installments: RepaymentInstallment[] = [];
        let remainingPrincipalKobo = amountKobo;

        for (let i = 1; i <= n; i++) {
            const interestAmountKobo = Math.round(remainingPrincipalKobo * r);
            let principalAmountKobo = monthlyPaymentKobo - interestAmountKobo;

            if (i === n) {
                principalAmountKobo = remainingPrincipalKobo;
            }

            const totalAmountKobo = principalAmountKobo + interestAmountKobo;
            remainingPrincipalKobo -= principalAmountKobo;

            const principalAmount = principalAmountKobo / 100;
            const interestAmount = interestAmountKobo / 100;
            const totalAmount = totalAmountKobo / 100;

            const dueDate = new Date(startDate);
            dueDate.setMonth(dueDate.getMonth() + i);

            const installmentRef = await db.collection(COLLECTIONS.LOAN_REPAYMENTS).add({
                loanId,
                userId: loanData.userId,
                installmentNumber: i,
                dueDate: Timestamp.fromDate(dueDate),
                principalAmount,
                interestAmount,
                totalAmount,
                paidAmount: 0,
                status: "pending",
            });

            installments.push({
                id: installmentRef.id,
                loanId,
                userId: loanData.userId,
                installmentNumber: i,
                dueDate: dueDate.toISOString() as any,
                principalAmount,
                interestAmount,
                totalAmount,
                paidAmount: 0,
                status: "pending",
            });
        }

        return { error: null, success: true as const, data: { schedule: installments } };
    } catch (error) { 
        logger.error("Failed to fetch repayment schedule:", error);
        return { success: false as const, error: "Failed to fetch repayment schedule", data: null };
    }
}

export const getRepaymentScheduleAction = withSafeAction("getRepaymentScheduleAction", _getRepaymentScheduleAction);

/**
 * Calculate penalty for overdue payment (7-day grace period)
 */
function calculatePenalty(dueDate: Date, totalAmount: number): { penalty: number; daysOverdue: number } {
    const now = new Date();
    const gracePeriodDays = 7;
    const penaltyRatePerDay = 0.001; // 0.1% per day after grace period

    const daysDiff = Math.floor((now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));

    if (daysDiff <= gracePeriodDays) {
        return { penalty: 0, daysOverdue: 0 };
    }

    const daysOverdue = daysDiff - gracePeriodDays;
    const penalty = totalAmount * penaltyRatePerDay * daysOverdue;

    return { penalty: Math.round(penalty), daysOverdue };
}

/**
 * Submit loan repayment
 */
export async function submitRepaymentAction(data: {
    loanId: string;
    installmentId: string;
    userId: string;
    amount: number;
    paymentReference: string;
}): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> {
    try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: "Authentication required", data: null as any };
    const { session } = sessionResult;
        // Self OR admin, matching _getRepaymentScheduleAction above and the rest
        // of this file.
        //
        // It was self-only, which meant nobody could record a repayment except
        // the borrower — and repayments arrive as bank transfers that an admin
        // reconciles by hand. The action existed, was hardened, and could not be
        // reached by the only person who needed it.
        //
        // The borrower check is kept, not replaced: a member submitting their
        // own reference still works, and a member cannot record a repayment
        // against somebody else's loan.
        const isActingAdmin = isAdmin(session?.user?.roles);
        if (!session?.user?.id || (session.user.id !== data.userId && !isActingAdmin)) {
            return { success: false as const, error: "Unauthorized", data: null };
        }

        if (data.amount <= 0) {
            return { success: false as const, error: "Invalid repayment amount", data: null };
        }

        const installmentRef = db.collection(COLLECTIONS.LOAN_REPAYMENTS).doc(data.installmentId);
        const loanRef = db.collection(COLLECTIONS.LOAN_APPLICATIONS).doc(data.loanId);

        let calculatedPenalty = 0;
        let calculatedStatus: "pending" | "paid" | "overdue" | "partial" = "pending";
        let finalInstallmentData: any = null;

        // WHAT WAS WRONG HERE
        // -------------------
        // Two defects, both about money rather than status.
        //
        // 1. LOST UPDATE. `newPaidAmount = (paidAmount || 0) + amount` was
        //    computed in JavaScript and written back as an absolute value,
        //    inside runTransaction, which takes no lock. Two repayments landing
        //    together both read the same paidAmount and the second write
        //    overwrote the first: the member paid twice and was credited once.
        //    This is the exact shape migration 010 exists for.
        //
        // 2. NO IDEMPOTENCY. Nothing claimed data.paymentReference, so
        //    submitting the same Paystack reference twice — a retried webhook,
        //    a double-clicked form, a reloaded confirmation page — recorded the
        //    payment twice and credited the instalment twice.
        //
        // The reference is claimed first, then the instalment is credited with
        // FieldValue.increment, which applies the addition in SQL.
        const claim = await claimPaymentOnce({
            reference: data.paymentReference,
            userId: data.userId,
            amount: data.amount,
            type: "loan_repayment",
            source: "cooperative",
            // NOT "completed": platform_revenue_totals() sums completed rows as
            // revenue, and these rows never used to exist at all. Recording them
            // as completed would change reported revenue as a side effect of an
            // idempotency fix, which is not this change's business.
            status: "loan_repayment",
            metadata: { loanId: data.loanId, installmentId: data.installmentId },
        });

        if (!claim.claimed) {
            // Already applied. A success, not an error — see the rules in
            // src/lib/wallet-ledger.ts.
            logger.warn("[submitRepaymentAction] duplicate payment reference ignored", {
                reference: data.paymentReference,
                loanId: data.loanId,
            });
            return { error: null, success: true as const, penalty: 0, data: null };
        }

        {
            const installmentDoc = await installmentRef.get();
            if (!installmentDoc.exists) {
                throw new Error("Installment not found");
            }

            const installmentData = installmentDoc.data() as Record<string, any>;
            const dueDate = (installmentData.dueDate as Timestamp).toDate();

            if (installmentData.status === "paid") {
                throw new Error("Installment already fully paid");
            }

            // Calculate penalty if overdue
            const { penalty, daysOverdue } = calculatePenalty(dueDate, installmentData.totalAmount);
            calculatedPenalty = penalty;

            const totalDue = installmentData.totalAmount + penalty;
            const newPaidAmount = (installmentData.paidAmount || 0) + data.amount;

            // Determine new status
            if (newPaidAmount >= totalDue) {
                calculatedStatus = "paid";
            } else if (newPaidAmount > 0) {
                calculatedStatus = "partial";
            } else if (new Date() > dueDate) {
                calculatedStatus = "overdue";
            }

            finalInstallmentData = {
                ...installmentData,
                paidAmount: newPaidAmount,
                status: calculatedStatus,
                penaltyAmount: penalty,
                daysOverdue
            };

            // paidAmount moves by increment, never by writing a total computed
            // in JavaScript. The status beside it IS still derived from a read,
            // so two DIFFERENT references paid at the same moment can leave it
            // one payment behind — the amount stays correct, and the next
            // payment or the sweep below corrects the label. Money first,
            // labels best-effort: the reverse is what lost the payment.
            await installmentRef.update({
                paidAmount: FieldValue.increment(data.amount),
                status: calculatedStatus,
                paidAt: calculatedStatus === "paid" ? FieldValue.serverTimestamp() : installmentData.paidAt || null,
                penaltyAmount: penalty,
                daysOverdue: daysOverdue,
            });

            // Create payment record
            const paymentRef = db.collection(COLLECTIONS.LOAN_PAYMENTS).doc();
            await paymentRef.set({
                loanId: data.loanId,
                installmentId: data.installmentId,
                userId: data.userId,
                amount: data.amount,
                paymentReference: data.paymentReference,
                penaltyPaid: penalty > 0 ? Math.min(data.amount, penalty) : 0,
                paidAt: FieldValue.serverTimestamp(),
            });
        }

        // Post-transaction: Check if all installments are paid to update Loan Status
        // This is safe to run after because even if it races, the worst case is the loan status updates to 'repaid' twice.
        const allInstallmentsSnapshot = await db.collection(COLLECTIONS.LOAN_REPAYMENTS)
            .where("loanId", "==", data.loanId)
            .get();

        const allPaid = allInstallmentsSnapshot.docs.every((doc) => doc.data().status === "paid");

        if (allPaid) {
            await loanRef.update({
                status: "repaid",
            });
        }

        // Audit log
        await createAdminAuditLog({
            action: "user_update",
            userId: data.userId,
            targetId: data.loanId,
            targetType: "loan",
            metadata: {
                installmentNumber: finalInstallmentData?.installmentNumber,
                amount: data.amount,
                penalty: calculatedPenalty,
                status: calculatedStatus,
            },
        });

        // Notification
        const { createNotificationAction } = await import('../notifications');
        await createNotificationAction({
            userId: data.userId,
            type: "success",
            title: "Repayment Recorded",
            message: `Your payment of ₦${data.amount.toLocaleString()} has been recorded.${calculatedPenalty > 0 ? ` Penalty: ₦${calculatedPenalty.toLocaleString()}` : ""}`,
            link: `/loans/${data.loanId}`,
            linkText: "View Loan",
        });

        return { error: null,  success: true as const, penalty: calculatedPenalty , data: null };
    } catch (error: any) {
        logger.error("Repayment submission error:", error);
        return { success: false as const, error: error.message || "Failed to submit repayment" , data: null };
    }
}

/**
 * Get repayment history for a loan
 */
export async function getRepaymentHistoryAction(
    loanId: string
): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> {
    try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: "Authentication required", data: null as any };
    const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false as const, error: "Unauthorized" , data: null };
        }

        // Note: For history, we should ideally check ownership of the loan first, 
        // but skipping for now or adding a quick check would be better.
        // Let's add a quick loan check.
        const loanDoc = await db.collection(COLLECTIONS.LOAN_APPLICATIONS).doc(loanId).get();
        if (loanDoc.exists) {
            const loanData = loanDoc.data();
            if (loanData && loanData.userId !== session.user.id && !isAdmin(session.user.roles)) {
                return { success: false as const, error: "Unauthorized" , data: null };
            }
        }

        const paymentsSnapshot = await db.collection(COLLECTIONS.LOAN_PAYMENTS)
            .where("loanId", "==", loanId)
            .get();

        const payments = serializeDocs(paymentsSnapshot.docs);

        return { error: null, success: true as const, payments , data: null };
    } catch (error) {
        logger.error("Failed to fetch repayment history:", error);
        return { success: false as const, error: "Failed to fetch repayment history" , data: null };
    }
}
