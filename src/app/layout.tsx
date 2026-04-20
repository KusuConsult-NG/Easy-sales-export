
import { Inter } from "next/font/google";
import "./globals.css";
import { ClientLayout } from "@/components/layout/ClientLayout";
import { validateProductionSecrets, checkForExposedKeys } from "@/lib/security-checks";
import GlobalScrollWatcher from "@/components/common/GlobalScrollWatcher";
import DeploymentWatcher from "@/components/DeploymentWatcher";

// Run security checks on app initialization
if (process.env.NODE_ENV === 'production') {
  // Gracefully handle build-time checks where secrets might not be present
  try {
    if (process.env.NEXT_PHASE !== 'phase-production-build' && process.env.CI !== 'true') {
      validateProductionSecrets();
    }
  } catch (error) {
    // Log but don't crash during build if we can detect it, otherwise rethrow
    console.warn("Security check failed:", error);
    // In strict production runtime, we might want to throw, but let's allow Vercel to handle envs
  }
} else {
  checkForExposedKeys();
}

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

import type { Metadata, Viewport } from "next";

export const viewport: Viewport = {
  themeColor: "#2E519F",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export const metadata: Metadata = {
  title: {
    default: "Easy Sales Export - Agricultural Export Platform",
    template: "%s | Easy Sales Export"
  },
  description: "Nigeria's premier platform for agricultural export management. Export yam, sesame seeds, and dried hibiscus to international markets.",
  keywords: ["agricultural export", "Nigeria", "yam export", "sesame seeds", "hibiscus", "export platform", "Easy Sales Export", "cooperative", "farm nation", "academy"],
  authors: [{ name: "KusuConsult-NG" }],
  creator: "KusuConsult-NG",
  metadataBase: new URL("https://easysalesexport.com"),
  alternates: {
    canonical: "https://easysalesexport.com",
  },
  openGraph: {
    type: "website",
    locale: "en_NG",
    url: "https://easysalesexport.com",
    title: "Easy Sales Export - Agricultural Export Platform",
    description: "Start your agricultural export journey today. Managed windows, marketplace, and academy.",
    siteName: "Easy Sales Export",
    images: [
      {
        // Primary OG banner — 1200×630 landscape for social cards
        url: "/images/og-banner.png",
        width: 1200,
        height: 630,
        alt: "Easy Sales Export — Nigeria's Premier Agricultural Export Platform",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Easy Sales Export — Agricultural Export Platform",
    description: "Nigeria's premier agricultural export platform. Export yam, sesame, hibiscus and more.",
    images: ["/images/og-banner.png"],
    creator: "@EasySalesExport",
  },
  icons: {
    icon: "/images/logo.jpg",
    apple: "/images/logo.jpg",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const organizationJsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    "name": "Easy Sales Export",
    "alternateName": "ESE",
    "url": "https://easysalesexport.com",
    "logo": "https://easysalesexport.com/images/logo.jpg",
    "description": "Nigeria's premier platform for agricultural export management. Connecting Nigerian exporters with international markets for yam, sesame seeds, and dried hibiscus.",
    "address": {
      "@type": "PostalAddress",
      "addressCountry": "NG"
    },
    "contactPoint": {
      "@type": "ContactPoint",
      "contactType": "customer service",
      "availableLanguage": "English"
    },
    "sameAs": [
      "https://easysalesacademy.com",
      "https://farmnation.ng",
      "https://market.easysalesexport.com",
      "https://wave.ng"
    ]
  };

  // WebSite schema — enables Google Sitelinks Searchbox in brand search results
  const websiteJsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "name": "Easy Sales Export",
    "url": "https://easysalesexport.com",
    "potentialAction": {
      "@type": "SearchAction",
      "target": {
        "@type": "EntryPoint",
        "urlTemplate": "https://easysalesexport.com/marketplace/products?q={search_term_string}"
      },
      "query-input": "required name=search_term_string"
    }
  }

  return (
    <html lang="en-NG" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  const theme = localStorage.getItem('theme');
                  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
                  const shouldBeDark = theme === 'dark' || (!theme && prefersDark);
                  if (shouldBeDark) {
                    document.documentElement.classList.add('dark');
                  }
                } catch (e) { console.warn('Theme init:', e); }
              })();
            `,
          }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteJsonLd) }}
        />
      </head>
      <body
        className={inter.variable}
        suppressHydrationWarning
      >
        <GlobalScrollWatcher />
        <DeploymentWatcher />
        <ClientLayout>{children}</ClientLayout>
      </body>
    </html>
  );
}

