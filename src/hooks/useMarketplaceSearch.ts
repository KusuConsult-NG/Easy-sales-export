import { useState, useEffect, useCallback } from 'react';
import { useDebounce } from './useDebounce';
import { searchProductsAction } from '@/app/actions/marketplace/_actions';

interface Product {
    id: string;
    title: string;
    description: string;
    price: number;
    images: string[];
    sellerName: string;
    location: { state: string };
    pricingTiers?: { price: number }[];
    unit: string;
    rating?: number;
    exportReady: boolean;
}

export function useMarketplaceSearch() {
    const [products, setProducts] = useState<Product[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [hasMore, setHasMore] = useState(false);

    // Filter states
    const [query, setQuery] = useState("");
    const [category, setCategory] = useState("All Categories");
    const [state, setState] = useState("All Locations");

    const debouncedQuery = useDebounce(query, 500);

    const loadProducts = useCallback(async (isLoadMore = false) => {
        setLoading(true);
        setError(null);
        try {
            const currentLastId = isLoadMore ? (products[products.length - 1]?.id || undefined) : undefined;
            const result = await searchProductsAction({
                query: debouncedQuery || undefined,
                category: category !== "All Categories" ? category : undefined,
                state: state !== "All Locations" ? state : undefined,
                limit: 12,
                lastId: currentLastId
            });

            if (result.success && result.data) {
                const mappedProducts = result.data.products.map(p => ({
                    id: p.id,
                    title: p.title,
                    description: p.description,
                    price: p.pricingTiers?.[0]?.price ?? 0,
                    images: p.images || [],
                    sellerName: p.sellerName || "Verified Seller",
                    location: { state: p.location?.state || "Nigeria" },
                    pricingTiers: p.pricingTiers || [],
                    unit: p.unit,
                    rating: p.rating,
                    exportReady: p.exportReady
                }));

                if (isLoadMore) {
                    setProducts(prev => [...prev, ...mappedProducts]);
                } else {
                    setProducts(mappedProducts);
                }
                setHasMore(result.data.hasMore);
            } else {
                setError(result.error || "Failed to fetch products");
                if (!isLoadMore) {
                    setProducts([]);
                }
            }
        } catch (err: any) {
            setError(err.message || "An unexpected error occurred");
            if (!isLoadMore) {
                setProducts([]);
            }
        } finally {
            setLoading(false);
        }
    }, [debouncedQuery, category, state, products]);

    useEffect(() => {
        loadProducts(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [debouncedQuery, category, state]);

    const loadMore = useCallback(() => {
        loadProducts(true);
    }, [loadProducts]);

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
