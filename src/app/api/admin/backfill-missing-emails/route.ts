export const dynamic = 'force-dynamic';

/**
 * Admin API Route: fill in the address on profiles that have none — #671.
 *
 *   GET   reports what WOULD be repaired, and writes nothing.
 *   POST  performs the repair.
 *
 * The split is the point. The forensic scan that found these 48 profiles is
 * read-only by design, and a repair the operator can only run blind is a repair
 * they will hesitate to run at all. GET answers "what will this touch" using
 * the same selection the POST uses, so the preview cannot disagree with the
 * action — this audit's two-hand-maintained-copies defect, avoided by having
 * one.
 *
 * The gate is `isPlatformAdmin` — super_admin and admin only, the same gate the
 * forensics action uses, not the ten roles the admin layout admits (#382).
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from "@/lib/session-guard";
import { isPlatformAdmin } from "@/lib/admin-permissions";
import { backfillMissingEmails, profilesWithNoEmail } from '@/lib/missing-email-backfill';
import { logger } from '@/lib/logger';

const LIMIT = 500;

export async function GET(_request: NextRequest) {
    try {
        const session = (await requireSession()).session;
        if (!isPlatformAdmin(session?.user?.roles)) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
        }

        const profiles = await profilesWithNoEmail(LIMIT);

        return NextResponse.json({
            count: profiles.length,
            //   Ids only. The whole point of these rows is that they have no
            //   address to return, and the rest of a profile is not this
            //   endpoint's business.
            profileIds: profiles.map((p) => p.id),
            //   Said out loud, because "500" arriving as "500 profiles have no
            //   email" is the #331 mistake — a bound reported as a total.
            limit: LIMIT,
            complete: profiles.length < LIMIT,
        });
    } catch (error) {
        logger.error('Failed to list profiles with no email address', error);
        return NextResponse.json({ error: 'Failed to list profiles with no email address' }, { status: 500 });
    }
}

export async function POST(_request: NextRequest) {
    try {
        const session = (await requireSession()).session;
        if (!isPlatformAdmin(session?.user?.roles)) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
        }

        const report = await backfillMissingEmails(LIMIT);

        logger.info(
            `[backfill-missing-emails] ${session?.user?.id} ran the repair: `
            + `${report.filled} of ${report.scanned} profile(s) filled.`,
        );

        return NextResponse.json(report);
    } catch (error) {
        logger.error('Failed to backfill missing email addresses', error);
        return NextResponse.json({ error: 'Failed to backfill missing email addresses' }, { status: 500 });
    }
}
