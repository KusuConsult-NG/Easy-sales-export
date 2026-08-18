export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { csvDocument } from "@/lib/csv-safe";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { isAdmin } from "@/lib/admin-permissions";

/**
 * API Route: Export WAVE Compliance Reports (PDF/CSV)
 */
export async function POST(request: NextRequest) {
    try {
        const session = (await requireSession()).session;
        if (!session?.user) {
            return NextResponse.json(
                { success: false, message: "Unauthorized" },
                { status: 401 }
            );
        }

        // Check admin role from session (not from DB query)
        if (!isAdmin(session.user.roles)) {
            return NextResponse.json(
                { success: false, message: "Admin access required" },
                { status: 403 }
            );
        }

        const { searchParams } = new URL(request.url);
        const format = searchParams.get("format") || "csv";
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
        let query: import("@/lib/supabase-db").SupabaseQuery = db.collection(COLLECTIONS.WAVE_APPLICATIONS);

        if (dateFilter) {
            query = query.where("createdAt", ">=", dateFilter);
        }

        // .all() — this is an EXPORT, so a silent cap at DEFAULT_QUERY_LIMIT
        // (5,000) hands the admin a file that looks complete and is not.
        const applicationsSnapshot = await query.all().get();
        if (applicationsSnapshot.truncated) {
            logger.error("[wave/reports/export] WAVE applications sweep hit the unbounded ceiling — the export below is incomplete.");
        }
        
        // Fetch linked user documents
        const userIds = [...new Set(applicationsSnapshot.docs.map(doc => doc.data().userId).filter(Boolean))];
        const userFallbackMap = new Map<string, any>();
        
        for (let i = 0; i < userIds.length; i += 100) {
            const batch = (userIds as string[]).slice(i, i + 100);
            const refs = batch.map(id => db.collection(COLLECTIONS.USERS).doc(id));
            try {
                const userDocs = await db.getAll(...refs);
                userDocs.forEach(doc => {
                    if (doc.exists) {
                        userFallbackMap.set(doc.id, doc.data());
                    }
                });
            } catch (err) {
                logger.error("Failed to fetch batch user fallbacks for WAVE", err);
            }
        }

        const PLACEHOLDER_NAMES = new Set(["user", "unknown", "unknown user", "n/a", ""]);
        const isPlaceholder = (v: any) => !v || PLACEHOLDER_NAMES.has(String(v).toLowerCase().trim());

        const applications = applicationsSnapshot.docs.map(doc => {
            const appData = doc.data();
            const userId = appData.userId;
            const fallbackUser = userFallbackMap.get(userId) || {};
            
            // Resolve phone
            let phone = appData.phone || appData.phoneNumber || fallbackUser.phone || fallbackUser.phoneNumber || fallbackUser.kyc?.phoneNumber || fallbackUser.kyc?.phone || "";
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
            if (isPlaceholder(phone)) phone = "";

            // Resolve state
            let state = appData.stateOfResidence || appData.stateOfOrigin || appData.state || appData.residentialState || fallbackUser.state || fallbackUser.stateOfOrigin || fallbackUser.address?.state || fallbackUser.verificationProfile?.address?.state || "";
            if (isPlaceholder(state) && fallbackUser.serviceRegistrations) {
                for (const reg of Object.values(fallbackUser.serviceRegistrations) as any[]) {
                    const profile = reg?.profile || reg;
                    const pState = profile?.state || profile?.stateOfOrigin || profile?.address?.state || reg?.companyInfo?.state || reg?.personalInfo?.state || "";
                    if (pState && !isPlaceholder(pState)) {
                        state = pState;
                        break;
                    }
                }
            }
            if (isPlaceholder(state)) state = "";

            // Resolve name
            let fullName = appData.fullName || [appData.firstName, appData.surname || appData.lastName].filter(Boolean).join(" ") || fallbackUser.fullName || [fallbackUser.firstName, fallbackUser.lastName].filter(Boolean).join(" ") || "";
            if (isPlaceholder(fullName)) fullName = "";

            return {
                id: doc.id,
                ...appData,
                fullName,
                phone,
                state,
                email: appData.email || fallbackUser.email || "",
                // NOT `?? new Date().toISOString()`. An application with no date
                // was stamped with the export date, so a compliance report showed
                // it as submitted today. Left null and rendered as "Unknown".
                createdAt: appData.createdAt?.toDate?.()?.toISOString?.() ?? appData.createdAt ?? null,
            };
        });

        if (format === "csv") {
            return generateCSV(applications, timeframe);
        } else if (format === "pdf") {
            return generatePDFReport(applications, timeframe);
        }

        return NextResponse.json(
            { success: false, message: "Invalid format" },
            { status: 400 }
        );
    } catch (error) {
        logger.error("Failed to export report:", error);
        return NextResponse.json(
            { success: false, message: "Internal server error" },
            { status: 500 }
        );
    }
}

