import type { Metadata } from "next";
import { canonicalUrl } from "@/lib/canonical-host";

export const metadata: Metadata = {
    title: "Easy Sales Export Academy — Agricultural & Export Education",
    description: "Structured education for Nigerians to master agricultural exports, cooperative positioning, and agro-business. Foundation, Advanced, and Elite programs available.",
        //   #902 The host the middleware actually serves — see lib/canonical-host.
    alternates: { canonical: canonicalUrl("/academy") },
    openGraph: {
        title: "Easy Sales Export Academy",
        description: "Learn how to position yourself for agro and export opportunities in Nigeria. Foundation to Elite training programmes.",
        url: canonicalUrl("/academy"),
        images: [{ url: "/images/og-banner.png", width: 1200, height: 630, alt: "Easy Sales Export Academy" }],
    },
};

import { GlobalResilienceBoundary } from "@/components/shared/GlobalResilienceBoundary";

export default function AcademyLayout({ children }: { children: React.ReactNode }) {
    return (
        <GlobalResilienceBoundary moduleName="Academy" dashboardUrl="/academy/dashboard">
            {children}
        </GlobalResilienceBoundary>
    );
}
