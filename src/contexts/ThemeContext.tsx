"use client";

/**
 * ThemeContext — STUB (dark mode removed)
 *
 * Dark mode has been permanently disabled from the platform.
 * This file is kept as a compatibility stub so that any existing
 * imports of ThemeProvider / useTheme continue to compile without
 * changes to every call-site.
 *
 * - The app is ALWAYS in light mode.
 * - toggleTheme() is a no-op.
 * - useTheme() is safe to call outside a ThemeProvider.
 */

import { createContext, useContext, ReactNode } from "react";

type Theme = "light";

interface ThemeContextType {
    theme: Theme;
    toggleTheme: () => void;
}

const defaultValue: ThemeContextType = {
    theme: "light",
    toggleTheme: () => {}, // intentional no-op
};

const ThemeContext = createContext<ThemeContextType>(defaultValue);

export function ThemeProvider({ children }: { children: ReactNode }) {
    return (
        <ThemeContext.Provider value={defaultValue}>
            {children}
        </ThemeContext.Provider>
    );
}

export function useTheme() {
    return useContext(ThemeContext);
}
