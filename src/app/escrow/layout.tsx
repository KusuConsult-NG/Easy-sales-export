import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Escrow Dashboard - Easy Sales Export",
    description: "Secure payment protection for Farm Nation, Marketplace, and Export Windows",
};

export default function EscrowLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return children;
}
