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

        const urlOptions = new URL(request.url).searchParams;
        const state = urlOptions.get("state");
        const lga = urlOptions.get("lga");
        const fromDate = urlOptions.get("fromDate");
        const toDate = urlOptions.get("toDate");
        const search = urlOptions.get("search")?.toLowerCase() || "";

        let query: FirebaseFirestore.Query = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS);

        if (state) query = query.where("stateOfOrigin", "==", state);
        if (lga) query = query.where("lga", "==", lga);
        if (fromDate) {
            query = query.where("createdAt", ">=", new Date(fromDate));
        }
        if (toDate) {
            const tDate = new Date(toDate);
            tDate.setHours(23, 59, 59, 999);
            query = query.where("createdAt", "<=", tDate);
        }

        const snapshot = await query.get();
        // Fallback user mapping to get names and emails for members missing them
        const userIds = [...new Set(snapshot.docs.map(doc => doc.data().userId || doc.id))];
        const userFallbackMap = new Map<string, any>();
        
        for (let i = 0; i < userIds.length; i += 100) {
            const batch = userIds.slice(i, i + 100);
            const refs = batch.map(id => db.collection(COLLECTIONS.USERS).doc(id));
            try {
                const userDocs = await db.getAll(...refs);
                userDocs.forEach(doc => {
                    if (doc.exists) {
                        userFallbackMap.set(doc.id, doc.data());
                    }
                });
            } catch (err) {
                logger.error("Failed to fetch batch user fallbacks", err);
            }
        }
        
        const headersLine = [
            "ID", "Name", "Email", "Phone", "Tier", "Registration Fee (NGN)",
            "Payment Status", "Membership Status", "State", "LGA",
            "Occupation", "Date Applied"
        ].map(h => `"${h}"`).join(",");

        const rows: string[] = [];
        
        snapshot.docs.forEach(doc => {
            const data = doc.data();
            const userId = data.userId || doc.id;
            const fallbackUser = userFallbackMap.get(userId) || {};

            let derivedFirstName = data.firstName || (data.fullName ? data.fullName.split(" ")[0] : "");
            let derivedLastName = data.lastName || (data.fullName ? data.fullName.split(" ").slice(-1)[0] : "");

            if (!derivedFirstName) {
                derivedFirstName = fallbackUser.firstName || (fallbackUser.fullName ? fallbackUser.fullName.split(" ")[0] : "");
            }
            if (!derivedLastName) {
                derivedLastName = fallbackUser.lastName || (fallbackUser.fullName ? fallbackUser.fullName.split(" ").slice(-1)[0] : "");
            }

            const fullName = `${derivedFirstName} ${derivedLastName}`.trim();
            const email = data.email || fallbackUser.email || "";
            const phone = data.phone || fallbackUser.phone || "";
            const state = data.stateOfOrigin || fallbackUser.address?.state || "";
            const lga = data.lga || fallbackUser.address?.lga || "";
            const createdAt = data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : "";
            
            const cols = [
                doc.id,
                fullName,
                email,
                phone,
                data.membershipTier || "Member",
                (data.registrationFee || 0).toString(),
                data.paymentStatus || "pending",
                data.membershipStatus || "pending",
                state,
                lga,
                data.occupation || "",
                createdAt
            ];
            
            
            if (search) {
                if (!fullName.toLowerCase().includes(search) && 
                    !email.toLowerCase().includes(search) && 
                    !phone.includes(search)) {
                    return; // skip if search term doesn't match
                }
            }
            
            rows.push(cols.map(c => `"${String(c).replace(/"/g, '""')}"`).join(","));
        });

        const csvContent = [headersLine, ...rows].join("\n");

        return new NextResponse(csvContent, {
            status: 200,
            headers: {
                "Content-Type": "text/csv; charset=utf-8",
                "Content-Disposition": `attachment; filename="cooperative_members_${new Date().toISOString().slice(0, 10)}.csv"`,
            },
        });
    } catch (error) {
        logger.error("Failed to export cooperative members CSV:", error);
        return new NextResponse("Internal server error", { status: 500 });
    }
}
