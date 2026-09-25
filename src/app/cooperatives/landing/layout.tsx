import type { Metadata } from "next";
import { canonicalUrl } from "@/lib/canonical-host";

export const metadata: Metadata = {
    title: "Cooperative Society — Save, Borrow & Grow Together",
    description: "Join Nigeria's thriving agricultural cooperative. Access pooled savings, low-interest loans, and collective investment opportunities.",
        //   #902 The host the middleware actually serves — see lib/canonical-host.
    alternates: { canonical: canonicalUrl("/cooperatives") },
    openGraph: {
        title: "Easy Sales Export Cooperative Society",
        description: "Pool resources, access loans and grow your agricultural business with fellow cooperative members across Nigeria.",
        url: canonicalUrl("/cooperatives"),
        images: [{ url: "/images/og-banner.png", width: 1200, height: 630, alt: "Easy Sales Export Cooperative Society" }],
    },
};

export default function LandingLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return <>{children}</>;
}
