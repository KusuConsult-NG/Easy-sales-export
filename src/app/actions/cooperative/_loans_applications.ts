"use server";

import { dateRangeStart, dateRangeEnd } from "@/lib/date-utils";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from '@/lib/logger';
import { FieldValue } from "@/lib/firestore-compat";
import { createAdminAuditLog } from "@/lib/audit-log";
import { isEligibleForLoan, getTierInterestRate, DEFAULT_MONTHLY_INTEREST_RATE } from "@/lib/cooperative-tiers";
import { requireSession } from "@/lib/session-guard";
import { serializeDocs } from "@/lib/firestore-serialize";
import { isAdmin, hasAdminPermission } from "@/lib/admin-permissions";
import type { LoanApplication } from "@/lib/types/cooperative-loans";
import { normaliseLoanApplication, LOAN_APPLICATION_COLLECTIONS, resolveLoanApplication, ONE_OPEN_LOAN_APPLICATION_MESSAGE } from "@/lib/loan-application-location";
import { findCooperativeMemberRow } from "@/lib/cooperative-member-lookup";
import { readCooperativeBalance } from "@/lib/cooperative-member-balance";

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

        /**
         *   #345 SECURITY: THE SAVINGS FIGURE EVERY ELIGIBILITY RULE RAN ON WAS
         *        THE CALLER'S.
         *
         *        `formData.contributionAmount` came from the browser and was
         *        the sole input to the tier, the 0.5x loan cap and
         *        isEligibleForLoan(). This is a "use server" export, so a
         *        request carrying `contributionAmount: 50_000_000` cleared the
         *        ₦5,000 minimum and the cap and filed a pending application for
         *        ₦25m against a member with nothing saved. Approval is a
         *        separate admin claim, so no money moved — but the queue an
         *        admin works from was fillable with applications the rules
         *        forbid.
         *
         *        api/cooperative/apply-loan, the other writer of this
         *        collection, already reads the savings off the membership row.
         *        This one now does the same, and the caller's figure is
         *        ignored — kept on the type so existing callers compile, and
         *        recorded on the application only as what the member CLAIMED.
         *
         *        The row is located through findCooperativeMemberRow and the
         *        balance read through readCooperativeBalance, so that
         *        introducing this read does not refuse a member whose row has
         *        an auto-generated id or whose savings sit under the legacy
         *        `balance` field. See both modules for why either happens.
         */
        const memberRow = await findCooperativeMemberRow(
            db.collection(COLLECTIONS.COOPERATIVE_MEMBERS), session.user.id,
        );
        if (!memberRow) {
            return { success: false as const, error: "You must be a cooperative member to apply for a loan", data: null };
        }
        const savingsBalance = readCooperativeBalance(memberRow.data);

        // ===== TIER VALIDATION =====
        // Import tier functions
        const { calculateUserTier, COOPERATIVE_TIERS, getTierMaxDuration } = await import("@/lib/cooperative-tiers");

        // 1. Calculate actual tier based on the member's RECORDED savings
        const actualTier = calculateUserTier(savingsBalance);

        // 2. Verify submitted tier matches contribution level
        if (formData.tier !== actualTier) {
            return {
                success: false as const,
                error: `Tier mismatch: Your savings of ₦${savingsBalance.toLocaleString()} qualify for ${actualTier} tier, not ${formData.tier} tier`};
        }

        // 3. Validate loan amount against tier multiplier
        const tierInfo = COOPERATIVE_TIERS[actualTier];
        const maxLoanAmount = savingsBalance * tierInfo.maxLoanMultiplier;

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
            // Which product this is — see lib/loan-product.ts. LOAN_APPLICATIONS
            // holds two and no row said which, so every admin queue showed both.
            loanProduct: "cooperative" as const,
            userId: formData.userId,
            userEmail: formData.userEmail,
            fullName: formData.fullName,
            amount: formData.amount,
            purpose: formData.purpose,
            durationMonths: formData.durationMonths,
            status: "pending",
            // The figure the rules ran on, and — separately — what the form
            // sent, so a mismatch is visible on the record rather than lost.
            contributionAmount: savingsBalance,
            claimedContributionAmount: formData.contributionAmount,
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
                // #288. Reaches the caller through `error?.message` in this
                // file's catch, so it is UI copy. Shared with the other doors.
                throw new Error(ONE_OPEN_LOAN_APPLICATION_MESSAGE);
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
                savingsBalance,
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

        // The member's own list, missing the applications they actually filed.
        //
        // /cooperatives/my-loans renders this. Applications submitted through
        // /cooperatives/loans go to cooperative_loans keyed by `memberId`, so a
        // query of loan_applications by `userId` returned none of them — a
        // member's loan history showed nothing while their loan was live.
        //
        // Both collections, with the borrower key each one uses. Same split the
        // admin queue was fixed for; see lib/loan-application-location.ts.
        const [generalSnap, coopSnap] = await Promise.all([
            db.collection(COLLECTIONS.LOAN_APPLICATIONS).where("userId", "==", userId).get(),
            db.collection(COLLECTIONS.COOPERATIVE_LOANS).where("memberId", "==", userId).get(),
        ]);

        return [
            ...serializeDocs<LoanApplication>(generalSnap.docs),
            ...serializeDocs<LoanApplication>(coopSnap.docs).map(
                (row) => normaliseLoanApplication(row as any, COLLECTIONS.COOPERATIVE_LOANS) as unknown as LoanApplication
            ),
        ];
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

        // Both collections, for the reason set out on the admin queue below:
        // the member loan page files into cooperative_loans and nothing else,
        // so a reader of loan_applications alone reports no pending
        // applications while members are waiting on theirs.
        const snapshots = await Promise.all(
            LOAN_APPLICATION_COLLECTIONS.map((name) =>
                db.collection(name).where("status", "==", "pending").get()
                    .then((snap) => ({ name, snap }))
            )
        );

        return snapshots.flatMap(({ name, snap }) =>
            serializeDocs<LoanApplication>(snap.docs)
                .map((row) => normaliseLoanApplication(row as any, name) as unknown as LoanApplication)
        );
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

        /**
         * Bank details go only to the callers who can act on these records.
         *
         * The three-role list above is hand-written rather than taken from the
         * matrix, which is its own small drift; the permission below is the one
         * approving a loan requires, and every row here carries an applicant's
         * account number, account name and bank code.
         */
        const maySeeBankDetails = hasAdminPermission(session.user.roles, "cooperatives:approve_loans");

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

        // NEXT PAGE SHOWED PAGE ONE AGAIN.
        //
        // The cursor is the id of the last row on the page just shown, and after
        // the merge below that row may be a cooperative_loans one. Looked up in
        // loan_applications alone it did not exist, `startAfter` was silently
        // skipped, and the query returned the first page — so an admin clicking
        // Next Page saw the same applications, with the page number incrementing
        // underneath them.
        //
        // Resolved across both collections. The adapter reads the ordering field
        // off the snapshot (appliedAt, which both shapes carry), so a cursor from
        // either collection pages the query correctly.
        if (options.lastDocId && !options.search) {
            const lastDoc = await resolveLoanApplication(options.lastDocId);
            if (lastDoc) {
                query = query.startAfter(lastDoc.snap);
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

        // THE MEMBER-FACING APPLICATIONS WERE NOT IN THIS LIST AT ALL.
        //
        // Loan applications are written to TWO collections by three paths:
        //
        //   loan_applications   submitLoanApplicationAction (the wizard),
        //                       /api/cooperative/apply-loan, loan-actions.ts
        //   cooperative_loans   _applyForLoanAction — and that is the ONLY path
        //                       the member loan page at /cooperatives/loans
        //                       submits through
        //
        // This queue read loan_applications alone. So every application a
        // member actually filed through the UI was invisible to every admin,
        // permanently: the member saw "application submitted", the approval
        // queue stayed empty, and nothing anywhere reported a discrepancy.
        // cooperative_loans is read elsewhere — for eligibility checks, reports
        // and the member's own history — so the rows were not orphaned, just
        // unreviewable.
        //
        // Both are read and merged here rather than repointing the writer,
        // because applications already exist in both and moving the writer
        // would strand every row filed to date.
        //
        // Field names differ between the two — cooperative_loans keys the
        // borrower as `memberId` — so they are normalised to `userId`, which is
        // what the enrichment below and the admin UI both expect.
        try {
            const coopLoansSnap = await db.collection(COLLECTIONS.COOPERATIVE_LOANS)
                .limit(fetchLimit + 1)
                .get();

            // The merged rows are filtered by the SAME criteria as the query
            // above, rather than by status alone.
            //
            // Two ways that went wrong. The status filter compared to
            // options.statusFilter directly, while the query maps "active" and
            // "disbursed" both onto ["disbursed", "active"] — so filtering the
            // queue to disbursed loans dropped every merged one recorded as
            // "active", and vice versa. And the date range was not applied at
            // all: an admin narrowing the queue to last week still saw every
            // cooperative_loans row ever filed, mixed in with a correctly
            // filtered list, with nothing to indicate the two halves obeyed
            // different rules.
            const wantedStatuses = (!options.statusFilter || options.statusFilter === "all")
                ? null
                : (options.statusFilter === "active" || options.statusFilter === "disbursed")
                    ? ["disbursed", "active"]
                    : [options.statusFilter];

            const fromTime = options.dateFrom ? dateRangeStart(options.dateFrom).getTime() : null;
            const toTime = options.dateTo ? dateRangeEnd(options.dateTo).getTime() : null;

            const coopLoans = (serializeDocs(coopLoansSnap.docs) as unknown as any[])
                .map(row => normaliseLoanApplication(row, COLLECTIONS.COOPERATIVE_LOANS))
                .filter(row => {
                    if (wantedStatuses && !wantedStatuses.includes(row.status)) return false;

                    if (fromTime !== null || toTime !== null) {
                        const applied = row.appliedAt || row.createdAt;
                        if (!applied) return false;
                        const appTime = new Date(applied).getTime();
                        if (!Number.isFinite(appTime)) return false;
                        if (fromTime !== null && appTime < fromTime) return false;
                        if (toTime !== null && appTime > toTime) return false;
                    }

                    return true;
                });

            if (coopLoans.length > 0) {
                const seen = new Set(applicationsRaw.map(a => a.id));
                const merged = [...applicationsRaw, ...coopLoans.filter(r => !seen.has(r.id))];

                merged.sort((a, b) => {
                    const aTime = new Date(a.appliedAt || a.createdAt || 0).getTime();
                    const bTime = new Date(b.appliedAt || b.createdAt || 0).getTime();
                    return bTime - aTime;
                });

                hasMore = merged.length > fetchLimit;
                applicationsRaw = merged.slice(0, fetchLimit);
                nextCursor = hasMore && applicationsRaw.length > 0
                    ? applicationsRaw[applicationsRaw.length - 1].id
                    : undefined;
            }
        } catch (coopErr: any) {
            // A failure reading the second collection must not blank the queue —
            // half a list is better than none, and it is logged rather than
            // swallowed so the gap is visible.
            logger.error("[getAdminLoanApplicationsAction] Failed to read cooperative_loans; queue is incomplete", {
                error: coopErr?.message,
            });
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

            const bankDetails = maySeeBankDetails
                ? { bankName, accountNumber, accountName, bankCode }
                : undefined;

            const appAppliedAt = app.appliedAt || app.createdAt;

            return {
                ...app,
                productName: app.productName || (app.purpose ? `General Loan (${app.purpose.charAt(0).toUpperCase() + app.purpose.slice(1).toLowerCase().replace('_', ' ')})` : "General Loan"),
                /**
                 * THE FALLBACK SHOWED HALF THE REAL RATE.
                 *
                 * This was a hardcoded `|| 5`. DEFAULT_MONTHLY_INTEREST_RATE is
                 * 10 — so any application row that does not carry its own rate
                 * was displayed to the reviewing admin at 5% while 10% is what
                 * getTierInterestRate actually applies. Not a duplicate of the
                 * canonical number: a stale copy that disagrees with it.
                 *
                 * Found by widening lib/testing/policy-constant-scan.ts, which
                 * exists for exactly this and could not previously see a literal
                 * used as a `||` fallback.
                 */
                interestRate: app.interestRate || DEFAULT_MONTHLY_INTEREST_RATE,
                appliedAt: appAppliedAt,
                userName: app.fullName || (user.firstName && user.lastName ? `${user.firstName} ${user.lastName}` : user.fullName || "Unknown"),
                userEmail: app.userEmail || user.email || "",
                // The flattened copies are the same data under other names, so
                // they follow the same gate.
                ...(bankDetails ? {
                    bankName: bankDetails.bankName,
                    accountNumber: bankDetails.accountNumber,
                    accountName: bankDetails.accountName,
                    bankDetails,
                } : {}),
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

        // The export covered one of the queue's two collections.
        //
        // The list an admin exports from merges loan_applications and
        // cooperative_loans; this read the first alone, so the CSV silently
        // omitted every application a member filed through the UI. A report that
        // is a strict subset of the screen it was taken from, with no indication
        // that it is, is worse than no report.
        try {
            const coopSnap = await db.collection(COLLECTIONS.COOPERATIVE_LOANS)
                .limit(EXPORT_ROW_CAP)
                .get();

            const coopLoans = (serializeDocs(coopSnap.docs) as any[])
                .map(row => normaliseLoanApplication(row, COLLECTIONS.COOPERATIVE_LOANS))
                .filter(row => !options.statusFilter
                    || options.statusFilter === "all"
                    || ((options.statusFilter === "active" || options.statusFilter === "disbursed")
                        ? ["disbursed", "active"].includes(row.status)
                        : row.status === options.statusFilter));

            const seen = new Set(loans.map(l => l.id));
            loans = [...loans, ...coopLoans.filter(r => !seen.has(r.id))];
            loans.sort((a, b) => {
                const aTime = new Date(a.appliedAt || a.createdAt || 0).getTime();
                const bTime = new Date(b.appliedAt || b.createdAt || 0).getTime();
                return bTime - aTime;
            });
        } catch (coopErr: any) {
            logger.error("[LoansExport] Failed to read cooperative_loans; the export is incomplete", {
                error: coopErr?.message,
            });
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

        // THE CARDS CONTRADICTED THE TABLE UNDERNEATH THEM.
        //
        // /admin/cooperatives/loans renders these four counts above a queue that
        // merges loan_applications AND cooperative_loans. These counted the first
        // collection alone, so an admin looking at a list of pending member
        // applications saw "Pending: 0" over the top of them — and had no way to
        // tell which of the two numbers was the honest one.
        //
        // Counted across both, the same pair the queue reads.
        const counts = await Promise.all(
            LOAN_APPLICATION_COLLECTIONS.map(async (name) => {
                const col = db.collection(name);
                const [total, pending, approved, rejected] = await Promise.all([
                    col.count().get(),
                    col.where("status", "==", "pending").count().get(),
                    col.where("status", "in", ["approved", "disbursed", "active"]).count().get(),
                    col.where("status", "==", "rejected").count().get(),
                ]);
                return {
                    total: total.data().count,
                    pending: pending.data().count,
                    approved: approved.data().count,
                    rejected: rejected.data().count,
                };
            })
        );

        const sum = (key: "total" | "pending" | "approved" | "rejected") =>
            counts.reduce((acc, c) => acc + c[key], 0);

        return {
            error: null,
            success: true as const,
            stats: {
                total: sum("total"),
                pending: sum("pending"),
                approved: sum("approved"),
                rejected: sum("rejected"),
            }
        };
    } catch (error: any) {
        logger.error("getAdminLoanStatsAction error:", error);
        return { success: false as const, error: error.message , stats: null };
    }
}
