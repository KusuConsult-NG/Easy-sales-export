"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebase";

/**
 * useFirebaseAuthed - React hook that monitors client-side Firebase Authentication state.
 * Returns true only when the Firebase Client SDK auth is fully initialized and matches the NextAuth userId.
 */
export function useFirebaseAuthed(userId: string | undefined): boolean {
    const [isAuthed, setIsAuthed] = useState<boolean>(() => {
        if (typeof window === "undefined") return false;
        return !!(userId && auth.currentUser && auth.currentUser.uid === userId);
    });

    useEffect(() => {
        if (!userId) {
            setIsAuthed(false);
            return;
        }

        // Check if already authenticated to avoid unnecessary state transitions
        if (auth.currentUser && auth.currentUser.uid === userId) {
            setIsAuthed(true);
        } else {
            setIsAuthed(false);
        }

        const unsubscribe = onAuthStateChanged(auth, (user) => {
            if (user && user.uid === userId) {
                setIsAuthed(true);
            } else {
                setIsAuthed(false);
            }
        });

        return () => unsubscribe();
    }, [userId]);

    return isAuthed;
}
