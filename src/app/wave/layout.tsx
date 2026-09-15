/**
 * WAVE Public Pages Layout
 * 
 * This layout is for public WAVE pages (landing, info pages)
 * NO SIDEBAR - clean layout for unauthenticated users
 */

import { Metadata } from "next";

//   #788 The programme's name comes from one constant. Before #774
//   this screen spelled it out, and the owner has now corrected that
//   spelling twice — see lib/wave-program.
import { WAVE_FULL_NAME } from "@/lib/wave-program";

export const metadata: Metadata = {
    title: `RH-WAVE 774 | ${WAVE_FULL_NAME} Programme`,
    description: "Presidential initiative empowering Nigerian women in agriculture through training, funding, and market access.",
};

export default function WAVEPublicLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    // Return children wrapped in a simple div - no sidebar
    return <div className="min-h-screen">{children}</div>;
}
