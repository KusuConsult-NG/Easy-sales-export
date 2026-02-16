import { useState, useCallback, useEffect } from "react";
import { useDebounce } from "@/hooks/useDebounce";

interface FetchResult<T> {
    success: boolean;
    data?: T[]; // Generic data array
    users?: T[]; // Legacy support if actions return specific keys
    properties?: T[];
    error?: string | null;
    lastDocId?: string;
    hasMore?: boolean;
}

interface UseAdminDataOptions<T> {
    fetchAction: (params: any) => Promise<FetchResult<T>>;
    limit?: number;
    initialSort?: string;
}

export function useAdminData<T extends { id: string }>({
    fetchAction,
    limit = 20
}: UseAdminDataOptions<T>) {
    const [data, setData] = useState<T[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Filter State
    const [search, setSearch] = useState("");
    const [filters, setFilters] = useState<Record<string, any>>({});

    // Pagination State
    const [pageStack, setPageStack] = useState<(string | undefined)[]>([]); // Stack of start cursors
    const [currentPageCursor, setCurrentPageCursor] = useState<string | undefined>(undefined);
    const [nextPageCursor, setNextPageCursor] = useState<string | undefined>(undefined);
    const [hasMore, setHasMore] = useState(false);

    // Debounce search
    const debouncedSearch = useDebounce(search, 500);

    const fetchData = useCallback(async (cursor?: string, isPagination = false) => {
        setLoading(true);
        setError(null);
        try {
            // Build params
            const params = {
                limit,
                search: debouncedSearch,
                lastDocId: cursor,
                ...filters
            };

            const result = await fetchAction(params);

            if (!result.success) {
                throw new Error(result.error || "Failed to fetch data");
            }

            // Handle different return keys from actions (legacy vs new)
            const resultData = result.data || result.users || result.properties || [];

            setData(resultData);
            setNextPageCursor(result.lastDocId);
            setHasMore(!!result.hasMore);

            // If this was a fresh load (filter change), reset stack
            if (!isPagination) {
                setPageStack([]);
                setCurrentPageCursor(undefined);
            }

        } catch (err: any) {
            setError(err.message || "An error occurred");
        } finally {
            setLoading(false);
        }
    }, [fetchAction, limit, debouncedSearch, filters]);

    // Initial Load & Filter Change
    useEffect(() => {
        fetchData(undefined, false);
    }, [fetchData]);

    const onNextPage = () => {
        if (!hasMore || !nextPageCursor) return;

        // Push current page's start cursor to stack
        setPageStack(prev => [...prev, currentPageCursor]);

        // Update current cursor to the next one
        setCurrentPageCursor(nextPageCursor);

        // Fetch next page
        fetchData(nextPageCursor, true);
    };

    const onPrevPage = () => {
        if (pageStack.length === 0) return;

        const newStack = [...pageStack];
        const prevCursor = newStack.pop(); // Pop the start cursor of the previous page

        setPageStack(newStack);
        setCurrentPageCursor(prevCursor);

        fetchData(prevCursor, true);
    };

    const refresh = () => {
        fetchData(currentPageCursor, true);
    };

    const updateFilter = (key: string, value: any) => {
        setFilters(prev => ({ ...prev, [key]: value }));
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
        pageIndex: pageStack.length,
        refresh,
        setData // Allow optimistic updates
    };
}
