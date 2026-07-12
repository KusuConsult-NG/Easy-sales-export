"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useSession } from "next-auth/react";

const MODULE_TO_REG_KEY: Record<string, string> = {
    wave: "wave",
    academy: "academy",
    export: "export",
    cooperative: "cooperatives",
    cooperatives: "cooperatives",
    "farm-nation": "farmNation",
    farmNation: "farmNation",
    marketplace: "marketplace",
};

/**
 * Real-time Membership Status Guard (Supabase Compatibility Version)
 * Polls Supabase directly using client-side REST endpoint.
 */
export function useMembershipStatus(userId: string | undefined, moduleType: string, userEmail?: string) {
    const { data: session } = useSession();
    const regKey = MODULE_TO_REG_KEY[moduleType];
    const sessionStatus = session?.user 
        ? (session.user as any)?.serviceRegistrations?.[regKey]?.status 
        : undefined;

    const [status, setStatus] = useState<string>(() => sessionStatus || "loading");
    const [data, setData] = useState<any>(null);

    useEffect(() => {
        if (!userId) {
            setStatus("unauthenticated");
            return;
        }

        async function checkStatus() {
            try {
                // 1. Fetch user doc from Supabase to check serviceRegistrations status
                const { data: userRow, error: userError } = await supabase
                    .from('users')
                    .select('raw_data')
                    .eq('id', userId)
                    .maybeSingle();

                if (!userError && userRow) {
                    const userData = userRow.raw_data || {};
                    const serviceRegistrations = userData.serviceRegistrations || {};
                    let registration = serviceRegistrations[regKey];
                    if (regKey === "cooperatives") {
                        registration = serviceRegistrations["cooperatives"] || serviceRegistrations["cooperative"];
                    }
                    if (regKey === "farmNation") {
                        registration = serviceRegistrations["farmNation"] || serviceRegistrations["farm_nation"];
                    }
                    const s = registration?.status;
                    if (s === "approved" || s === "active" || s === "verified" || s === "paid") {
                        setData(registration);
                        setStatus(s);
                        return;
                    }
                }

                // 2. Query table-based fallback
                let tableName = 'document_collections';
                let colName = '';
                if (moduleType === 'cooperative' || moduleType === 'cooperatives') {
                    tableName = 'cooperative_members';
                } else if (moduleType === 'academy') {
                    tableName = 'academy_applications';
                } else if (moduleType === 'wave') {
                    colName = 'wave_applications';
                } else if (moduleType === 'export') {
                    colName = 'export_applications';
                } else if (moduleType === 'farm-nation') {
                    colName = 'farmnation_applications';
                }

                if (tableName === 'document_collections') {
                    const { data: colRows, error: colError } = await supabase
                        .from('document_collections')
                        .select('raw_data')
                        .eq('collection_name', colName)
                        .eq('raw_data->>userId', userId);

                    if (!colError && colRows && colRows.length > 0) {
                        const docData = colRows[0].raw_data || {};
                        setData(docData);
                        setStatus(docData.status || docData.membershipStatus || "pending");
                        return;
                    }
                } else {
                    const { data: tableRows, error: tableError } = await supabase
                        .from(tableName)
                        .select('*')
                        .eq('user_id', userId);

                    if (!tableError && tableRows && tableRows.length > 0) {
                        const row = tableRows[0];
                        const docData = row.raw_data || {};
                        setData(docData);
                        setStatus(row.status || docData.status || docData.membershipStatus || "pending");
                        return;
                    }
                }

                if (sessionStatus) {
                    setStatus(sessionStatus);
                } else {
                    setStatus("not_found");
                }
            } catch (err) {
                console.error(`[useMembershipStatus] Error checking status for ${moduleType}:`, err);
                setStatus("error");
            }
        }

        checkStatus();
        const interval = setInterval(checkStatus, 8000); // Poll every 8 seconds

        return () => clearInterval(interval);
    }, [userId, moduleType, userEmail, regKey, sessionStatus]);

    return { status, data, isLoading: status === "loading" };
}
