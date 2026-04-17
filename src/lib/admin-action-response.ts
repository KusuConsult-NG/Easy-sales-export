/**
 * Admin Action Response Helpers
 *
 * Single source of truth for the shape that `useAdminData` expects.
 * ALL paginated admin server actions MUST use `paginatedOk` / `paginatedErr`
 * instead of building their own return objects.
 *
 * Contract (mirroring useAdminData lines 71-84):
 *   result.success   — boolean
 *   result.data      — T[]          (the page items)
 *   result.lastDocId — string|undefined  (Firestore cursor for next page)
 *   result.hasMore   — boolean      (whether another page exists)
 *   result.error     — string|undefined  (human-readable error)
 *   result.meta      — any          (optional extra metadata, NOT used for pagination)
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
    docs: FirebaseFirestore.QueryDocumentSnapshot[],
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
    query: FirebaseFirestore.CollectionReference | FirebaseFirestore.Query,
    field: string
): FirebaseFirestore.Query {
    return query.where(field, '!=', null);
}
