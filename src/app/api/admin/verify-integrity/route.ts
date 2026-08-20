export const dynamic = 'force-dynamic';

import { NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { getAdminDb } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { requireSession } from "@/lib/session-guard";
import { isAdmin } from "@/lib/admin-permissions";

/**
 * The cooperative data integrity report.
 *
 * This is the tool an owner runs to answer "is my data all right?", and it was
 * wrong in four independent ways at once — which matters more than any one of
 * them, because a checker that cries wolf is a checker nobody reads.
 *
 *   1. THE MEMBER INDEX WAS NEVER BUILT. `memberIds` was declared, the members
 *      loop never added anything to it, and the two foreign-key checks below
 *      then asked `!memberIds.has(...)` against a permanently empty Set. Every
 *      loan and every savings plan on the platform was reported ORPHANED.
 *
 *   2. IT READ A COLLECTION NOTHING WRITES. Fixed savings moved to
 *      FIXED_SAVINGS_PLANS — _coop_money.ts records the move in a comment, and
 *      create-fixed-savings/route.ts writes there. COOPERATIVE_FIXED_SAVINGS has
 *      no writer anywhere in the codebase, so totalFixedSavings was always 0 and
 *      no savings plan was ever actually checked.
 *
 *   3. THE THREE SWEEPS WERE SILENTLY CAPPED. A bare .get() on an unbounded
 *      query stops at DEFAULT_QUERY_LIMIT (5,000) and the snapshot looks
 *      identical to a complete one. A full-collection audit is exactly the case
 *      .all() exists for; without it the report would one day say "no problems"
 *      because it stopped reading. The counts are stated as what they are, and
 *      truncation is reported rather than hidden.
 *
 *   4. THE KEY IT COMPARED WAS THE WRONG SHAPE. cooperative_members documents
 *      are keyed by USER id (.doc(userId) at every creation site), and one path
 *      keys by a separate membershipId with the userId in a field. Loans and
 *      savings plans both store the borrower as `memberId` holding a USER id.
 *      So the index has to hold both the document id and the userId, or a
 *      membership created through the membershipId path orphans everything
 *      belonging to it.
 */
export async function GET() {
    try {
        const session = (await requireSession()).session;
        if (!session?.user) {
            return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
        }
        // A READ, and every admin role holds "users:read", so isAdmin is the
        // right gate. What it discloses is aggregate integrity, not personal
        // data.
        if (!isAdmin(session.user.roles)) {
            logger.warn(`Unauthorized integrity check attempt by user: ${session?.user?.id}`);
            return NextResponse.json({ success: false, error: "Forbidden: Admin access required" }, { status: 403 });
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
            },
            // A truncated audit that reports "no problems" is worse than no
            // audit, so the caller is told when one happened.
            truncated: [] as string[],
        };

        // 1. Every member. .all() — this is a genuine full-collection audit, not
        //    a page of results.
        const membersSnapshot = await adminDb.collection(COLLECTIONS.COOPERATIVE_MEMBERS).all().get();
        if (membersSnapshot.truncated) report.truncated.push("cooperative_members");

        /**
         * Both keys a loan or a plan could name: the document id and the userId
         * field. See note 4 above.
         */
        const memberIds = new Set<string>();

        report.stats.totalMembers = membersSnapshot.size;

        membersSnapshot.forEach(doc => {
            const data = doc.data();

            // THE line that was missing. Without it every check below fails for
            // every record.
            memberIds.add(doc.id);
            if (data.userId) memberIds.add(String(data.userId));

            // Schema Checks: accept either new schema (firstName+lastName) or legacy schema (fullName)
            const hasNameData = (data.firstName && data.lastName) || data.fullName;
            if (!hasNameData || !data.email) {
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

        // 2. Every loan (foreign-key check).
        const loansSnapshot = await adminDb.collection(COLLECTIONS.COOPERATIVE_LOANS).all().get();
        if (loansSnapshot.truncated) report.truncated.push("cooperative_loans");
        report.stats.totalLoans = loansSnapshot.size;

        loansSnapshot.forEach(doc => {
            const data = doc.data();
            // cooperative_loans keys the borrower as `memberId`; the merged
            // reader in _loans_applications.ts normalises it to `userId`, and
            // rows filed through that path carry the latter. Accept either
            // rather than reporting a row orphaned for using the other name.
            const owner = data.memberId ?? data.userId;
            if (!owner) {
                report.schemaIssues.push(`Loan ${doc.id}: Missing memberId`);
            } else if (!memberIds.has(String(owner))) {
                report.orphanedRecords.push(`Loan ${doc.id}: orphaned (memberId ${owner} not found)`);
            }
        });

        // 3. Every fixed savings plan (foreign-key check) — from the collection
        //    that is actually written. See note 2 above.
        const fixedSavingsSnapshot = await adminDb.collection(COLLECTIONS.FIXED_SAVINGS_PLANS).all().get();
        if (fixedSavingsSnapshot.truncated) report.truncated.push("fixed_savings_plans");
        report.stats.totalFixedSavings = fixedSavingsSnapshot.size;

        fixedSavingsSnapshot.forEach(doc => {
            const data = doc.data();
            const owner = data.memberId ?? data.userId;
            if (!owner) {
                report.schemaIssues.push(`FixedSavings ${doc.id}: Missing memberId`);
            } else if (!memberIds.has(String(owner))) {
                report.orphanedRecords.push(`FixedSavings ${doc.id}: orphaned (memberId ${owner} not found)`);
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
