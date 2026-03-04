export const dynamic = 'force-dynamic';

import { NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { getAdminDb } from "@/lib/firebase-admin";
import { auth } from "@/lib/auth";

export async function GET() {
    try {
        const session = await auth();
        if (!session?.user) {
            return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
        }
        // strict admin check could be added here, currently just checking if auth works
        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const adminDb = getAdminDb();

        const report = {
            schemaIssues: [] as string[],
            orphanedRecords: [] as string[],
            financialAnomalies: [] as string[],
            stats: {
                totalMembers: 0,
                totalLoans: 0,
                totalFixedSavings: 0
            }
        };

        // 1. Fetch All Members
        const membersSnapshot = await adminDb.collection("cooperative_members").get();
        const memberIds = new Set<string>();

        report.stats.totalMembers = membersSnapshot.size;

        membersSnapshot.forEach(doc => {
            const data = doc.data();

            // Schema Checks
            if (!data.firstName || !data.lastName || !data.email) {
                report.schemaIssues.push(`Member ${doc.id}: Missing required profile fields`);
            }
            if (!data.membershipStatus) {
                report.schemaIssues.push(`Member ${doc.id}: Missing membershipStatus`);
            }

            // Financial Checks
            if ((data.savingsBalance || 0) < 0) {
                report.financialAnomalies.push(`Member ${doc.id}: Negative savingsBalance (${data.savingsBalance})`);
            }
            if ((data.loanBalance || 0) < 0) {
                report.financialAnomalies.push(`Member ${doc.id}: Negative loanBalance (${data.loanBalance})`);
            }
        });

        // 2. Fetch All Loans (Foreign Key Check)
        const loansSnapshot = await adminDb.collection("cooperative_loans").get();
        report.stats.totalLoans = loansSnapshot.size;

        loansSnapshot.forEach(doc => {
            const data = doc.data();
            if (!data.memberId) {
                report.schemaIssues.push(`Loan ${doc.id}: Missing memberId`);
            } else if (!memberIds.has(data.memberId)) {
                report.orphanedRecords.push(`Loan ${doc.id}: orphaned (memberId ${data.memberId} not found)`);
            }
        });

        // 3. Fetch All Fixed Savings (Foreign Key Check)
        const fixedSavingsSnapshot = await adminDb.collection("cooperative_fixed_savings").get();
        report.stats.totalFixedSavings = fixedSavingsSnapshot.size;

        fixedSavingsSnapshot.forEach(doc => {
            const data = doc.data();
            if (!data.memberId) {
                report.schemaIssues.push(`FixedSavings ${doc.id}: Missing memberId`);
            } else if (!memberIds.has(data.memberId)) {
                report.orphanedRecords.push(`FixedSavings ${doc.id}: orphaned (memberId ${data.memberId} not found)`);
            }
        });

        return NextResponse.json({
            success: true,
            report,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        logger.error("Integrity check failed:", error);
        return NextResponse.json({
            error: "Internal Server Error",
            details: error instanceof Error ? error.message : String(error)
        }, { status: 500 });
    }
}
