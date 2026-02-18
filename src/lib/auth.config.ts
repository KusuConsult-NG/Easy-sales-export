import type { NextAuthConfig } from "next-auth";

/**
 * Edge-compatible authentication configuration.
 * 
 * This file is imported by middleware.ts (Edge Runtime) and auth.ts (Node Runtime).
 * It MUST NOT import any Node.js libraries (like firebase-admin).
 */
export const authConfig = {
    providers: [], // Providers are configured in auth.ts for Node runtime
    pages: {
        signIn: "/auth/login",
    },
} satisfies NextAuthConfig;
