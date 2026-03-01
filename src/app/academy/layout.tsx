import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Easy Sales Export Academy — Agricultural & Export Education",
    description: "Structured education for Nigerians to master agricultural exports, cooperative positioning, and agro-business. Foundation, Advanced, and Elite programs available.",
    alternates: { canonical: "https://easysalesexport.com/academy" },
    openGraph: {
        title: "Easy Sales Export Academy",
        description: "Learn how to position yourself for agro and export opportunities in Nigeria. Foundation to Elite training programmes.",
        url: "https://easysalesexport.com/academy",
        images: [{ url: "/images/og-banner.png", width: 1200, height: 630, alt: "Easy Sales Export Academy" }],
    },
};

export default function AcademyLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
