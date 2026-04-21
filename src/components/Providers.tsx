"use client";

import { SessionProvider } from "next-auth/react";
import { SessionRefreshListener } from "@/components/session-refresh-listener";

export function Providers({ children }: { children: React.ReactNode }) {
    return (
        <SessionProvider>
            <SessionRefreshListener />
            {children}
        </SessionProvider>
    );
}
