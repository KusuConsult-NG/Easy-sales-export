/**
 * Admin Action Response Helpers
 *
 *   #414 THIS CALLED ITSELF THE SINGLE SOURCE OF TRUTH AND HAD ONE IMPORTER.
 *
 *   The header called this the single source of truth for the shape
 *   `useAdminData` expects, and said in capitals that every paginated admin
 *   server action was required to route through the two helpers below rather
 *   than build its own return object.
 *
 *   (Described rather than quoted, deliberately: the assertion in
 *   admin-data-hook-pagination.test.tsx checks the old sentence is gone from
 *   this file, and reproducing it here would keep it present. That mistake has
 *   been made twice in this audit.)
 *
 *   Twenty-eight admin screens run on useAdminData. Exactly one file imports
 *   from here — _coop_admin_members.ts — and `nextCursor` and
 *   `whereFieldExists` below are imported by NOBODY. So the shape those
 *   twenty-eight screens depend on was in fact stated by each action
 *   separately, which is why the hook carries five fallbacks for the items
 *   array, six for the cursor and three for hasMore. That fan-out is the cost
 *   of this contract not being kept; it is also what makes the hook's guess
 *   able to be wrong (#413).
 *
 *   NOT CONVERTED, AND SAYING WHY. Rewriting twenty-plus live admin actions to
 *   route through these two helpers is a large change to working read paths on
 *   a production system, for no behavioural gain — the shapes they return are
 *   ones the hook already reads correctly, checked action by action. What is
 *   wrong is the CLAIM, and a claim that overstates its own adoption is how the
 *   next reader concludes the contract is enforced and stops checking. This is
 *   #314's precedent: correct the statement, keep the module, and pin the real
 *   contract in a test instead of asserting it in prose.
 *
 *   WHAT IS TRUE
 *   ------------
 *   These helpers produce the shape useAdminData reads FIRST and without any
 *   fallback, so a new paginated admin action should use them. What the hook
 *   actually accepts is wider, and is pinned by
 *   __tests__/unit/admin-data-hook-pagination.test.tsx:
 *
 *     result.success   — boolean
 *     result.data      — T[], or an object with .transactions/.loans/
 *                        .properties/.users, or root-level .loans/.properties/
 *                        .users
 *     result.lastDocId — string, also read from data.lastDocId, meta.lastDocId,
 *                        meta.cursor, result.cursor, data.cursor
 *     result.hasMore   — boolean, also read from data.hasMore / meta.hasMore;
 *                        inferred only when all three are absent, and only
 *                        alongside a cursor (#413)
 *     result.error     — string, shown when success is false
 *     result.meta      — any; meta.hasMore and meta.cursor ARE read for
 *                        pagination, contrary to what this header used to say
 */

export interface PaginatedAdminResponse<T = any> {
    success: boolean;
    data: T[];
    lastDocId?: string;
    hasMore: boolean;
    error?: string;
    meta?: Record<string, any>;
}

/** Return a successful paginated page. */
export function paginatedOk<T>(
    items: T[],
    nextCursorId: string | undefined,
    meta?: Record<string, any>
): PaginatedAdminResponse<T> {
    return {
        success: true,
        data: items,
        lastDocId: nextCursorId,
        hasMore: !!nextCursorId,
        meta,
    };
}

/** Return an error from a paginated action. */
export function paginatedErr(error: string): PaginatedAdminResponse<never> {
    return {
        success: false,
        data: [],
        hasMore: false,
        error,
    };
}

/**
 * Compute the Firestore cursor ID from a snapshot.
 * Returns undefined (no next page) when the snapshot returned fewer docs
 * than fetchLimit, meaning we've hit the end of the collection.
 */
export function nextCursor(
    docs: any[],
    fetchLimit: number
): string | undefined {
    return docs.length === fetchLimit ? docs[docs.length - 1].id : undefined;
}

/**
 * Safe helper for Firestore broadcast queries.
 * Uses where(field, "!=", null) instead of orderBy(field) so that
 * documents WITHOUT the field are not silently excluded by Firestore.
 */
export function whereFieldExists(
    query: any | import("@/lib/supabase-db").SupabaseQuery,
    field: string
): import("@/lib/supabase-db").SupabaseQuery {
    return query.where(field, '!=', null);
}
