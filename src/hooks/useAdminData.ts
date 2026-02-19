import { useState, useEffect, useCallback } from 'react';

interface UseAdminDataOptions<T> {
    fetchAction: (params: any) => Promise<{ success: boolean; data?: any; error?: string | null; loans?: any[]; properties?: any[]; users?: any[] }>;
    limit?: number;
}

export function useAdminData<T>({ fetchAction, limit = 20 }: UseAdminDataOptions<T>) {
    const [data, setData] = useState<T[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Pagination & Search
    const [pageIndex, setPageIndex] = useState(0);
    const [search, setSearch] = useState("");
    const [filters, setFilters] = useState<Record<string, any>>({});
    const [hasMore, setHasMore] = useState(false);
    const [lastDoc, setLastDoc] = useState<any>(null); // For cursor-based pagination if needed, or just offset

    const fetchData = useCallback(async (reset = false) => {
        setLoading(true);
        setError(null);

        try {
            const params = {
                limit,
                search,
                ...filters,
                // Add pagination params here if fetchAction supports it
                // offset: pageIndex * limit 
            };

            const result = await fetchAction(params);

            if (result.success) {
                // Handle different response structures
                const items = result.data || result.loans || result.properties || result.users || [];

                if (reset) {
                    setData(items);
                } else {
                    setData(prev => [...prev, ...items]);
                }

                setHasMore(items.length === limit);
            } else {
                setError(result.error || "Failed to fetch data");
            }
        } catch (err: any) {
            setError(err.message || "An error occurred");
        } finally {
            setLoading(false);
        }
    }, [fetchAction, limit, search, filters, pageIndex]);

    // Initial load and search/filter changes
    useEffect(() => {
        setPageIndex(0);
        fetchData(true);
    }, [search, filters]);

    const updateFilter = (key: string, value: any) => {
        setFilters(prev => ({ ...prev, [key]: value }));
    };

    const onNextPage = () => {
        if (hasMore) {
            setPageIndex(prev => prev + 1);
            // In a real implementation with cursor pagination, we'd trigger a fetch here with the next cursor
            // For now, simple state update
        }
    };

    const onPrevPage = () => {
        if (pageIndex > 0) {
            setPageIndex(prev => prev - 1);
        }
    };

    const refresh = () => fetchData(true);

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
        setData, // Allow manual updates (e.g. deletion)
        refresh
    };
}
