import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "WAVE Programme — Agricultural Workers Alliance of Vigilant Exporters",
    description: "Join the WAVE programme for certified Nigerian agricultural exporters. Get training, market access, cooperative positioning, and export readiness support.",
    alternates: { canonical: "https://easysalesexport.com/wave" },
    openGraph: {
        title: "WAVE — Agricultural Export Workers Alliance Nigeria",
        description: "Apply to the WAVE programme and gain access to training, export markets, and cooperative resources for Nigerian agricultural workers.",
        url: "https://easysalesexport.com/wave",
        images: [{ url: "/images/og-banner.png", width: 1200, height: 630, alt: "WAVE Programme Nigeria" }],
    },
};

export default function WaveLandingLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
