import { useState, useEffect } from "react";
import { db } from "@/lib/firebase";
import { collection, query, where, onSnapshot, doc } from "firebase/firestore";

interface UsePendingApplicationStatusOptions {
    collectionName: string;
    userId: string | undefined;
    statusField: string; // e.g., 'membershipStatus', 'status', or 'farmNation' for nested user check
}

export function usePendingApplicationStatus({
    collectionName,
    userId,
    statusField,
}: UsePendingApplicationStatusOptions) {
    const [status, setStatus] = useState<string>("pending");
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [rejectionReason, setRejectionReason] = useState<string | null>(null);
    const [createdAt, setCreatedAt] = useState<Date | null>(null);

    useEffect(() => {
        if (!userId) return;

        let unsub: () => void;

        if (collectionName === "users") {
            // Special case: Farm Nation listens directly on the user doc
            const docRef = doc(db, "users", userId);
            unsub = onSnapshot(docRef, (snap) => {
                setIsLoading(false);
                if (!snap.exists()) return;
                const userData = snap.data();
                const regData = userData?.serviceRegistrations?.[statusField];
                const currentStatus = regData?.status;
                if (currentStatus) {
                    setStatus(currentStatus);
                }
            }, () => {
                setIsLoading(false);
            });
        } else {
            // General case: Query collection by userId
            const q = query(
                collection(db, collectionName),
                where("userId", "==", userId)
            );

            unsub = onSnapshot(q, (snap) => {
                setIsLoading(false);
                if (snap.empty) return;

                // Sort to find the latest application in case of resubmissions
                const sortedDocs = snap.docs.sort((a, b) => {
                    const aTime = a.data().createdAt?.toMillis?.() || a.data().createdAt?.seconds * 1000 || 0;
                    const bTime = b.data().createdAt?.toMillis?.() || b.data().createdAt?.seconds * 1000 || 0;
                    return bTime - aTime;
                });

                const latestDoc = sortedDocs[0];
                const data = latestDoc.data();
                const currentStatus = data[statusField] || "pending";
                
                setStatus(currentStatus);
                if (data.createdAt) {
                    setCreatedAt(data.createdAt.toDate?.() || new Date(data.createdAt.seconds * 1000));
                }
                if (data.rejectionReason) {
                    setRejectionReason(data.rejectionReason);
                }
            }, () => {
                setIsLoading(false);
            });
        }

        return () => {
            unsub?.();
        };
    }, [userId, collectionName, statusField]);

    return { status, isLoading, rejectionReason, createdAt };
}