function generateCSV(applications: any[], timeframe: string) {
    /**
     * Columns the WAVE application collection actually has.
     *
     * FIVE OF THE THIRTEEN WERE PHANTOMS
     * ----------------------------------
     * Business Name, Business Type, Years in Business, Amount Requested and Amount
     * Disbursed are not fields on a WAVE application — the schema in
     * _wv_applications.ts has none of them, and no writer sets any. Every row
     * exported blank or 0 in those five columns, on a compliance report.
     *
     * They are replaced with the fields the form does collect: occupation, income
     * band, value-chain interests, commodities and cooperative membership. That
     * changes the shape of the downloaded file, deliberately — five empty columns
     * are not a format worth preserving.
     */
    const headers = [
        "Application ID",
        "Full Name",
        "Email",
        "Phone",
        "Status",
        "State of Residence",
        "LGA of Residence",
        "Age",
        "Occupation",
        "Monthly Income Band",
        "Value Chain Areas",
        "Preferred Commodities",
        "Cooperative Member",
        "Application Date",
    ];

    const list = (v: unknown) => (Array.isArray(v) ? v.join("; ") : (v ?? ""));

    const rows = applications.map(app => [
        app.id,
        app.fullName || "",
        app.email || "",
        app.phone || "",
        app.status || "pending",
        app.state || "",
        app.lgaOfResidence || app.lgaOfOrigin || "",
        app.age || "",
        app.currentOccupation || "",
        app.averageMonthlyIncome || "",
        list(app.valueChainAreas),
        list(app.preferredCommodities),
        app.isMemberOfCooperative === true ? "Yes" : app.isMemberOfCooperative === false ? "No" : "",
        // "Unknown" rather than the export date. See the createdAt note above.
        app.createdAt ? new Date(app.createdAt).toLocaleDateString() : "Unknown",
    ]);

    const csvContent = csvDocument(headers, rows);

    return new NextResponse(csvContent, {
        status: 200,
        headers: {
            "Content-Type": "text/csv",
            "Content-Disposition": `attachment; filename="wave_compliance_${timeframe}_${Date.now()}.csv"`,
        },
    });
}

