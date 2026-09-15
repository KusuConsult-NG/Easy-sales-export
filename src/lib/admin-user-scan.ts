/**
 * Finding the users a filter actually matches, rather than the ones that happen
 * to be in the first window.
 *
 *   #780 THE ADMIN FILTERS SEARCHED 2,000 ROWS OF A 42,000-ROW PLATFORM AND
 *        PRESENTED THE ANSWER AS COMPLETE.
 *
 *   Reported by the owner, twice: "sorting users is not completely functional
 *   (using the filter button)" and then "filtering is still not fixed."
 *
 *   getUsersAction fetches a bounded batch and applies several filters to it in
 *   memory:
 *
 *       const FETCH_LIMIT = (search || hasUnindexedFilter || fromDate || ...)
 *           ? 2000
 *           : Math.min(2000, (page + 1) * pageSize + 100);
 *
 *   `gender`, `status`, `modules` and the date range are then applied to those
 *   rows. So an admin filtering by gender was shown the female accounts AMONG
 *   THE NEWEST 2,000 — and every one outside that window was invisible, on
 *   every page, with no indication that anything had been left out.
 *
 *   MEASURED, on 3,002 seeded accounts with the two targets at the old end:
 *
 *       gender = female        expected 1 row     returned NOTHING
 *       status = verified      expected 1 row     returned NOTHING
 *       status = unverified    expected 1 row     returned 50 WRONG rows
 *       module = wave          expected 1 row     returned NOTHING
 *       module = academy       expected 1 row     returned NOTHING
 *
 *   A two-user test passes every one of those, which is why this survived: the
 *   instrument was smaller than the window it was meant to measure.
 *
 * ── WHY NOT JUST RAISE THE LIMIT ────────────────────────────────────────────
 *
 *   Because #766 is the owner's OTHER report about this screen — "Users app
 *   loading slowly" — and the mapper each row passes through is heavy: it
 *   reconciles four schema generations, walks serviceRegistrations, and derives
 *   provenance. Mapping 42,000 rows on every filtered request trades a
 *   correctness bug for the performance bug already complained about.
 *
 *   So this does two things instead:
 *
 *     1. A CHEAP PREFILTER on the raw row, applied BEFORE the mapper, so rows
 *        that cannot match are discarded for the price of a property read.
 *
 *     2. A PAGED SCAN that keeps going until enough matches are found, rather
 *        than one fixed window. A filter matching a normal share of the
 *        platform now finishes in the first page or two; only a filter matching
 *        almost nothing walks far.
 *
 * ── THE PREFILTER IS CONSERVATIVE, AND THAT IS THE WHOLE SAFETY ARGUMENT ────
 *
 *   It may only discard a row that CANNOT match. Anything it is unsure about is
 *   kept and decided later by the existing in-memory filters, which are
 *   unchanged. A prefilter that wrongly discarded would hide a real user from
 *   an admin — the same class of defect as the window, arrived at from the
 *   other side.
 *
 *   That is why `status` is NOT prefiltered. Verification state is computed by
 *   profile-provenance from a backfill marker plus two flags (#495), and an
 *   approximation of it here would be a second spelling of that rule which
 *   could drift. It is left to the existing filter and reached by scanning.
 */

/** The filters this module can decide from a raw row. */
export interface RawUserFilters {
    gender?: string;
    modules?: string;
    status?: string;
    fromDate?: string;
    toDate?: string;
    /**
     * The mapper's verification rule, passed in rather than imported.
     *
     * It is `verificationState` from profile-provenance, which the mapper calls
     * on the RAW row — so the prefilter can use the identical function instead
     * of an approximation of it. Injected so this module stays testable on its
     * own and so there is visibly ONE rule, not a copy.
     */
    verificationStateOf?: (data: Record<string, any>) => string;
}

/** True when any of them is actually narrowing anything. */
export function hasRawFilters(o: RawUserFilters): boolean {
    return Boolean(
        (o.gender && o.gender !== "all")
        || (o.modules && o.modules !== "all")
        || (o.status && o.status !== "all" && o.verificationStateOf)
        || o.fromDate
        || o.toDate,
    );
}

