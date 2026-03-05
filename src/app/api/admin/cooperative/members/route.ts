export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase-admin";

/**
 * API Route: Get All Cooperative Membership Applications (Admin)
 * Supports: status, state, lga, fromDate, toDate filters + cursor pagination
 */
export async function GET(request: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user) {
            return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
        }

        const roles = session.user.roles || [];
        if (!roles.includes("admin") && !roles.includes("super_admin")) {
            return NextResponse.json({ success: false, message: "Admin access required" }, { status: 403 });
        }

        const { searchParams } = new URL(request.url);
        const limitParam = parseInt(searchParams.get("limit") || "50");
        const lastCreatedAt = searchParams.get("lastCreatedAt");
        const status = searchParams.get("status");
        const stateFilter = searchParams.get("state") || "";
        const lgaFilter = searchParams.get("lga") || "";
        const fromDate = searchParams.get("fromDate") || "";
        const toDate = searchParams.get("toDate") || "";

        // Build query — start from collection
        let query: FirebaseFirestore.Query = db.collection("cooperative_members");

        // Status filter
        if (status && status !== "all") {
            query = query.where("membershipStatus", "==", status);
        }

        // State filter (server-side)
        if (stateFilter) {
            query = query.where("stateOfOrigin", "==", stateFilter);
        }

        // LGA filter (server-side)
        if (lgaFilter) {
            query = query.where("lga", "==", lgaFilter);
        }

        // Date range filters
        if (fromDate) {
            query = query.where("createdAt", ">=", new Date(fromDate));
        }
        if (toDate) {
            const end = new Date(toDate);
            end.setHours(23, 59, 59, 999);
            query = query.where("createdAt", "<=", end);
        }

        // Always order by createdAt desc (must come after all inequality filters)
        query = query.orderBy("createdAt", "desc");

        // Cursor-based pagination
        if (lastCreatedAt) {
            query = query.startAfter(new Date(lastCreatedAt));
        }

        query = query.limit(limitParam);

        const snapshot = await query.get();

        const members = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                userId: data.userId || doc.id,
                firstName: data.firstName || "",
                lastName: data.lastName || "",
                middleName: data.middleName || "",
                email: data.email || "",
                phone: data.phone || "",
                membershipTier: data.membershipTier || "basic",
                registrationFee: data.registrationFee || 0,
                membershipStatus: data.membershipStatus || "pending",
                paymentStatus: data.paymentStatus || "pending",
                onboardingCompleted: data.onboardingCompleted || false,
                dateOfBirth: data.dateOfBirth || "",
                gender: data.gender || "",
                stateOfOrigin: data.stateOfOrigin || "",
                lga: data.lga || "",
                residentialAddress: data.residentialAddress || "",
                occupation: data.occupation || "",
                nextOfKin: {
                    name: data.nextOfKin?.name || data.nextOfKinName || "",
                    phone: data.nextOfKin?.phone || data.nextOfKinPhone || "",
                    address: data.nextOfKin?.address || data.nextOfKinAddress || "",
                },
                documents: data.documents || {},
                createdAt: data.createdAt?.toDate?.() || new Date(),
                updatedAt: data.updatedAt?.toDate?.() || new Date(),
            };
        });

        // 🐛 FIX: Only return paid members in the list to match dashboard counts
        // Exclude abandoned/unpaid registrations
        const paidMembers = members.filter(m => m.paymentStatus === "completed");

        const hasMore = snapshot.docs.length === limitParam;
        const newLastCreatedAt = snapshot.docs.length > 0 ? snapshot.docs[snapshot.docs.length - 1].data().createdAt?.toDate() : undefined;

        return NextResponse.json({ success: true, members: paidMembers, hasMore, lastCreatedAt: newLastCreatedAt });
    } catch (error) {
        logger.error("Failed to fetch members:", error);
        return NextResponse.json({ success: false, message: "Internal server error" }, { status: 500 });
    }
}
