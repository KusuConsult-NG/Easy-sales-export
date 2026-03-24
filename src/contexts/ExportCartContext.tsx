"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from "react";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ExportProduct {
    id: string;
    name: string;
    icon: string;
    origin: string;
    season: string;
    category: string;
    grades: string[];
    certifications: string[];
    /** Price in USD per metric ton */
    pricePerMT: number;
    /** Minimum order in metric tons */
    minOrderMT: number;
}

export interface ExportCartItem {
    product: ExportProduct;
    /** Selected grade */
    grade: string;
    /** Quantity in metric tons */
    quantityMT: number;
}

interface ExportCartContextType {
    cart: ExportCartItem[];
    addToCart: (product: ExportProduct, quantityMT: number, grade: string) => void;
    removeFromCart: (productId: string) => void;
    updateQuantity: (productId: string, quantityMT: number) => void;
    updateGrade: (productId: string, grade: string) => void;
    clearCart: () => void;
    cartCount: number;
    cartTotal: number;
    isCartOpen: boolean;
    setIsCartOpen: (open: boolean) => void;
}

// ── Context ────────────────────────────────────────────────────────────────────

const ExportCartContext = createContext<ExportCartContextType | undefined>(undefined);

const STORAGE_KEY = "export_cart";

// ── Provider ───────────────────────────────────────────────────────────────────

export function ExportCartProvider({ children }: { children: React.ReactNode }) {
    const [cart, setCart] = useState<ExportCartItem[]>([]);
    const [isCartOpen, setIsCartOpen] = useState(false);
    const [isHydrated, setIsHydrated] = useState(false);

    // Hydrate from localStorage on mount
    useEffect(() => {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                setTimeout(() => setCart(JSON.parse(saved)), 0);
            }
        } catch {
            // Ignore parse errors
        }
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setIsHydrated(true);
    }, []);

    // Persist to localStorage on change
    useEffect(() => {
        if (isHydrated) {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(cart));
        }
    }, [cart, isHydrated]);

    const addToCart = useCallback((product: ExportProduct, quantityMT: number, grade: string) => {
        setCart(prev => {
            const existing = prev.find(item => item.product.id === product.id);
            if (existing) {
                // Update existing item
                return prev.map(item =>
                    item.product.id === product.id
                        ? { ...item, quantityMT: item.quantityMT + quantityMT, grade }
                        : item
                );
            }
            return [...prev, { product, quantityMT, grade }];
        });
        setIsCartOpen(true);
    }, []);

    const removeFromCart = useCallback((productId: string) => {
        setCart(prev => prev.filter(item => item.product.id !== productId));
    }, []);

    const updateQuantity = useCallback((productId: string, quantityMT: number) => {
        if (quantityMT <= 0) {
            setCart(prev => prev.filter(item => item.product.id !== productId));
            return;
        }
        setCart(prev =>
            prev.map(item =>
                item.product.id === productId ? { ...item, quantityMT } : item
            )
        );
    }, []);

    const updateGrade = useCallback((productId: string, grade: string) => {
        setCart(prev =>
            prev.map(item =>
                item.product.id === productId ? { ...item, grade } : item
            )
        );
    }, []);

    const clearCart = useCallback(() => {
        setCart([]);
        localStorage.removeItem(STORAGE_KEY);
    }, []);

    const cartCount = useMemo(() => cart.length, [cart]);

    const cartTotal = useMemo(
        () => cart.reduce((sum, item) => sum + item.product.pricePerMT * item.quantityMT, 0),
        [cart]
    );

    const value = useMemo<ExportCartContextType>(
        () => ({
            cart,
            addToCart,
            removeFromCart,
            updateQuantity,
            updateGrade,
            clearCart,
            cartCount,
            cartTotal,
            isCartOpen,
            setIsCartOpen,
        }),
        [cart, addToCart, removeFromCart, updateQuantity, updateGrade, clearCart, cartCount, cartTotal, isCartOpen]
    );

    return (
        <ExportCartContext.Provider value={value}>
            {children}
        </ExportCartContext.Provider>
    );
}

// ── Hook ───────────────────────────────────────────────────────────────────────

export function useExportCart() {
    const context = useContext(ExportCartContext);
    if (!context) {
        throw new Error("useExportCart must be used within an ExportCartProvider");
    }
    return context;
}
