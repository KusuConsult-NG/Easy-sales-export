import { useState, useEffect, useCallback, useRef } from 'react';

interface UseAdminDataOptions<T> {
    fetchAction: (params: any) => Promise<{ success: boolean; data?: any; error?: string | null; loans?: any[]; properties?: any[]; users?: any[]; lastDocId?: string; hasMore?: boolean }>;
    limit?: number;
}

export function useAdminData<T>({ fetchAction, limit = 20 }: UseAdminDataOptions<T>) {
    const [data, setData] = useState<T[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [pageIndex, setPageIndex] = useState(0);
    const [search, setSearch] = useState('');
    const [filters, setFilters] = useState<Record<string, any>>({});
    const [hasMore, setHasMore] = useState(false);

    // Cursor stack: index 0 = page 1 cursor, index 1 = page 2 cursor, etc.
    // cursors[i] is the lastDocId to use when fetching page i+1
    const cursorStack = useRef<(string | undefined)[]>([undefined]);

    const fetchData = useCallback(async (page: number, resetCursors = false) => {
        setLoading(true);
        setError(null);

        try {
            const cursor = resetCursors ? undefined : cursorStack.current[page] ?? undefined;

            const params = {
                limit,
                search,
                ...filters,
                lastDocId: cursor,
            };

            const result = await fetchAction(params);

            if (result.success) {
                const items = result.data || result.loans || result.properties || result.users || [];
                setData(items);

                // Store the cursor for the NEXT page
                if (result.lastDocId) {
                    const newStack = resetCursors ? [undefined] : [...cursorStack.current];
                    newStack[page + 1] = result.lastDocId;
                    cursorStack.current = newStack;
                }

                const more = result.hasMore ?? (items.length === limit);
                setHasMore(more);
            } else {
                setError(result.error || 'Failed to fetch data');
            }
        } catch (err: any) {
            setError(err.message || 'An error occurred');
        } finally {
            setLoading(false);
        }
    }, [fetchAction, limit, search, filters]);

    // Reset to page 0 whenever search or filters change
    useEffect(() => {
        cursorStack.current = [undefined];
        setPageIndex(0);
        fetchData(0, true);
    }, [search, filters]); // eslint-disable-line react-hooks/exhaustive-deps

    const updateFilter = (key: string, value: any) => {
        setFilters(prev => ({ ...prev, [key]: value }));
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
        hasMore,
        onNextPage,
        onPrevPage,
        pageIndex,
        setData,
        refresh,
    };
}
