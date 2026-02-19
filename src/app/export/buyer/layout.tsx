"use client";

import { ExportCartProvider } from "@/contexts/ExportCartContext";

export default function ExportBuyerLayout({ children }: { children: React.ReactNode }) {
    return (
        <ExportCartProvider>
            {children}
        </ExportCartProvider>
    );
}
