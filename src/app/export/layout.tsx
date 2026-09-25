import type { Metadata } from "next";
import { canonicalUrl } from "@/lib/canonical-host";
import { DEFAULT_EXPORT_ROI_PERCENT } from "@/lib/export-window-status";

export const metadata: Metadata = {
    title: "Export Windows — Invest in Nigerian Agricultural Exports",
    /*
     *   #903 THE FIGURE THE PLATFORM PAYS, NOT A RANGE AROUND IT.
     *
     *   This said "earn 18–22% ROI". Nothing on this platform pays 18% or 22%:
     *   DEFAULT_EXPORT_ROI_PERCENT is 20, and its own note says why that number
     *   and no other — "20% is the return the platform already pays when a
     *   window records nothing", and using anything else "would have the page
     *   advertise one figure and the payout compute another."
     *
     *   The same file's `exportWindowRoiPercent` exists because a RANGE was
     *   already found doing exactly that: a window carrying the label "15-20%"
     *   made the investor page quote 15 while the two fulfilment paths paid
     *   `amount * 1.20`. A range is not a single figure, and this is the public,
     *   indexed, search-result version of the claim.
     *
     *   Derived, so the claim cannot drift from the rate. The per-window rate
     *   still governs an individual window — this is the platform-level default,
     *   which is what a page about the module as a whole can honestly state.
     */
    description: `Fund verified Nigerian agricultural export contracts and earn ${DEFAULT_EXPORT_ROI_PERCENT}% ROI on completed cycles. Yam, sesame seeds, hibiscus and more — with full escrow protection.`,
        //   #902 The host the middleware actually serves — see lib/canonical-host.
    alternates: { canonical: canonicalUrl("/export") },
    openGraph: {
        title: "Export Windows — Agricultural Export Investment Platform",
        description: `Invest in verified Nigerian agricultural exports. Earn ${DEFAULT_EXPORT_ROI_PERCENT}% ROI on yam, sesame and hibiscus contracts with escrow-protected funds.`,
        url: canonicalUrl("/export"),
        images: [{ url: "/images/og-banner.png", width: 1200, height: 630, alt: "Export Windows — Agricultural Investment" }],
    },
};

export default function ExportLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
