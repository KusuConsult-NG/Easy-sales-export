"use client";

import React from "react";

/**
 * Legacy Firebase Auth Provider (Shimmed)
 * Bridges NextAuth session with Firebase Authentication.
 * Decoupled: Firebase client SDK has been removed; this provider is now a no-op.
 */
export function FirebaseAuthProvider({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