/**
 * The gender on a raw row, however this platform has spelled it.
 *
 *   EXPORTED AND USED BY THE MAPPER TOO. A prefilter that read a different
 *   field from the filter standing behind it would discard matching users
 *   silently, so there is one function and both call it. The spellings are the
 *   four the mapper had accumulated — top level, two KYC nestings, and any
 *   module registration's own profile.
 */
export function genderOf(data: Record<string, any> | null | undefined): string {
    const d = data ?? {};
    const fromRegs = Object.values(d.serviceRegistrations || {})
        .map((reg: any) => reg?.profile?.gender || reg?.gender)
        .find(Boolean);
    const g = d.gender || d.kyc?.gender || d.kyc?.kycData?.gender || fromRegs || "";
    return typeof g === "string" ? g.toLowerCase().trim() : "";
}

/** Registration keys that count as a module, and the statuses that count as enrolled. */
export const MODULE_KEYS = [
    'marketplace', 'academy', 'wave', 'cooperatives', 'export', 'farmNation', 'farm_nation',
] as const;

export const ENROLLED_STATUSES = new Set([
    'pending', 'under_review', 'approved', 'active', 'paid', 'completed', 'suspended',
]);

/**
 * The modules a raw row is enrolled in.
 *
 *   ALSO EXPORTED FOR THE MAPPER, for the same reason as genderOf. This rule
 *   decided what the `modules` filter matched while living only inside the
 *   mapper, so the scan in front of it could not agree with it by construction.
 */
export function activeModulesOf(data: Record<string, any> | null | undefined): string[] {
    const d = data ?? {};
    const regs = (d.serviceRegistrations || {}) as Record<string, any>;
    const active: string[] = [];

    for (const key of MODULE_KEYS) {
        const reg = regs[key];
        if (reg && ENROLLED_STATUSES.has(reg.status)) {
            const label = key === 'farmNation' || key === 'farm_nation' ? 'farm-nation' : key;
            if (!active.includes(label)) active.push(label);
        }
    }

    //   Legacy marketplace fallback — the mapper's own, kept identical.
    const accountType = d.marketplaceAccountType || regs.marketplace?.accountType || d.accountType;
    if (!active.includes('marketplace') && accountType) active.push('marketplace');

    return active;
}

function rawCreatedAt(data: Record<string, any>): number {
    const v = data?.createdAt;
    if (!v) return NaN;
    //   Timestamps, ISO strings and Dates have all been written here.
    const d = typeof v?.toDate === "function" ? v.toDate() : new Date(v);
    const t = d instanceof Date ? d.getTime() : NaN;
    return Number.isFinite(t) ? t : NaN;
}

/**
 * Can this raw row possibly match? `false` ONLY when it definitely cannot.
 *
 * An unreadable or absent field is NOT a reason to discard — it is a reason to
 * let the mapper and the existing filters decide, because they know how to read
 * the older spellings this one may not.
 */
export function rawRowCanMatch(data: Record<string, any> | null | undefined, o: RawUserFilters): boolean {
    const row = data ?? {};

    if (o.gender && o.gender !== "all") {
        const g = genderOf(row);
        //   Only discard when a gender IS present and differs. A row with none
        //   recorded is kept — it cannot match either, but leaving that to the
        //   filter behind costs one row and removes a way to be wrong.
        if (g && g !== o.gender.toLowerCase().trim()) return false;
    }

    if (o.modules && o.modules !== "all") {
        /*
         *   EXACT, not conservative, because it is the mapper's own function.
         *   An earlier draft kept every row whose serviceRegistrations was
         *   empty, reasoning that the mapper might know more — it does not, and
         *   the cost was that the prefilter narrowed nothing: three thousand
         *   module-less rows filled the scan and the two real matches at the
         *   far end were never reached. Measured, and the reason this is shared
         *   code rather than a second reading of the same idea.
         */
        const mods = activeModulesOf(row);
        if (o.modules === "multi") {
            if (mods.length < 2) return false;
        } else if (!mods.includes(o.modules)) {
            return false;
        }
    }

    if (o.status && o.status !== "all" && o.verificationStateOf) {
        //   The mapper's own rule, injected — see RawUserFilters. #495 defines
        //   three states and computes them from a backfill marker plus two
        //   flags; restating that here would be a copy that drifts.
        if (o.verificationStateOf(row) !== o.status) return false;
    }

    if (o.fromDate || o.toDate) {
        const t = rawCreatedAt(row);
        //   An unreadable date is kept, deliberately: the in-memory backstop
        //   exists precisely because legacy rows store this inconsistently.
        if (Number.isFinite(t)) {
            if (o.fromDate) {
                const from = new Date(o.fromDate);
                from.setUTCHours(0, 0, 0, 0);
                if (t < from.getTime()) return false;
            }
            if (o.toDate) {
                const to = new Date(o.toDate);
                to.setUTCHours(23, 59, 59, 999);
                if (t > to.getTime()) return false;
            }
        }
    }

    return true;
}

