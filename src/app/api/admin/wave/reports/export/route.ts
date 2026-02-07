import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase";
import { collection, query, where, getDocs, getDoc, doc } from "firebase/firestore";

/**
 * API Route: Export WAVE Compliance Reports (PDF/CSV)
 */
export async function POST(request: NextRequest) {
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
        const applications = applicationsSnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            createdAt: doc.data().createdAt?.toDate() || new Date(),
        }));

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
        console.error("Failed to export report:", error);
        return NextResponse.json(
            { success: false, message: "Internal server error" },
            { status: 500 }
        );
    }
}

function generateCSV(applications: any[], timeframe: string) {
    // CSV Headers
    const headers = [
        "Application ID",
        "Full Name",
        "Email",
        "Phone",
        "Business Name",
        "Business Type",
        "Years in Business",
        "Status",
        "Amount Requested",
        "Amount Disbursed",
        "State",
        "Age",
        "Application Date",
    ];

    // CSV Rows
    const rows = applications.map(app => [
        app.id,
        app.fullName || "",
        app.email || "",
        app.phone || "",
        app.businessName || "",
        app.businessType || "",
        app.yearsInBusiness || "",
        app.status || "pending",
        app.amountRequested || 0,
        app.amountDisbursed || 0,
        app.state || "",
        app.age || "",
        app.createdAt ? new Date(app.createdAt).toLocaleDateString() : "",
    ]);

    // Build CSV content
    const csvContent = [
        headers.join(","),
        ...rows.map(row => row.map(cell => `"${cell}"`).join(",")),
    ].join("\n");

    // Return CSV response
    return new NextResponse(csvContent, {
        status: 200,
        headers: {
            "Content-Type": "text/csv",
            "Content-Disposition": `attachment; filename="wave_compliance_${timeframe}_${Date.now()}.csv"`,
        },
    });
}

function generatePDFReport(applications: any[], timeframe: string) {
    // Calculate stats
    const totalApplications = applications.length;
    const approved = applications.filter(app => app.status === "approved").length;
    const rejected = applications.filter(app => app.status === "rejected").length;
    const pending = applications.filter(app => app.status === "pending").length;

    const totalDisbursed = applications
        .filter(app => app.status === "approved" && app.amountDisbursed)
        .reduce((sum, app) => sum + (app.amountDisbursed || 0), 0);

    // Generate simple HTML report (can be converted to PDF using a library)
    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>WAVE Compliance Report</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            padding: 40px;
            color: #333;
        }
        h1 {
            color: #059669;
            border-bottom: 3px solid #059669;
            padding-bottom: 10px;
        }
        .stats {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 20px;
            margin: 30px 0;
        }
        .stat-card {
            border: 1px solid #e5e7eb;
            padding: 20px;
            border-radius: 8px;
            background: #f9fafb;
        }
        .stat-label {
            font-size: 14px;
            color: #6b7280;
            margin-bottom: 5px;
        }
        .stat-value {
            font-size: 32px;
            font-weight: bold;
            color: #059669;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 30px;
        }
        th {
            background: #059669;
            color: white;
            padding: 12px;
            text-align: left;
            font-weight: 600;
        }
        td {
            padding: 10px 12px;
            border-bottom: 1px solid #e5e7eb;
        }
        tr:nth-child(even) {
            background: #f9fafb;
        }
        .footer {
            margin-top: 40px;
            padding-top: 20px;
            border-top: 1px solid #e5e7eb;
            font-size: 12px;
            color: #6b7280;
            text-align: center;
        }
    </style>
</head>
<body>
    <h1>WAVE Program Compliance Report</h1>
    <p><strong>Report Period:</strong> ${timeframe.charAt(0).toUpperCase() + timeframe.slice(1)}</p>
    <p><strong>Generated:</strong> ${new Date().toLocaleDateString()}</p>

    <div class="stats">
        <div class="stat-card">
            <div class="stat-label">Total Applications</div>
            <div class="stat-value">${totalApplications}</div>
        </div>
        <div class="stat-card">
            <div class="stat-label">Approved</div>
            <div class="stat-value">${approved}</div>
        </div>
        <div class="stat-card">
            <div class="stat-label">Pending</div>
            <div class="stat-value">${pending}</div>
        </div>
        <div class="stat-card">
            <div class="stat-label">Rejected</div>
            <div class="stat-value">${rejected}</div>
        </div>
    </div>

    <h2>Financial Summary</h2>
    <p><strong>Total Disbursed:</strong> ₦${totalDisbursed.toLocaleString()}</p>
    <p><strong>Average Loan Size:</strong> ₦${approved > 0 ? (totalDisbursed / approved).toLocaleString() : 0}</p>

    <h2>Application Details</h2>
    <table>
        <thead>
            <tr>
                <th>Name</th>
                <th>Business</th>
                <th>Status</th>
                <th>Amount</th>
                <th>Date</th>
            </tr>
        </thead>
        <tbody>
            ${applications.slice(0, 50).map(app => `
                <tr>
                    <td>${app.fullName || "N/A"}</td>
                    <td>${app.businessName || "N/A"}</td>
                    <td style="color: ${app.status === 'approved' ? '#059669' : app.status === 'rejected' ? '#dc2626' : '#f59e0b'}">
                        ${(app.status || 'pending').toUpperCase()}
                    </td>
                    <td>₦${(app.amountDisbursed || app.amountRequested || 0).toLocaleString()}</td>
                    <td>${app.createdAt ? new Date(app.createdAt).toLocaleDateString() : "N/A"}</td>
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

    // Return HTML response (in production, convert to PDF using puppeteer or similar)
    return new NextResponse(htmlContent, {
        status: 200,
        headers: {
            "Content-Type": "text/html",
            "Content-Disposition": `inline; filename="wave_compliance_${timeframe}_${Date.now()}.html"`,
        },
    });
}
