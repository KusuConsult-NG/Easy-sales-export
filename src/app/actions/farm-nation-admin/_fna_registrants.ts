"use server";

import { UNKNOWN_DATE_ISO, dateRangeEnd, dateRangeStart } from "@/lib/date-utils";
import { adminSortKey } from "@/lib/admin-row-sort";
import { supabaseDb as db } from "@/lib/supabase-db";
import { logger } from "@/lib/logger";
import { requireSession } from "@/lib/session-guard";
import { COLLECTIONS } from "@/lib/types/firestore";
import { isAdmin, hasAdminPermission } from "@/lib/admin-permissions";
// #535 One rule for who may see a member's bank details and ID papers.
import { mayRevealMemberPii } from "@/lib/member-pii-visibility";
import { serializeDocs, serializeDoc } from "@/lib/firestore-serialize";
import { FieldPath } from "@/lib/firestore-compat";
import { withFlexibleSafeAction, ActionResponse } from "@/lib/safe-action";
import { createAdminAuditLog } from "@/lib/audit-log";

/**
 * Get registrants for Farm Nation (Legacy/General User collection check)
 */
async function _getFarmNationRegistrantsAction(options: { 
    limit?: number;
    page?: number;
    search?: string;
    status?: string;
    lastDocId?: string; 
} = {}): Promise<ActionResponse<any[]>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        
        if (!isAdmin(session.user.roles)) {
            return { success: false, error: "Unauthorized: Permission required", data: null };
        }

        const pageSize = options.search ? 5000 : (options.limit || 20);
        const page = options.page ?? 0;

        /*
         *   #825 THIS LISTED FARM NATION REGISTRANTS BY READING 500 ARBITRARY
         *        USERS.
         *
         *        What stood here:
         *
         *            // Note: This fetches a large set of users and filters in
         *            // memory. This is not ideal for massive scale but works
         *            // for the current user base.
         *            const snapshot = await db.collection(COLLECTIONS.USERS)
         *                .limit(500).get();
         *
         *        then kept whichever of those 500 happened to carry a
         *        `serviceRegistrations.farmNation`. The note is wrong about
         *        what it costs: the bound is not a performance trade, it is a
         *        CEILING ON WHO EXISTS. There is no orderBy, so which 500 rows
         *        come back is whatever the database returns first, and #495
         *        measured 42,160 user documents — so this action could see
         *        about one registrant in eighty, chosen arbitrarily, and
         *        reported the rest as not registered. `pageSize = 5000` on a
         *        search was describing a page it could never fill.
         *
         *        DRIVEN OFF THE AUTHORITATIVE RECORD NOW. _fn_onboarding writes
         *        FARM_NATION_APPLICATIONS as "the authoritative record" and
         *        mirrors onto the user; this reads that collection to learn who
         *        is registered, then hydrates those users. Same output shape,
         *        same fields, no arbitrary bound — and the search is unioned the
         *        way the registrant queue's is, so a woman whose application
         *        carries a fuller name than her account is findable here too.
         *
         *        No screen calls this action; it is reachable through
         *        actions/farm-nation-admin/index and returns registrant rows, so
         *        it is held to what the screen's reader does.
         */
        const appSnap = await db.collection(COLLECTIONS.FARM_NATION_APPLICATIONS)
            .select("userId", "profile", "personalInfo", "status", "submittedAt").get();

        /** user id -> what their application says about them. */
        const appById = new Map<string, { name: string; status: string; submittedAt: any }>();
        for (const doc of appSnap.docs) {
            const d = doc.data() as any;
            if (!d?.userId) continue;
            const p = (d.profile || d.personalInfo || {}) as any;
            const name = [p.firstName, p.otherName, p.lastName].filter(Boolean).join(" ").trim()
                || p.fullName || "";
            const existing = appById.get(d.userId);
            //   One user may hold more than one application; the first with a
            //   name on it is enough to find them by.
            if (!existing || (!existing.name && name)) {
                appById.set(d.userId, { name, status: d.status || "pending", submittedAt: d.submittedAt });
            }
        }

        const registrantUserIds = Array.from(appById.keys());
        const userDocs: any[] = [];
        for (let i = 0; i < registrantUserIds.length; i += 30) {
            const chunk = registrantUserIds.slice(i, i + 30);
            if (chunk.length === 0) continue;
            const snap = await db.collection(COLLECTIONS.USERS)
                .where(FieldPath.documentId(), "in", chunk).get();
            userDocs.push(...snap.docs);
        }

        let users = userDocs
            .map(doc => {
                const data = doc.data();
                const app = appById.get(doc.id);
                /*
                 *   The application is the authoritative record of the
                 *   registration; `serviceRegistrations.farmNation` is the
                 *   mirror _fn_onboarding writes onto the account in the same
                 *   transaction. A row whose mirror is missing — a legacy
                 *   import, or a transaction that wrote one half — used to be
                 *   dropped, so a real registrant disappeared because of a
                 *   bookkeeping field rather than anything about her. The
                 *   mirror is used when it is there and stood in for from the
                 *   application when it is not.
                 */
                const farmNation = data.serviceRegistrations?.farmNation
                    ?? { status: app?.status ?? "pending", submittedAt: app?.submittedAt };
                return {
                    id: doc.id,
                    //   The name on her APPLICATION first, which is what she
                    //   wrote and what the registrant queue prints, then the
                    //   account's. #814's rule, applied to this reader too.
                    name: app?.name || data.fullName || data.name || "Unknown",
                    email: data.email,
                    phone: data.phone,
                    role: data.roles?.[0] || "general_user",
                    roles: data.roles || [],
                    isVerified: data.isVerified ?? false,
                    createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : UNKNOWN_DATE_ISO,
                    farmNation: data.farmNation,
                    serviceRegistrations: { farmNation }
                };
            })
            .filter(Boolean) as any[];

        if (options.status && options.status !== "all") {
            users = users.filter(u => u.serviceRegistrations?.farmNation?.status === options.status);
        }

        if (options.search) {
            const q = options.search.toLowerCase().trim();
            users = users.filter((u: any) => {
                //   `u.name` is now the application's name when there is one,
                //   so the field an admin reads off the row is the field this
                //   searches. That is the whole of #814, stated as one line.
                const searchString = [u.name, u.email, u.phone].filter(Boolean).map(String).join(" ").toLowerCase();
                return searchString.includes(q);
            });
        }

        users.sort((a, b) => {
            const aT = a.serviceRegistrations?.farmNation?.submittedAt?.seconds || 0;
            const bT = b.serviceRegistrations?.farmNation?.submittedAt?.seconds || 0;
            return bT - aT;
        });

        const offset = page * pageSize;
        const paged = users.slice(offset, offset + pageSize);
        const hasMore = offset + pageSize < users.length;

        return { 
            success: true, 
            error: null, 
            data: paged,
            meta: { 
                hasMore,
                cursor: hasMore ? String(page + 1) : null,
                total: users.length
            }
        };
    } catch (error: any) {
        logger.error("getFarmNationRegistrantsAction error:", {
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false, error: "Failed to fetch farm nation registrants", data: null };
    }
}

