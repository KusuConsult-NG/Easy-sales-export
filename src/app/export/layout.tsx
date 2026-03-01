import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Export Windows — Invest in Nigerian Agricultural Exports",
    description: "Fund verified Nigerian agricultural export contracts and earn 18–22% ROI in 4–6 months. Yam, sesame seeds, hibiscus and more — with full escrow protection.",
    alternates: { canonical: "https://easysalesexport.com/export" },
    openGraph: {
        title: "Export Windows — Agricultural Export Investment Platform",
        description: "Invest in verified Nigerian agricultural exports. Earn 18–22% ROI on yam, sesame, hibiscus contracts with escrow-protected funds.",
        url: "https://easysalesexport.com/export",
        images: [{ url: "/images/og-banner.png", width: 1200, height: 630, alt: "Export Windows — Agricultural Investment" }],
    },
};

export default function ExportLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
