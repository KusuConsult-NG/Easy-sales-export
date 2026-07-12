"use client";

/**
 * Legacy Firebase Authentication Guard (Shimmed)
 * Always returns true since all components now route through NextAuth and Supabase directly.
 */
export function useFirebaseAuthed(userId: string | undefined) {
    return true;
}