export const getFarmNationRegistrantsAction = withFlexibleSafeAction("getFarmNationRegistrantsAction", _getFarmNationRegistrantsAction);


/**
 * Get standard Farm Nation registrants with enriched profile data
 */
async function _getStandardFarmNationRegistrantsAction(options: { 
    limit?: number;
    search?: string;
    status?: "pending" | "approved" | "rejected" | "under_review" | "all";
    lastDocId?: string;
    sortOrder?: "asc" | "desc";
    sortBy?: "createdAt" | "gender" | "state";
    dateFrom?: string;
    dateTo?: string; 
} = {}): Promise<ActionResponse<any>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;

        if (!isAdmin(session.user.roles)) {
            return { success: false, error: "Unauthorized", data: null };
        }

        /**
         * Bank details and identity numbers go only to the callers who can pay
         * a seller out. isAdmin() is true for all TEN admin roles, and this list
         * hands over every registrant's account number, account name, bank code
         * — and, through the `...uData` spread below, their hashed NIN and BVN.
         *
         * Fourth copy of this defect: the admin withdrawal list, the marketplace
         * escrow list and the farm-nation transaction list were each closed by
         * requiring the permission that lets you process the payout.
         */
        //   #535 The LIVE roles, not the token's — see lib/bank-details-visibility.
        const maySeeBankDetails = await mayRevealMemberPii("finance:resolve_disputes");

        const useMemoryPagination = (options.sortBy === "gender" || options.sortBy === "state") || !!options.search || !!options.dateFrom || !!options.dateTo;
        const fetchLimit = useMemoryPagination ? 5000 : (options.limit || 50);
        const applicationsSortDirection = options.sortOrder || "desc";

        let applications: any[] = [];
        let hasMoreRaw = false;

        if (options.search) {
            /*
             *   #825 THE NAME ON THE ROW IS SEARCHED HERE TOO.
             *
             *   #814 fixed this for WAVE and Academy. Farm Nation had the same
             *   shape, untouched — "a correct rule applied to some of the
             *   places it names", which is this audit's most frequent defect.
             *
             *   The row's label is built at the hydration step below:
             *
             *       const userName = profile.firstName
             *           ? `${profile.firstName} ${profile.lastName || ''}`.trim()
             *           : (profile.fullName || uData.fullName || uData.name || "Unknown");
             *
             *   — the APPLICATION's `profile`, preferred over the account. So
             *   the name an admin reads off the row comes from the registrant
             *   document, while this search resolved the query against USERS
             *   alone and, when nothing matched, RETURNED EMPTY WITHOUT EVER
             *   QUERYING FARM_NATION_APPLICATIONS. Same words on the screen and
             *   in the box, and "no such person" while looking at her.
             *
             *   Both are searched now and the results unioned.
             */
            const { searchUserIdsByQuery, searchDocIdsByNameFields } =
                await import("@/lib/admin-search-helper");

            const [matchingUserIds, matchingAppIds] = await Promise.all([
                searchUserIdsByQuery(options.search),
                searchDocIdsByNameFields(
                    COLLECTIONS.FARM_NATION_APPLICATIONS,
                    /*
                     *   The registrant document's own identity fields. `profile`
                     *   is what _fn_onboarding writes; `personalInfo` is the
                     *   legacy spelling the hydration step above still reads
                     *   (`app.profile || app.personalInfo`), so a search that
                     *   covered only one would miss whichever cohort wrote the
                     *   other.
                     */
                    [
                        "profile.firstName", "profile.lastName",
                        "profile.otherName", "profile.fullName",
                        "personalInfo.firstName", "personalInfo.lastName",
                        "personalInfo.fullName",
                    ],
                    options.search,
                ),
            ]);

            if (matchingUserIds.length === 0 && matchingAppIds.length === 0) {
                return {
                    success: true,
                    error: null,
                    data: [],
                    meta: {
                        totalFetched: 0,
                        hasMore: false,
                        lastDocId: null
                    }
                };
            }

            //   Two reads, unioned by document id. Each `in` is issued only
            //   when it has something to look for — an empty `in` is an illegal
            //   query, and it is also the state this finding is about.
            const [byUser, byName] = await Promise.all([
                matchingUserIds.length > 0
                    ? db.collection(COLLECTIONS.FARM_NATION_APPLICATIONS)
                        .where("userId", "in", matchingUserIds).get()
                    : null,
                matchingAppIds.length > 0
                    ? db.collection(COLLECTIONS.FARM_NATION_APPLICATIONS)
                        .where(FieldPath.documentId(), "in", matchingAppIds).get()
                    : null,
            ]);

            const byId = new Map<string, any>();
            for (const snap of [byUser, byName]) {
                if (!snap) continue;
                for (const doc of snap.docs) byId.set(doc.id, doc);
            }

            applications = serializeDocs(Array.from(byId.values()));
            if (options.status && options.status !== "all") {
                applications = applications.filter(app => app.status === options.status);
            }
            if (options.dateFrom) {
                const from = dateRangeStart(options.dateFrom);
                applications = applications.filter(app => {
                    const d = app.submittedAt?.seconds ? new Date(app.submittedAt.seconds * 1000) : new Date(app.submittedAt);
                    return d >= from;
                });
            }
            if (options.dateTo) {
                const to = dateRangeEnd(options.dateTo);
                applications = applications.filter(app => {
                    const d = app.submittedAt?.seconds ? new Date(app.submittedAt.seconds * 1000) : new Date(app.submittedAt);
                    return d <= to;
                });
            }
        } else {
            let q: any = db.collection(COLLECTIONS.FARM_NATION_APPLICATIONS).orderBy("submittedAt", applicationsSortDirection);

            if (options.status && options.status !== "all") {
                q = db.collection(COLLECTIONS.FARM_NATION_APPLICATIONS)
                    .where("status", "==", options.status)
                    .orderBy("submittedAt", applicationsSortDirection);
            }

            if (options.dateFrom) {
                const fromTs = dateRangeStart(options.dateFrom);
                q = q.where("submittedAt", ">=", fromTs);
            }
            if (options.dateTo) {
                const toTs = dateRangeEnd(options.dateTo);
                q = q.where("submittedAt", "<=", toTs);
            }

            if (options.lastDocId && !useMemoryPagination) {
                const lastDoc = await db.collection(COLLECTIONS.FARM_NATION_APPLICATIONS).doc(options.lastDocId).get();
                if (lastDoc.exists) {
                    q = q.startAfter(lastDoc);
                }
            }

            q = q.limit(fetchLimit + 1);
            const snapshot = await q.get();
            applications = serializeDocs(snapshot.docs);
            hasMoreRaw = applications.length > fetchLimit;
            if (!useMemoryPagination) {
                applications = applications.slice(0, fetchLimit);
            }
        }

        // 2. Hydrate User Data (Standard Hydration Pattern)
        const userIds = [...new Set(applications.map(app => app.userId).filter(Boolean))];
        const userMap = new Map<string, any>();
        const userPromises = [];
        
        for (let i = 0; i < userIds.length; i += 30) {
            const chunk = userIds.slice(i, i + 30);
            if (chunk.length > 0) {
                userPromises.push(db.collection(COLLECTIONS.USERS).where(FieldPath.documentId(), "in", chunk).get());
            }
        }
        
        const userSnapsArray = await Promise.all(userPromises);
        userSnapsArray.forEach(snap => snap.docs.forEach(d => userMap.set(d.id, serializeDoc(d.id, d.data()))));

        // 3. Normalize and Merge Data for the Admin Table
        let finalApplications = applications.map((app: any) => {
            const uData = (userMap.get(app.userId) || {}) as any;
            const profile = (app.profile || app.personalInfo || {}) as any;
            
            // Reconstruct the userName
            const userName = profile.firstName 
                ? `${profile.firstName} ${profile.lastName || ''}`.trim() 
                : (profile.fullName || uData.fullName || uData.name || "Unknown");

            // Canonical bankDetails injection — for the callers entitled to it.
            const bankDetails = maySeeBankDetails
                ? (uData.bankDetails || {
                    bankName: uData.bankName || "N/A",
                    accountNumber: uData.bankAccountNumber || "N/A",
                    accountName: uData.bankAccountName || "N/A",
                    bankCode: uData.bankCode || "N/A"
                })
                : undefined;

            // The spread below carries the whole user document. Strip what the
            // caller may not see, or the gate above is decorative.
            const {
                bankDetails: _bd, bankName: _bn, bankAccountNumber: _ban,
                bankAccountName: _bacn, bankCode: _bc, nin: _nin, bvn: _bvn,
                ...uDataSafe
            } = uData as Record<string, unknown>;

            const mergedData = {
                ...(maySeeBankDetails ? uData : uDataSafe),
                ...app,
                // Flatten profile fields to top-level for UI consistency
                phone: app.phone || profile.phone || profile.phoneNumber || uData.phone || uData.phoneNumber || uData.kyc?.phoneNumber || uData.kyc?.phone || null,
                email: app.email || profile.email || uData.email || null,
                stateOfOrigin: profile.state || uData.state || uData.stateOfOrigin || (typeof uData.address === 'object' ? uData.address?.state : uData.stateOfOrigin) || null,
                lga: profile.lga || uData.lga || (typeof uData.address === 'object' ? uData.address?.lga : uData.lga) || null,
                residentialAddress: profile.address || profile.residentialAddress || uData.residentialAddress || (typeof uData.address === 'object' ? uData.address?.street : uData.address) || null,
                firstName: profile.firstName || uData.firstName || null,
                lastName: profile.lastName || uData.lastName || null,
                fullName: userName
            };

            return {
                id: app.id,
                userId: app.userId,
                user: {
                    id: app.userId,
                    name: userName,
                    email: mergedData.email || "Unknown",
                    phone: mergedData.phone || "Unknown",
                    dob: mergedData.dateOfBirth || "Unknown",
                    address: mergedData.residentialAddress || "Unknown",
                    state: mergedData.stateOfOrigin || "Unknown",
                    lga: mergedData.lga || "Unknown",
                    gender: mergedData.gender || "Unknown",
                    bankDetails
                },
                status: app.status,
                data: mergedData,
                submittedAt: app.submittedAt
            };
        });

        // Sort by Gender in-memory if requested
        if ((options.sortBy === "gender" || options.sortBy === "state")) {
            const byState = options.sortBy === "state";
            finalApplications.sort((a: any, b: any) => {
                //   STATE collapses "Unknown" to blank and files blanks last;
                //   GENDER is left exactly as it was — see lib/admin-row-sort.
                const ga = byState
                    ? adminSortKey(a.user?.state ?? a.data?.stateOfOrigin)
                    : (a.user?.gender || a.data?.gender || "").toLowerCase();
                const gb = byState
                    ? adminSortKey(b.user?.state ?? b.data?.stateOfOrigin)
                    : (b.user?.gender || b.data?.gender || "").toLowerCase();
                if (byState && !ga !== !gb) return ga ? -1 : 1;
                if (applicationsSortDirection === "asc") {
                    return ga.localeCompare(gb);
                } else {
                    return gb.localeCompare(ga);
                }
            });
        }

        /*
         *   #825 STEP 4 USED TO THROW AWAY THE ROWS STEP 1 WENT AND FETCHED.
         *
         *   What stood here — "4. Client-side Search (if requested)" — re-ran
         *   the search in JavaScript over the hydrated rows:
         *
         *       const searchString = [
         *           app.id, app.userId, app.user?.name, app.user?.email,
         *           app.user?.phone, app.data?.firstName, app.data?.lastName,
         *           app.data?.fullName, app.data?.stateOfOrigin
         *       ].join(" ").toLowerCase();
         *       return searchString.includes(s);
         *
         *   Every one of those fields resolves to the APPLICATION's name —
         *   `user.name` is built `profile.firstName ? … : …` a hundred lines
         *   up, and `data.firstName` is `profile.firstName || uData.firstName`.
         *   The ACCOUNT's own name is not among them.
         *
         *   So the user-side half of the search was decorative. The database
         *   resolved "Musa" to her account, fetched her registrant document by
         *   `userId in (…)`, hydrated it — and then this filter dropped it,
         *   because "Musa" is not in the name her form carries. A round trip to
         *   fetch the right row and a line of JavaScript to discard it.
         *
         *   MEASURED, not read: the suite for this finding searched her account
         *   name against the seeded pair, watched the union return `["her-doc"]`
         *   and watched the action return `[]`. It is why that suite executes
         *   the action instead of asserting about the source.
         *
         *   THE FILTER IS GONE RATHER THAN WIDENED. Whenever `options.search`
         *   is set, `applications` came from the union above and from nowhere
         *   else — every row in it was SELECTED BY the search. A second pass
         *   can therefore only ever remove a correct answer, and adding the
         *   account fields to the string would fix this instance of that while
         *   leaving the shape that caused it. Prefix matches are the plain
         *   case: the database answers "Abuba" with ABUBAKAR, and a substring
         *   re-check that disagrees is wrong about which of the two knows.
         */

        // ALWAYS apply date filters in memory as a definitive backstop.
        if (options.dateFrom) {
            const from = dateRangeStart(options.dateFrom);
            finalApplications = finalApplications.filter((app: any) => {
                const d = app.submittedAt?.seconds ? new Date(app.submittedAt.seconds * 1000) : new Date(app.submittedAt);
                return d >= from;
            });
        }
        if (options.dateTo) {
            const to = dateRangeEnd(options.dateTo);
            finalApplications = finalApplications.filter((app: any) => {
                const d = app.submittedAt?.seconds ? new Date(app.submittedAt.seconds * 1000) : new Date(app.submittedAt);
                return d <= to;
            });
        }

        const limit = options.limit || 50;
        let page = 0;
        if ((options as any).page !== undefined) {
            page = Number((options as any).page);
        } else if (options.lastDocId && /^\d+$/.test(options.lastDocId)) {
            page = Number(options.lastDocId);
        }

        const offset = page * limit;
        const paged = useMemoryPagination ? finalApplications.slice(offset, offset + limit) : finalApplications;
        const hasMore = useMemoryPagination 
            ? (offset + limit < finalApplications.length) 
            : hasMoreRaw;
            
        const nextCursor = useMemoryPagination 
            ? (hasMore ? String(page + 1) : null)
            : (hasMore ? applications[applications.length - 1].id : null);

        await createAdminAuditLog({
            action: "data_access",
            userId: session.user.id,
            targetType: "farm_nation_applications",
            targetId: "list",
            details: `Accessed Farm Nation registrants list (limit: ${fetchLimit}, status: ${options.status || 'all'})`,
            metadata: { options }
        });

        return { 
            success: true, 
            error: null, 
            data: paged, 
            meta: {
                totalFetched: finalApplications.length, 
                hasMore: hasMore,
                lastDocId: nextCursor
            }
        };
    } catch (error: any) {
        logger.error("Get standard Farm Nation registrants error:", {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined
        });
        return { success: false, error: "Failed to fetch applications", data: null };
    }
}

export const getStandardFarmNationRegistrantsAction = withFlexibleSafeAction("getStandardFarmNationRegistrantsAction", _getStandardFarmNationRegistrantsAction);
