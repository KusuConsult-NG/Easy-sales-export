export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";

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
        let query: FirebaseFirestore.Query = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS);

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

        // Date range filters — only when both from/to provided (required for orderBy inequality combo)
        const hasDateFilter = !!(fromDate || toDate);
        if (fromDate) {
            query = query.where("createdAt", ">=", new Date(fromDate));
        }
        if (toDate) {
            const end = new Date(toDate);
            end.setHours(23, 59, 59, 999);
            query = query.where("createdAt", "<=", end);
        }

        // IMPORTANT: Only apply orderBy('createdAt') when a date inequality filter is active.
        // Firestore silently excludes documents where the field is null/missing when orderBy is used.
        // We sort in-memory instead for the default (no-date-filter) case.
        if (hasDateFilter) {
            query = query.orderBy("createdAt", "desc");
        }

        // Cursor-based pagination (only valid when using orderBy)
        if (lastCreatedAt && hasDateFilter) {
            query = query.startAfter(new Date(lastCreatedAt));
        }

        // Fetch with a generous limit so in-memory sort sees all results
        const fetchLimit = hasDateFilter ? limitParam : Math.max(limitParam, 500);
        query = query.limit(fetchLimit);

        const snapshot = await query.get();

        const members = snapshot.docs.map(doc => {
            const data = doc.data();
            // Defensive name derivation — supports legacy fullName-only AND new firstName/lastName schema
            const derivedFirstName = data.firstName || (data.fullName ? data.fullName.split(" ")[0] : "");
            const derivedLastName = data.lastName || (data.fullName ? data.fullName.split(" ").slice(-1)[0] : "");
            return {
                id: doc.id,
                userId: data.userId || doc.id,
                firstName: derivedFirstName,
                lastName: derivedLastName,
                // otherName: supports both new 'otherName' field and legacy 'middleName'
                otherName: data.otherName || data.middleName || "",
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
                createdAt: data.createdAt?.toDate?.() || new Date(0),
                updatedAt: data.updatedAt?.toDate?.() || new Date(0),
            };
        });

        // Sort in-memory by createdAt descending (newest first, safe for docs missing the field)
        members.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

        // Show ALL members regardless of payment status — admins need full visibility
        // (payment status filter can be applied client-side if needed)
        const pagedMembers = members.slice(0, limitParam);

        const hasMore = members.length > limitParam;
        const newLastCreatedAt = pagedMembers.length > 0 ? pagedMembers[pagedMembers.length - 1].createdAt : undefined;

        return NextResponse.json({ success: true, members: pagedMembers, hasMore, lastCreatedAt: newLastCreatedAt });
    } catch (error) {
        logger.error("Failed to fetch members:", error);
        return NextResponse.json({ success: false, message: "Internal server error" }, { status: 500 });
    }
}
