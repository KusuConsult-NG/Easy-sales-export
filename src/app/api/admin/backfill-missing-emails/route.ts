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
import { backfillMissingEmails, describeProfilesWithNoEmail } from '@/lib/missing-email-backfill';
import { logger } from '@/lib/logger';

const LIMIT = 500;

export async function GET(_request: NextRequest) {
    try {
        const session = (await requireSession()).session;
        if (!isPlatformAdmin(session?.user?.roles)) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
        }

        const profiles = await describeProfilesWithNoEmail(LIMIT);

        /*
         *   #718 — THIS RETURNED BARE IDS, AND SAID WHY:
         *
         *       "Ids only. The whole point of these rows is that they have no
         *        address to return, and the rest of a profile is not this
         *        endpoint's business."
         *
         *   That was written while #671's premise held — the address is in
         *   Supabase Auth against the same id, so the repair would fill it in
         *   unattended and ids were all anyone needed.
         *
         *   THE FIRST REAL RUN DISPROVED THE PREMISE. 47 of the 48 came back
         *   `no-auth-account` from a lookup that reached Auth, and the 48th is
         *   a Firebase-era uid Supabase will not accept as a parameter. There
         *   is no account to copy an address from, so a PERSON has to identify
         *   these people — and 48 opaque UUIDs give them nothing to do it with.
         *
         *   Name, masked phone, roles and creation date come off the row that
         *   was read anyway. Not the NIN, BVN, address or bank details those
         *   rows also carry: this is a screen for working out who somebody is,
         *   not for exporting their identity documents (#490).
         */
        const unreachable = profiles.filter((p) => p.authAccount === 'no-account').length;
        const unknown = profiles.filter((p) => p.authAccount === 'could-not-tell').length;

        return NextResponse.json({
            count: profiles.length,
            //   The three groups, counted, because they need three different
            //   responses and a single total hides that.
            repairable: profiles.length - unreachable - unknown,
            cannotSignIn: unreachable,
            couldNotTell: unknown,
            profiles,
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