function generatePDFReport(applications: any[], timeframe: string) {
    const totalApplications = applications.length;
    const approved = applications.filter(app => app.status === "approved").length;
    const rejected = applications.filter(app => app.status === "rejected").length;
    const pending = applications.filter(app => app.status === "pending").length;

    /**
     * Disbursement is NOT TRACKED on a WAVE application.
     *
     * `amountDisbursed` is not a field in the schema and no writer sets it, so this
     * sum has always been 0 — and the report presented "Total Disbursed: ₦0" and
     * "Average Loan Size: ₦0" as measured figures on a compliance document. Zero
     * and not-recorded are different claims, and only one of them was true.
     */
    const disbursementRows = applications.filter(app => Number(app.amountDisbursed) > 0);
    const disbursementTracked = disbursementRows.length > 0;
    const totalDisbursed = disbursementRows
        .filter(app => app.status === "approved")
        .reduce((sum, app) => sum + (Number(app.amountDisbursed) || 0), 0);

    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>WAVE Compliance Report</title>
    <style>
        body { font-family: Arial, sans-serif; padding: 40px; color: #333; }
        h1 { color: #059669; border-bottom: 3px solid #059669; padding-bottom: 10px; }
        .stats { display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; margin: 30px 0; }
        .stat-card { border: 1px solid #e5e7eb; padding: 20px; border-radius: 8px; background: #f9fafb; }
        .stat-label { font-size: 14px; color: #6b7280; margin-bottom: 5px; }
        .stat-value { font-size: 32px; font-weight: bold; color: #059669; }
        table { width: 100%; border-collapse: collapse; margin-top: 30px; }
        th { background: #059669; color: white; padding: 12px; text-align: left; font-weight: 600; }
        td { padding: 10px 12px; border-bottom: 1px solid #e5e7eb; }
        tr:nth-child(even) { background: #f9fafb; }
        .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #6b7280; text-align: center; }
    </style>
</head>
<body>
    <h1>WAVE Program Compliance Report</h1>
    <p><strong>Report Period:</strong> ${timeframe.charAt(0).toUpperCase() + timeframe.slice(1)}</p>
    <p><strong>Generated:</strong> ${new Date().toLocaleDateString()}</p>

    <div class="stats">
        <div class="stat-card"><div class="stat-label">Total Applications</div><div class="stat-value">${totalApplications}</div></div>
        <div class="stat-card"><div class="stat-label">Approved</div><div class="stat-value">${approved}</div></div>
        <div class="stat-card"><div class="stat-label">Pending</div><div class="stat-value">${pending}</div></div>
        <div class="stat-card"><div class="stat-label">Rejected</div><div class="stat-value">${rejected}</div></div>
    </div>

    <h2>Financial Summary</h2>
    ${disbursementTracked ? `
    <p><strong>Total Disbursed:</strong> ₦${totalDisbursed.toLocaleString()}</p>
    <p><strong>Average Loan Size:</strong> ₦${approved > 0 ? (totalDisbursed / approved).toLocaleString() : 0}</p>
    ` : `
    <p><em>Disbursement is not recorded against WAVE applications, so no
    disbursed total or average loan size can be reported for this period. This is
    an absence of data, not a figure of zero.</em></p>
    `}

    <h2>Application Details</h2>
    <table>
        <thead>
            <tr><th>Name</th><th>State</th><th>Occupation</th><th>Status</th><th>Date</th></tr>
        </thead>
        <tbody>
            ${applications.slice(0, 50).map(app => `
                <tr>
                    <td>${app.fullName || "N/A"}</td>
                    <td>${app.state || "N/A"}</td>
                    <td>${app.currentOccupation || "N/A"}</td>
                    <td style="color: ${app.status === 'approved' ? '#059669' : app.status === 'rejected' ? '#dc2626' : '#f59e0b'}">
                        ${(app.status || 'pending').toUpperCase()}
                    </td>
                    <td>${app.createdAt ? new Date(app.createdAt).toLocaleDateString() : "Unknown"}</td>
                </tr>
            `).join("")}
        </tbody>
    </table>

    ${applications.length > 50 ? `<p style="margin-top: 20px; color: #6b7280;"><em>Showing 50 of ${applications.length} applications</em></p>` : ''}

    <div class="footer">
        <p>Easy Sales Export - WAVE Program</p>
        <p>Women in Agriculture Venture Excellence</p>
    </div>
</body>
</html>
    `;

    return new NextResponse(htmlContent, {
        status: 200,
        headers: {
            "Content-Type": "text/html",
            "Content-Disposition": `inline; filename="wave_compliance_${timeframe}_${Date.now()}.html"`,
        },
    });
}
