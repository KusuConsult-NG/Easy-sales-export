import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase";
import { collection, query, where, getDocs, getDoc, doc } from "firebase/firestore";

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

        // Check admin role
        const userRef = doc(db, "users", session.user.id);
        const userDoc = await getDoc(userRef);

        if (!userDoc.exists() || userDoc.data().role !== "admin") {
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

        // Fetch WAVE applications
        const applicationsRef = collection(db, "wave_applications");
        let applicationsQuery = query(applicationsRef);

        if (dateFilter) {
            applicationsQuery = query(
                applicationsRef,
                where("createdAt", ">=", dateFilter)
            );
        }

        const applicationsSnapshot = await getDocs(applicationsQuery);
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

        // Calculate financial metrics (sample data - replace with real data)
        const totalDisbursed = applications
            .filter(app => app.status === "approved" && app.amountDisbursed)
            .reduce((sum, app) => sum + (app.amountDisbursed || 0), 0);

        const averageLoanSize = approved > 0 ? totalDisbursed / approved : 0;
        const repaymentRate = 85; // TODO: Calculate from actual repayment data

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
            // Age groups
            const age = app.age || 0;
            if (age >= 18 && age <= 25) ageGroups["18-25"]++;
            else if (age >= 26 && age <= 35) ageGroups["26-35"]++;
            else if (age >= 36 && age <= 45) ageGroups["36-45"]++;
            else if (age >= 46 && age <= 55) ageGroups["46-55"]++;
            else if (age >= 56) ageGroups["56+"]++;

            // States
            const state = app.state || "Unknown";
            states[state] = (states[state] || 0) + 1;

            // Business Types
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
            activeMembers: approved, // Simplified
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
        console.error("Failed to fetch compliance data:", error);
        return NextResponse.json(
            { success: false, message: "Internal server error" },
            { status: 500 }
        );
    }
}
