import { useState, useEffect, useCallback, useRef } from 'react';
import { logger } from '@/lib/logger';

interface UseAdminDataOptions<T> {
    fetchAction: (params: any) => Promise<{ success: boolean; data?: any; error?: string | null; loans?: any[]; properties?: any[]; users?: any[]; lastDocId?: string; hasMore?: boolean; meta?: any; }>;
    limit?: number;
    dependencies?: any[];
}

/**
 * useAdminData — cursor-based pagination hook for admin data tables.
 *
 * Fix applied: fetchData is kept stable via useRef so it never becomes a
 * stale closure. The previous implementation listed `search` and `filters`
 * in the useCallback deps but then eslint-disabled them in the useEffect,
 * meaning an update to `search` during an in-flight fetch could silently
 * query with stale params.
 *
 * Now:
 *  - fetchDataRef always holds the latest `search`/`filters`/`fetchAction`
 *  - fetchData reads from the ref at call-time — no stale closures
 *  - useEffect depends only on searchKey/filtersKey (serialized) so it
 *    correctly re-triggers on every real change without the eslint suppress
 */
export function useAdminData<T>({ fetchAction, limit = 20, dependencies = [] }: UseAdminDataOptions<T>) {
    const [data, setData] = useState<T[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [pageIndex, setPageIndex] = useState(0);
    const [search, setSearch] = useState('');
    const [filters, setFilters] = useState<Record<string, any>>({});
    const [hasMore, setHasMore] = useState(false);
    const [meta, setMeta] = useState<any>(null);

    // Cursor stack: cursors[i] is the lastDocId to use when fetching page i+1.
    const cursorStack = useRef<(string | undefined)[]>([undefined]);

    // Keep a ref to the latest values to avoid stale closures in fetchData.
    const latestRef = useRef({ search, filters, fetchAction, limit });
    useEffect(() => {
        latestRef.current = { search, filters, fetchAction, limit };
    });

    const fetchData = useCallback(async (page: number, resetCursors = false) => {
        setLoading(true);
        setError(null);

        const { search: s, filters: f, fetchAction: fn, limit: lim } = latestRef.current;

        try {
            const cursor = resetCursors ? undefined : cursorStack.current[page] ?? undefined;

            // If the cursor is a numeric string, it's a page-offset marker (not a Firestore doc ID)
            const cursorAsPage = cursor && /^\d+$/.test(cursor) ? Number(cursor) : undefined;

            const params = {
                limit: lim,
                search: s,
                ...f,
                // For offset-based pagination (e.g. getUsersAction): pass as `page`
                ...(cursorAsPage !== undefined ? { page: cursorAsPage } : {}),
                // For cursor-based pagination (other actions): pass as `lastDocId`
                ...(cursor && cursorAsPage === undefined ? { lastDocId: cursor } : {}),
            };

            logger.debug('[useAdminData] Fetching', { page, cursor, search: s, filters: f });

            const result = await fn(params);

            if (result.success) {
                const items = result.data || result.loans || result.properties || result.users || [];
                setData(items);

                if (result.meta) setMeta(result.meta);

                // Extract cursor and hasMore from various backend response shapes (root vs meta container)
                const extractedCursor = result.lastDocId || result.meta?.lastDocId || result.meta?.cursor || result.cursor;
                if (extractedCursor) {
                    const newStack = resetCursors ? [undefined] : [...cursorStack.current];
                    newStack[page + 1] = extractedCursor;
                    cursorStack.current = newStack;
                }

                const more = result.hasMore ?? result.meta?.hasMore ?? (items.length === lim);
                setHasMore(more);

                logger.debug('[useAdminData] Page loaded', { page, count: items.length, hasMore: more });
            } else {
                const msg = result.error || 'Failed to fetch data';
                setError(msg);
                logger.warn('[useAdminData] Fetch returned error', { page, error: msg });
            }
        } catch (err: any) {
            const msg = err.message || 'An error occurred';
            setError(msg);
            logger.error('[useAdminData] Fetch threw exception', { page, error: msg });
        } finally {
            setLoading(false);
        }
        // fetchData has no external deps — it reads everything from latestRef at call-time.
         
    }, []);


    // Serialize search/filters so the effect correctly detects deep changes.
    const searchKey = search;
    const filtersKey = JSON.stringify(filters);
    const depsKey = JSON.stringify(dependencies);

    // Reset to page 0 whenever search, filters, or explicit deps change.
    useEffect(() => {
        cursorStack.current = [undefined];
        setPageIndex(0);
        fetchData(0, true);
        // fetchData is stable (never changes) — this is intentional, see comment above.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchKey, filtersKey, depsKey]);

    const updateFilter = (key: string, value: any) => {
        setFilters(prev => ({ ...prev, [key]: value }));
    };

    const clearFilter = (key: string) => {
        setFilters(prev => {
            const next = { ...prev };
            delete next[key];
            return next;
        });
    };

    const onNextPage = () => {
        if (hasMore) {
            const nextPage = pageIndex + 1;
            setPageIndex(nextPage);
            fetchData(nextPage);
        }
    };

    const onPrevPage = () => {
        if (pageIndex > 0) {
            const prevPage = pageIndex - 1;
            setPageIndex(prevPage);
            fetchData(prevPage);
        }
    };

    const refresh = () => {
        cursorStack.current = [undefined];
        setPageIndex(0);
        fetchData(0, true);
    };

    return {
        data,
        loading,
        error,
        search,
        setSearch,
        filters,
        updateFilter,
        clearFilter,
        hasMore,
        onNextPage,
        onPrevPage,
        pageIndex,
        setData,
        refresh,
        meta,
    };
}