/** What a scan found, and whether it saw everything. */
export interface UserScanResult<TDoc> {
    docs: TDoc[];
    /** True when the ceiling stopped the scan before the collection ended. */
    bounded: boolean;
    /** Raw rows read from the database. */
    scanned: number;
}

export interface UserScanConfig {
    /** Matching rows to collect before stopping. */
    need: number;
    /** Raw rows to read before giving up, whatever has been found. */
    ceiling: number;
    /** Rows per database round trip. */
    pageSize: number;
}

/**
 * How far a scan may read before it stops and says so.
 *
 * 25,000 is a deliberate, stated compromise on a platform of ~42,000 accounts:
 * large enough that every ordinary filter finishes inside it, small enough that
 * a pathological one cannot pin the database. When it is hit, `bounded` comes
 * back true and the caller reports a bounded count rather than a wrong one —
 * which is #772's rule, that a sample is never presented as a total.
 */
export const USER_SCAN_CEILING = 25_000;
export const USER_SCAN_PAGE = 1_000;

/**
 * Read pages until `need` rows pass the prefilter, or the ceiling is reached.
 *
 * `paginate` is supplied by the caller so this function needs to know nothing
 * about the query builder — which is what lets it be tested directly, with
 * known pages, rather than only through the action.
 */
export async function scanUsers<TDoc>(
    paginate: (afterDoc: TDoc | null, limit: number) => Promise<TDoc[]>,
    dataOf: (doc: TDoc) => Record<string, any>,
    filters: RawUserFilters,
    config: UserScanConfig,
): Promise<UserScanResult<TDoc>> {
    const kept: TDoc[] = [];
    let scanned = 0;
    let cursor: TDoc | null = null;
    const prefiltering = hasRawFilters(filters);

    //   Guards against a caller passing nonsense and turning this into an
    //   unbounded loop against the database.
    const pageSize = Math.max(1, Math.floor(config.pageSize));
    const ceiling = Math.max(pageSize, Math.floor(config.ceiling));
    const need = Math.max(0, Math.floor(config.need));

    while (kept.length < need && scanned < ceiling) {
        const page: TDoc[] = await paginate(cursor, Math.min(pageSize, ceiling - scanned));
        if (page.length === 0) {
            //   The collection ended. Everything that exists has been seen, so
            //   this is NOT a bounded result however few rows came back.
            return { docs: kept, bounded: false, scanned };
        }

        scanned += page.length;
        cursor = page[page.length - 1];

        for (const doc of page) {
            if (!prefiltering || rawRowCanMatch(dataOf(doc), filters)) kept.push(doc);
        }

        //   A short page means the collection ended mid-read.
        if (page.length < pageSize) {
            return { docs: kept, bounded: false, scanned };
        }
    }

    /*
     *   `bounded` is true only when the CEILING stopped us with rows still
     *   unread. Stopping because enough matches were found is not a bounded
     *   result for the page being served — but the caller cannot then claim a
     *   total, which is why it reports the count separately.
     */
    return { docs: kept, bounded: scanned >= ceiling, scanned };
}
