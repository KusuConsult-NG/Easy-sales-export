export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";

import { refuseUnauthorisedCron } from "@/lib/cron-auth";
import { auditMigrations, reportMigrationAudit } from "@/lib/migration-audit";

/**
 * Daily: does the database have the schema this build was written against?
 *
 *   THE OWNER: "add the migration check."
 *
 *   Nothing applies these migrations to production — see lib/migration-manifest
 *   for the day that cost, and 048's and 027's headers for the two times before
 *   it. This is the tenth cron job, and it exists for the same reason the ninth
 *   did: #702's "a repair that only ran when somebody remembered to press it".
 *   A condition nobody is told about is a condition nobody fixes.
 *
 * ── IT FAILS THE JOB WHEN THE DATABASE IS BEHIND, DELIBERATELY ──────────────
 *
 *   #702's route answers 200 when it finds a condition no run can change, on
 *   the explicit grounds that "answering 500 would make the scheduler shout
 *   about a condition no run can change, which is how a job stops being read."
 *
 *   THIS IS THE OTHER CASE, and the distinction is the whole design. A profile
 *   whose address Supabase Auth does not hold either is not fixable by anyone;
 *   a missing index is fixable by one person in about twenty seconds, and the
 *   response says which file to paste. So it answers 503 and the scheduled run
 *   goes red, which is how it reaches somebody. It clears itself the moment the
 *   migration is applied.
 *
 *   `cannot-tell` fails too. A check that could not look must never read as a
 *   clean bill — see lib/migration-audit.
 */
export async function GET(request: NextRequest) {
    const refusal = refuseUnauthorisedCron(request, "migration-audit");
    if (refusal) return refusal;

    const audit = await auditMigrations();
    reportMigrationAudit(audit, "cron/migration-audit");

    return NextResponse.json(
        {
            success: audit.verdict === "in-sync",
            verdict: audit.verdict,
            expected: audit.expected,
            missingCount: audit.missing.length,
            missing: audit.missing,
            applyThese: audit.applyThese,
            detail: audit.detail,
            ...(audit.cause ? { cause: audit.cause } : {}),
        },
        { status: audit.verdict === "in-sync" ? 200 : 503 },
    );
}
