import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Farm Nation — Buy, Lease & Invest in Agricultural Land",
    description: "Discover prime agricultural properties across Nigeria. Find arable land, poultry farms, fish ponds and greenhouses for your agribusiness. Verified listings, expert support.",
    alternates: { canonical: "https://easysalesexport.com/farm-nation" },
    openGraph: {
        title: "Farm Nation — Agricultural Real Estate Nigeria",
        description: "Browse verified agricultural land listings across all 36 Nigerian states. Invest in arable land, fish farms, poultry farms and more.",
        url: "https://easysalesexport.com/farm-nation",
        images: [{ url: "/images/og-banner.png", width: 1200, height: 630, alt: "Farm Nation — Agricultural Land Nigeria" }],
    },
};

import { GlobalResilienceBoundary } from "@/components/shared/GlobalResilienceBoundary";

export default function FarmNationLayout({ children }: { children: React.ReactNode }) {
    return (
        <GlobalResilienceBoundary moduleName="Farm Nation" dashboardUrl="/farm-nation/dashboard">
            {children}
        </GlobalResilienceBoundary>
    );
}
