import { useState, useEffect } from "react";
import { db } from "@/lib/firebase";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { COLLECTIONS } from "@/lib/types/firestore";
import { useFirebaseAuthed } from "./useFirebaseAuthed";

export function useUnreadNotifications(userId: string | undefined) {
    const [unreadCount, setUnreadCount] = useState<number>(0);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const isAuthed = useFirebaseAuthed(userId);

    useEffect(() => {
        if (!userId) {
            setUnreadCount(0);
            setIsLoading(false);
            return;
        }
        if (!isAuthed) {
            return;
        }

        const q = query(
            collection(db, COLLECTIONS.NOTIFICATIONS),
            where("userId", "==", userId),
            where("read", "==", false)
        );

        const unsub = onSnapshot(
            q,
            (snap) => {
                setUnreadCount(snap.size);
                setIsLoading(false);
            },
            (err) => {
                console.error("Error listening to unread notifications:", err);
                setIsLoading(false);
            }
        );

        return () => {
            unsub();
        };
    }, [userId, isAuthed]);

    return { unreadCount, isLoading };
}
