export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { db } from "@/lib/firebase-admin";
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
            "ID", "Name", "Email", "Phone", "Roles", "Verified",
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
            
            const cols = [
                doc.id,
                derivedName,
                data.email || "",
                data.phone || "",
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
                data.address?.state || data.stateOfOrigin || "",
                data.address?.lga || data.lga || "",
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
