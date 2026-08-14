"use server";

import { dateRangeStart, dateRangeEnd } from "@/lib/date-utils";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from '@/lib/logger';
import { FieldValue } from "@/lib/firestore-compat";
import { createAdminAuditLog } from "@/lib/audit-log";
import { isEligibleForLoan, getTierInterestRate } from "@/lib/cooperative-tiers";
import { requireSession } from "@/lib/session-guard";
import { serializeDocs } from "@/lib/firestore-serialize";
import { isAdmin } from "@/lib/admin-permissions";
import type { LoanApplication } from "@/lib/types/cooperative-loans";

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
/** How many rows one loan export will read. */
const EXPORT_ROW_CAP = 5000;


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
            const snapshot = await query.limit(EXPORT_ROW_CAP).get();
            loans = serializeDocs(snapshot.docs) as any[];
        } catch (e: any) {
            if (e.code === 9 || e.message?.includes("FAILED_PRECONDITION") || e.message?.toLowerCase().includes("index")) {
                logger.warn("Admin loans export query failed due to missing index. Falling back.", { error: e.message });
                const fallbackQuery = db.collection(COLLECTIONS.LOAN_APPLICATIONS);
                const snapshot = await fallbackQuery.limit(EXPORT_ROW_CAP).get();
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

        // Say so when the export is a portion.
        //
        // Both query paths cap at 5,000 rows and neither said anything about it,
        // so an export that hit the cap was indistinguishable from a complete
        // one — the same shape as the audit-log export in #150, which was
        // silently the last fifty rows.
        //
        // 5,000 is left as it is; it is a reasonable ceiling and raising it is a
        // separate judgement. What was missing is the caller being able to tell.
        const truncated = enrichedLoans.length >= EXPORT_ROW_CAP;
        if (truncated) {
            logger.error(
                `[LoansExport] Hit the ${EXPORT_ROW_CAP}-row cap. The export is INCOMPLETE — ` +
                `narrow the status filter or add a date range.`
            );
        }

        return { 
            error: null, success: true as const, 
            data: enrichedLoans,
            truncated,
            rowCap: EXPORT_ROW_CAP
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
