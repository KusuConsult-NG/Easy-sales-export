import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

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
        if (!userId) {
            setIsLoading(false);
            return;
        }

        async function checkStatus() {
            try {
                if (collectionName === "users") {
                    const { data: userRow, error } = await supabase
                        .from('users')
                        .select('raw_data')
                        .eq('id', userId)
                        .maybeSingle();

                    if (!error && userRow) {
                        const userData = userRow.raw_data || {};
                        const regData = userData?.serviceRegistrations?.[statusField];
                        const currentStatus = regData?.status;
                        if (currentStatus) {
                            setStatus(currentStatus);
                        }
                    }
                } else {
                    let tableName = 'document_collections';
                    if (collectionName === 'cooperative_members') tableName = 'cooperative_members';
                    else if (collectionName === 'academy_applications') tableName = 'academy_applications';

                    let docs: any[] = [];
                    if (tableName === 'document_collections') {
                        const { data: rows, error } = await supabase
                            .from('document_collections')
                            .select('raw_data')
                            .eq('collection_name', collectionName)
                            .eq('raw_data->>userId', userId);

                        if (!error && rows) {
                            docs = rows.map(r => r.raw_data || {});
                        }
                    } else {
                        const { data: rows, error } = await supabase
                            .from(tableName)
                            .select('*')
                            .eq('user_id', userId);

                        if (!error && rows) {
                            docs = rows.map(r => r.raw_data || {});
                        }
                    }

                    if (docs.length > 0) {
                        // Sort by createdAt desc
                        docs.sort((a, b) => {
                            const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
                            const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
                            return bTime - aTime;
                        });

                        const latestData = docs[0];
                        const currentStatus = latestData[statusField] || "pending";
                        setStatus(currentStatus);
                        if (latestData.createdAt) {
                            setCreatedAt(new Date(latestData.createdAt));
                        }
                        if (latestData.rejectionReason) {
                            setRejectionReason(latestData.rejectionReason);
                        }
                    }
                }
            } catch (err) {
                console.error("usePendingApplicationStatus error:", err);
            } finally {
                setIsLoading(false);
            }
        }

        checkStatus();
        const interval = setInterval(checkStatus, 10000); // Poll every 10 seconds

        return () => clearInterval(interval);
    }, [userId, collectionName, statusField]);

    return { status, isLoading, rejectionReason, createdAt };
}
