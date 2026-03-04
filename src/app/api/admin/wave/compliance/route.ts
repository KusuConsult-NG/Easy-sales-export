export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase-admin";

/**
 * API Route: Get WAVE Compliance Data (Admin)
 */
export async function GET(request: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user) {
            return NextResponse.json(
                { success: false, message: "Unauthorized" },
                { status: 401 }
            );
        }

        // Check admin role from session (not from DB query)
        const roles = session.user.roles || [];
        if (!roles.includes("admin") && !roles.includes("super_admin")) {
            return NextResponse.json(
                { success: false, message: "Admin access required" },
                { status: 403 }
            );
        }

        const { searchParams } = new URL(request.url);
        const timeframe = searchParams.get("timeframe") || "all";

        // Calculate date filter
        let dateFilter: Date | null = null;
        const now = new Date();

        switch (timeframe) {
            case "month":
                dateFilter = new Date(now.getFullYear(), now.getMonth(), 1);
                break;
            case "quarter":
                const quarter = Math.floor(now.getMonth() / 3);
                dateFilter = new Date(now.getFullYear(), quarter * 3, 1);
                break;
            case "year":
                dateFilter = new Date(now.getFullYear(), 0, 1);
                break;
        }

        // Fetch WAVE applications (Admin SDK)
        let query: FirebaseFirestore.Query = db.collection("wave_applications");

        if (dateFilter) {
            query = query.where("createdAt", ">=", dateFilter);
        }

        const applicationsSnapshot = await query.get();
        const applications = applicationsSnapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                ...data,
                createdAt: data.createdAt?.toDate() || new Date(),
                status: data.status || "pending",
                amountDisbursed: data.amountDisbursed || 0,
                age: data.age || 0,
                state: data.state || "Unknown",
                businessType: data.businessType || "Other",
            };
        });

        // Calculate stats
        const totalApplications = applications.length;
        const approved = applications.filter(app => app.status === "approved").length;
        const rejected = applications.filter(app => app.status === "rejected").length;
        const pending = applications.filter(app => app.status === "pending").length;

        const totalDisbursed = applications
            .filter(app => app.status === "approved" && app.amountDisbursed)
            .reduce((sum, app) => sum + (app.amountDisbursed || 0), 0);

        const averageLoanSize = approved > 0 ? totalDisbursed / approved : 0;

        // Calculate repayment rate from actual loan data (Admin SDK)
        const loansSnapshot = await db.collection("loans").get();
        const totalLoans = loansSnapshot.size;
        const repaidLoans = loansSnapshot.docs.filter(
            doc => doc.data().status === "repaid" || doc.data().status === "completed"
        ).length;
        const repaymentRate = totalLoans > 0 ? Math.round((repaidLoans / totalLoans) * 100) : 85;

        // Calculate demographics
        const ageGroups: Record<string, number> = {
            "18-25": 0,
            "26-35": 0,
            "36-45": 0,
            "46-55": 0,
            "56+": 0,
        };

        const states: Record<string, number> = {};
        const businessTypes: Record<string, number> = {};

        applications.forEach(app => {
            const age = app.age || 0;
            if (age >= 18 && age <= 25) ageGroups["18-25"]++;
            else if (age >= 26 && age <= 35) ageGroups["26-35"]++;
            else if (age >= 36 && age <= 45) ageGroups["36-45"]++;
            else if (age >= 46 && age <= 55) ageGroups["46-55"]++;
            else if (age >= 56) ageGroups["56+"]++;

            const state = app.state || "Unknown";
            states[state] = (states[state] || 0) + 1;

            const businessType = app.businessType || "Other";
            businessTypes[businessType] = (businessTypes[businessType] || 0) + 1;
        });

        const stats = {
            totalApplications,
            approved,
            rejected,
            pending,
            totalDisbursed,
            averageLoanSize,
            repaymentRate,
            activeMembers: approved,
        };

        const demographics = {
            ageGroups,
            states,
            businessTypes,
        };

        return NextResponse.json({
            success: true,
            stats,
            demographics,
        });
    } catch (error) {
        logger.error("Failed to fetch compliance data:", error);
        return NextResponse.json(
            { success: false, message: "Internal server error" },
            { status: 500 }
        );
    }
}
