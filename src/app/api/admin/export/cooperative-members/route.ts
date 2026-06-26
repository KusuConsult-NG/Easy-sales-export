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
            "ID", "Name", "Email", "Phone", "Gender", "Tier", "Registration Fee (NGN)",
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

            const PLACEHOLDER_NAMES = new Set(["user", "unknown", "unknown user", "n/a", ""]);
            const isPlaceholder = (v: any) => !v || PLACEHOLDER_NAMES.has(String(v).toLowerCase().trim());

            let phone = data.phone || data.phoneNumber || fallbackUser.phone || fallbackUser.phoneNumber || fallbackUser.kyc?.phoneNumber || fallbackUser.kyc?.phone || "";
            if (isPlaceholder(phone) && fallbackUser.serviceRegistrations) {
                for (const reg of Object.values(fallbackUser.serviceRegistrations) as any[]) {
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

            let cleanState = data.state || data.stateOfOrigin || fallbackUser.state || fallbackUser.stateOfOrigin || fallbackUser.address?.state || fallbackUser.verificationProfile?.address?.state || "";
            if (isPlaceholder(cleanState) && fallbackUser.serviceRegistrations) {
                for (const reg of Object.values(fallbackUser.serviceRegistrations) as any[]) {
                    const profile = reg?.profile || reg;
                    const pState = profile?.state || profile?.stateOfOrigin || profile?.address?.state || reg?.companyInfo?.state || reg?.personalInfo?.state || "";
                    if (pState && !isPlaceholder(pState)) {
                        cleanState = pState;
                        break;
                    }
                }
            }
            if (isPlaceholder(cleanState)) cleanState = "";

            let cleanLga = data.lga || fallbackUser.lga || fallbackUser.address?.lga || "";
            if (isPlaceholder(cleanLga) && fallbackUser.serviceRegistrations) {
                for (const reg of Object.values(fallbackUser.serviceRegistrations) as any[]) {
                    const profile = reg?.profile || reg;
                    const pLga = profile?.lga || profile?.address?.lga || reg?.personalInfo?.lga || "";
                    if (pLga && !isPlaceholder(pLga)) {
                        cleanLga = pLga;
                        break;
                    }
                }
            }
            if (isPlaceholder(cleanLga)) cleanLga = "";

            // In-memory state and lga filters
            if (state && cleanState.toLowerCase().trim() !== state.toLowerCase().trim()) {
                return;
            }
            if (lga && cleanLga.toLowerCase().trim() !== lga.toLowerCase().trim()) {
                return;
            }

            const createdAt = data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : "";
            
            const cols = [
                doc.id,
                fullName,
                email,
                phone,
                data.gender || fallbackUser.gender || "",
                data.membershipTier || "Member",
                (data.registrationFee || 0).toString(),
                data.paymentStatus || "pending",
                data.membershipStatus || "pending",
                cleanState,
                cleanLga,
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
