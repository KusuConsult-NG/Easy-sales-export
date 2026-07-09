export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { isAdmin } from "@/lib/admin-permissions";

export async function GET(request: NextRequest) {
    try {
        const session = (await requireSession()).session;
        if (!session?.user) {
            return new NextResponse("Unauthorized", { status: 401 });
        }

        if (!isAdmin(session.user.roles)) {
            return new NextResponse("Admin access required", { status: 403 });
        }

        // Fetch ALL users (Warning: Will pull up to Vercel memory limits, but avoids 500 pagination cap)
        // Usually, 34,000 JSON records fit safely in 40-50MB RAM.
        const snapshot = await db.collection(COLLECTIONS.USERS).get();
        
        const headersLine = [
            "ID", "Name", "Email", "Phone", "Gender", "Roles", "Verified",
            "BVN", "BVN Verified", "NIN", "NIN Verified",
            "TIN", "TIN Verified", "CAC", "CAC Verified",
            "KYC Status", "State", "LGA", "Date Joined"
        ].map(h => `"${h}"`).join(",");

        const rows = snapshot.docs.map(doc => {
            const data = doc.data();
            const derivedName = data.firstName
                ? [data.firstName, data.otherName, data.lastName].filter(Boolean).join(" ").trim()
                : (data.fullName || data.name || data.displayName || data.email || "Unknown");
            
            const createdAt = data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : "";

            const PLACEHOLDER_NAMES = new Set(["user", "unknown", "unknown user", "n/a", ""]);
            const isPlaceholder = (v: any) => !v || PLACEHOLDER_NAMES.has(String(v).toLowerCase().trim());

            let phone = data.phone || data.phoneNumber || data.kyc?.phoneNumber || data.kyc?.phone || "";
            if (isPlaceholder(phone) && data.serviceRegistrations) {
                for (const reg of Object.values(data.serviceRegistrations) as any[]) {
                    const profile = reg?.profile || reg;
                    const pPhone = profile?.phone || profile?.phoneNumber || reg?.personalInfo?.phone || "";
                    if (pPhone && !isPlaceholder(pPhone)) {
                        phone = pPhone;
                        break;
                    }
                }
            }
            if (isPlaceholder(phone)) {
                phone = "";
            } else {
                phone = `'${phone}`;
            }

            let state = data.state || data.stateOfOrigin || data.address?.state || data.verificationProfile?.address?.state || "";
            if (isPlaceholder(state) && data.serviceRegistrations) {
                for (const reg of Object.values(data.serviceRegistrations) as any[]) {
                    const profile = reg?.profile || reg;
                    const pState = profile?.state || profile?.stateOfOrigin || profile?.address?.state || reg?.companyInfo?.state || reg?.personalInfo?.state || "";
                    if (pState && !isPlaceholder(pState)) {
                        state = pState;
                        break;
                    }
                }
            }
            if (isPlaceholder(state)) state = "";

            let lga = data.address?.lga || data.lga || "";
            if (isPlaceholder(lga) && data.serviceRegistrations) {
                for (const reg of Object.values(data.serviceRegistrations) as any[]) {
                    const profile = reg?.profile || reg;
                    const pLga = profile?.lga || profile?.address?.lga || reg?.personalInfo?.lga || "";
                    if (pLga && !isPlaceholder(pLga)) {
                        lga = pLga;
                        break;
                    }
                }
            }
            if (isPlaceholder(lga)) lga = "";
            
            const cols = [
                doc.id,
                derivedName,
                data.email || "",
                phone,
                data.gender || data.kyc?.gender || "",
                (data.roles || []).join(";"),
                (data.isVerified ?? data.verified ?? false) ? "Yes" : "No",
                (data.kyc?.bvn || data.bvn) ? "Provided" : "No",
                (data.kyc?.bvnVerified ?? data.bvnVerified ?? false) ? "Yes" : "No",
                (data.kyc?.nin || data.nin) ? "Provided" : "No",
                (data.kyc?.ninVerified ?? data.ninVerified ?? false) ? "Yes" : "No",
                data.taxId ? "Provided" : "No",
                data.tinVerified ? "Yes" : "No",
                data.cacNumber ? "Provided" : "No",
                data.cacVerified ? "Yes" : "No",
                data.kyc?.status || data.kycStatus || "pending",
                state,
                lga,
                createdAt
            ];
            
            return cols.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",");
        });

        const csvContent = [headersLine, ...rows].join("\n");

        return new NextResponse(csvContent, {
            status: 200,
            headers: {
                "Content-Type": "text/csv; charset=utf-8",
                "Content-Disposition": `attachment; filename="users_${new Date().toISOString().slice(0, 10)}.csv"`,
            },
        });
    } catch (error) {
        logger.error("Failed to export users CSV:", error);
        return new NextResponse("Internal server error", { status: 500 });
    }
}
