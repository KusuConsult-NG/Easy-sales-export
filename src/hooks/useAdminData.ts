import { useState, useEffect, useCallback, useRef } from 'react';
import { logger } from '@/lib/logger';

interface UseAdminDataOptions<T> {
    fetchAction: (params: any) => Promise<{ success: boolean; data?: any; error?: string | null; loans?: any[]; properties?: any[]; users?: any[]; lastDocId?: string | null; cursor?: string | null; hasMore?: boolean; meta?: any; }>;
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

    // Track the latest fetch request to prevent race conditions
    const fetchIdRef = useRef(0);

    // Use a local debounce to prevent rapid firing while typing
    const [debouncedSearch, setDebouncedSearch] = useState(search);
    
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearch(search);
        }, 500);
        return () => clearTimeout(timer);
    }, [search]);

    // Keep a ref to the latest values to avoid stale closures in fetchData.
    const latestRef = useRef({ search: debouncedSearch, filters, fetchAction, limit });
    useEffect(() => {
        latestRef.current = { search: debouncedSearch, filters, fetchAction, limit };
    });

    const fetchData = useCallback(async (page: number, resetCursors = false, overrideSearch?: string, overrideFilters?: any) => {
        const currentFetchId = ++fetchIdRef.current;
        setLoading(true);
        setError(null);

        const s = overrideSearch !== undefined ? overrideSearch : latestRef.current.search;
        const f = overrideFilters !== undefined ? overrideFilters : latestRef.current.filters;
        const fn = latestRef.current.fetchAction;
        const lim = latestRef.current.limit;

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

            // Prevent race conditions: Ignore if a newer fetch was initiated
            if (currentFetchId !== fetchIdRef.current) {
                logger.debug('[useAdminData] Ignoring stale fetch response', { page, search: s });
                return;
            }

            if (result.success) {
                // 1. Extract Items
                let items: T[] = [];
                if (Array.isArray(result.data)) {
                    items = result.data;
                } else if (result.data && typeof result.data === 'object') {
                    // Check for common array keys inside the data wrapper
                    items = result.data.transactions || result.data.loans || result.data.properties || result.data.users || [];
                } else {
                    // Fallback to legacy root-level array keys
                    items = result.loans || result.properties || result.users || [];
                }
                setData(items);

                if (result.meta) setMeta(result.meta);

                // 2. Extract Cursor
                const extractedCursor = result.lastDocId || 
                                      result.data?.lastDocId || 
                                      result.meta?.lastDocId || 
                                      result.meta?.cursor || 
                                      result.cursor ||
                                      result.data?.cursor;

                if (extractedCursor) {
                    const newStack = resetCursors ? [undefined] : [...cursorStack.current];
                    newStack[page + 1] = extractedCursor;
                    cursorStack.current = newStack;
                }

                // 3. Extract hasMore
                //
                //   #413 A FULL PAGE IS NOT A NEXT PAGE.
                //
                //   The last clause used to be `(items.length === lim)` alone.
                //   That is an INFERENCE the hook makes for itself when the
                //   action states nothing — and it was inferring a next page
                //   the hook has no way to fetch. `onNextPage` reads
                //   `cursorStack.current[page]`, so with no cursor extracted
                //   above it re-sends the page-0 request: the same rows come
                //   back, the page counter says 2, and the operator concludes
                //   the queue is stuck.
                //
                //   That is #192–#195's shape ("a null cursor next to
                //   hasMore: true is a load-more button that reloads page
                //   one") — the wording is _wv_resources.ts's own. Those were
                //   fixed in the ACTIONS; this is the one remaining place that
                //   could still manufacture the pair, for any action that
                //   states neither.
                //
                //   An explicit answer from the action is still honoured in
                //   both directions — this only constrains the guess.
                const more = result.hasMore ??
                             result.data?.hasMore ??
                             result.meta?.hasMore ??
                             (items.length === lim && !!extractedCursor);
                setHasMore(more);

                logger.debug('[useAdminData] Page loaded', { page, count: items.length, hasMore: more });
            } else {
                const msg = result.error || 'Failed to fetch data';
                setError(msg);
                logger.warn('[useAdminData] Fetch returned error', { page, error: msg });
            }
        } catch (err: any) {
            // Prevent race conditions even on errors
            if (currentFetchId !== fetchIdRef.current) return;
            
            const msg = err.message || 'An error occurred';
            setError(msg);
            logger.error('[useAdminData] Fetch threw exception', { page, error: msg });
        } finally {
            if (currentFetchId === fetchIdRef.current) {
                setLoading(false);
            }
        }
    }, []);


    // Serialize search/filters so the effect correctly detects deep changes.
    const searchKey = debouncedSearch;
    const filtersKey = JSON.stringify(filters);
    const depsKey = JSON.stringify(dependencies);

    useEffect(() => {
        // #413. Was console.log. Three lines above this hook's own
        // logger.debug, printing every admin's live filter values into the
        // browser console on each keystroke-debounce and each filter change.
        logger.debug('[useAdminData] Resetting pagination', { searchKey, filtersKey, depsKey });
        cursorStack.current = [undefined];
        setPageIndex(0);
        fetchData(0, true, searchKey, filters);
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

    // Maintain a ref to the latest page index to avoid stale closures in refresh
    const pageIndexRef = useRef(pageIndex);
    useEffect(() => {
        pageIndexRef.current = pageIndex;
    }, [pageIndex]);

    const onNextPage = () => {
        if (!hasMore) return;

        const nextPage = pageIndex + 1;

        //   #413 …and the second half of the same guard.
        //
        //   The inference above is now cursor-aware, but an action can still
        //   SAY `hasMore: true` while returning no cursor, and that answer is
        //   honoured on purpose. Advancing on it would re-request page 0 and
        //   present it as the next page — showing the operator the same rows
        //   under a higher page number, which is worse than not advancing.
        if (cursorStack.current[nextPage] === undefined) {
            logger.warn('[useAdminData] Refusing to advance: no cursor for the next page', {
                from: pageIndex,
                hasMore,
            });
            setHasMore(false);
            return;
        }

        setPageIndex(nextPage);
        fetchData(nextPage);
    };

    const onPrevPage = () => {
        if (pageIndex > 0) {
            const prevPage = pageIndex - 1;
            setPageIndex(prevPage);
            fetchData(prevPage);
        }
    };

    const refresh = useCallback((reset?: boolean | any) => {
        // Strict boolean check to prevent Event objects from triggering reset
        const shouldReset = reset === true;
        logger.debug('[useAdminData] refresh', { shouldReset, pageIndex: pageIndexRef.current });
        
        if (shouldReset) {
            cursorStack.current = [undefined];
            setPageIndex(0);
            fetchData(0, true);
        } else {
            fetchData(pageIndexRef.current, false);
        }
    }, [fetchData]);

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
