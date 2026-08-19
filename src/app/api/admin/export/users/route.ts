export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { hasAdminPermission } from "@/lib/admin-permissions";
import { csvDocument } from "@/lib/csv-safe";

export async function GET(request: NextRequest) {
    try {
        const session = (await requireSession()).session;
        if (!session?.user) {
            return new NextResponse("Unauthorized", { status: 401 });
        }

        // A CSV of every user on the platform — name, email, phone, state.
        //
        // isAdmin() is true for EVERY admin role, so support, moderator
        // and every module admin could download this — an academy admin
        // could take the contact details of every member on the platform.
        // canAccessAdminRoute already silos these people by module at the
        // route layer; this aligns the data layer with that.
        if (!hasAdminPermission(session.user.roles, "users:export")) {
            return new NextResponse("Admin access required", { status: 403 });
        }

        // Fetch ALL users (Warning: Will pull up to Vercel memory limits, but avoids 500 pagination cap)
        // Usually, 34,000 JSON records fit safely in 40-50MB RAM.
        //
        // .all(), which is what the comment above always intended. A bare .get()
        // on an unbounded query stops at DEFAULT_QUERY_LIMIT (5,000) and returns
        // a snapshot indistinguishable from a complete one — so on a platform of
        // ~34,000 users this exported the first 5,000 and called itself a full
        // export. The intent was right; the mechanism silently defeated it.
        const snapshot = await db.collection(COLLECTIONS.USERS).all().get();
        if (snapshot.truncated) {
            logger.error("[export/users] user sweep hit the unbounded ceiling — the CSV below is incomplete.");
        }
        
        const headers = [
            "ID", "Name", "Email", "Phone", "Gender", "Roles", "Verified",
            "BVN", "BVN Verified", "NIN", "NIN Verified",
            "TIN", "TIN Verified", "CAC", "CAC Verified",
            "KYC Status", "State", "LGA", "Date Joined"
        ];

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
            
            return cols;
        });

        const csvContent = csvDocument(headers, rows);

        return new NextResponse(csvContent, {
            status: 200,
            headers: {
                "Content-Type": "text/csv; charset=utf-8",
                // A truncated export looks exactly like a complete one to
                // whoever opens the file, so say so out of band.
                "X-Export-Truncated": String(snapshot.truncated),
                "Content-Disposition": `attachment; filename="users_${new Date().toISOString().slice(0, 10)}.csv"`,
            },
        });
    } catch (error) {
        logger.error("Failed to export users CSV:", error);
        return new NextResponse("Internal server error", { status: 500 });
    }
}
