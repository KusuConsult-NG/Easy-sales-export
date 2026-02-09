/**
 * WAVE Public Pages Layout
 * 
 * This layout is for public WAVE pages (landing, info pages)
 * NO SIDEBAR - clean layout for unauthenticated users
 */

import { Metadata } from "next";

export const metadata: Metadata = {
    title: "RH-WAVE 774 | Women Agro-Value Expansion Programme",
    description: "Presidential initiative empowering Nigerian women in agriculture through training, funding, and market access.",
};

export default function WAVEPublicLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    // Return children wrapped in a simple div - no sidebar
    return <div className="min-h-screen">{children}</div>;
}
