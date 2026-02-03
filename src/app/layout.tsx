import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Sidebar } from "@/components/layout/Sidebar";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "Easy Sales Export - Agricultural Export Platform",
  description:
    "Nigeria's premier platform for agricultural export management. Export yam, sesame seeds, and dried hibiscus to international markets.",
  keywords: [
    "agricultural export",
    "Nigeria",
    "yam export",
    "sesame seeds",
    "hibiscus",
    "export platform",
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} antialiased`}>
        <div className="flex h-screen overflow-hidden">
          <Sidebar />
          <main className="flex-1 overflow-y-auto bg-slate-50 dark:bg-slate-950">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
