"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { searchProductsAction } from "@/app/actions/marketplace";
import { Product } from "@/lib/types/marketplace";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useDebounce } from "@/hooks/useDebounce"; // Assuming we have this, or I'll implement a simple one

export function useMarketplaceSearch() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const pathname = usePathname();

    // State
    const [products, setProducts] = useState<Product[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [hasMore, setHasMore] = useState(false);
    const [lastId, setLastId] = useState<string | undefined>(undefined);

    // Filters State (Synced with URL)
    const [query, setQuery] = useState(searchParams.get("q") || "");
    const [category, setCategory] = useState(searchParams.get("category") || "All Categories");
    const [state, setState] = useState(searchParams.get("state") || "All Locations");

    const debouncedQuery = useDebounce(query, 500);

    // Initial Load & Filter Change
    useEffect(() => {
        const fetchProducts = async () => {
            setLoading(true);
            setError(null);

            // Build filters
            const filters = {
                query: debouncedQuery,
                category: category === "All Categories" ? undefined : category,
                state: state === "All Locations" ? undefined : state,
                limit: 12,
            };

            const result = await searchProductsAction(filters);

            if (result.success) {
                setProducts(result.products || []);
                setLastId(result.lastId);
                setHasMore(result.hasMore || false);
            } else {
                setError(result.error || "Failed to fetch products");
                setProducts([]);
            }
            setLoading(false);
        };

        fetchProducts();

        // Update URL
        const params = new URLSearchParams(searchParams.toString());
        if (debouncedQuery) params.set("q", debouncedQuery);
        else params.delete("q");

        if (category && category !== "All Categories") params.set("category", category);
        else params.delete("category");

        if (state && state !== "All Locations") params.set("state", state);
        else params.delete("state");

        router.replace(`${pathname}?${params.toString()}`, { scroll: false });

    }, [debouncedQuery, category, state]); // Dependencies that trigger a reset/refetch

    // Load More
    const loadMore = async () => {
        if (loading || !hasMore || !lastId) return;

        setLoading(true);
        const filters = {
            query: debouncedQuery,
            category: category === "All Categories" ? undefined : category,
            state: state === "All Locations" ? undefined : state,
            limit: 12,
            lastId, // Pass cursor
        };

        const result = await searchProductsAction(filters);

        if (result.success) {
            setProducts(prev => [...prev, ...(result.products || [])]);
            setLastId(result.lastId);
            setHasMore(result.hasMore || false);
        } else {
            setError(result.error || "Failed to load more products");
        }
        setLoading(false);
    };

    return {
        products,
        loading,
        error,
        hasMore,
        loadMore,
        filters: {
            query,
            setQuery,
            category,
            setCategory,
            state,
            setState
        }
    };
}
