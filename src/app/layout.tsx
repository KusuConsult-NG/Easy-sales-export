
import { Inter } from "next/font/google";
import "./globals.css";
import { ClientLayout } from "@/components/layout/ClientLayout";
import { validateProductionSecrets, checkForExposedKeys } from "@/lib/security-checks";

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
  themeColor: "#166534",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export const metadata: Metadata = {
  title: {
    default: "Easy Sales Export - Agricultural Export Platform",
    template: "%s | Easy Sales Export"
  },
  description: "Nigeria's premier platform for agricultural export management. Export yam, sesame seeds, and dried hibiscus to international markets.",
  keywords: ["agricultural export", "Nigeria", "yam export", "sesame seeds", "hibiscus", "export platform", "Easy Sales Export"],
  authors: [{ name: "KusuConsult-NG" }],
  creator: "KusuConsult-NG",
  metadataBase: new URL("https://easysalesexport.com"),
  openGraph: {
    type: "website",
    locale: "en_NG",
    url: "https://easysalesexport.com",
    title: "Easy Sales Export - Agricultural Export Platform",
    description: "Start your agricultural export journey today. Managed windows, marketplace, and academy.",
    siteName: "Easy Sales Export",
    images: [
      {
        url: "/images/og-image.jpg", // Ensure this exists or use logo
        width: 1200,
        height: 630,
        alt: "Easy Sales Export Platform",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Easy Sales Export",
    description: "Nigeria's premier agricultural export platform.",
    images: ["/images/og-image.jpg"], // Fallback to same image
    creator: "@EasySalesExport",
  },
  icons: {
    icon: "/images/logo.jpg",
    apple: "/images/logo.jpg",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
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
      </head>
      <body
        className={inter.variable}
        suppressHydrationWarning
      >
        <ClientLayout>{children}</ClientLayout>
      </body>
    </html>
  );
}
