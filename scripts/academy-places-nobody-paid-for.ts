/**
 *   #975 WHO LOSES ACADEMY WHEN A GRANT STOPS OPENING IT.
 *
 *   Run (read-only, always):   npm run academy:granted
 *
 *   THIS SCRIPT NEVER WRITES. There is no --apply, on purpose. Every row it
 *   reports is a person who can open the Academy today and will not be able to
 *   after #975 deploys, and which of them should be let back in is a judgement
 *   about specific learners — a fee waived for a scholarship is not the same as
 *   a misclick. The banner still prints the target host, because an operator
 *   reading a report about live access needs to know which database produced it.
 *
 * ── WHY IT EXISTS ───────────────────────────────────────────────────────────
 *
 *   THE OWNER: "paid enrolment or legacy members (admin can't grant access
 *   until user pays)."
 *
 *   #975 removes the waiver: `isAcademyPaid` decides access, and a grant is no
 *   longer payment. Nobody knew how many live accounts that affects — nothing
 *   counted them — so this counts them BEFORE the change is merged rather than
 *   after somebody notices they are locked out.
 *
 * ── THE THREE POPULATIONS, AND THEY ARE NOT THE SAME ────────────────────────
 *
 *   GRANTED     `paymentStatus: "waived"`, written by the two admin doors after
 *               6322fd99. A deliberate, recorded decision by a named admin.
 *               THESE LOSE ACCESS.
 *
 *   UNVERIFIED  `paymentStatus: "completed"` with no `paymentVerifiedBy` and no
 *               row in processed_payments — the six the earlier sweep found and
 *               deliberately did not migrate, because relabelling a live
 *               entitlement on an inference about what an admin meant months ago
 *               is not a change to make unattended. THESE KEEP ACCESS, because
 *               "completed" is still a paid status. They are reported anyway:
 *               the rule the owner just stated is about them too, and leaving
 *               them out would make this report quietly flattering.
 *
 *   LEGACY      `_isLegacy` / `legacyOnboardedBy`. Pre-platform members, named
 *               by the owner's rule as keeping their place. UNAFFECTED, counted
 *               here only so the other two numbers can be read against it.
 */

import { createClient } from '@supabase/supabase-js';
import { existsSync } from 'fs';
import { config as loadEnv } from 'dotenv';
import { modeBanner, targetHost } from './_maintenance-guard';
import { ACADEMY_GRANTED_STATUSES, ACADEMY_PAID_STATUSES } from '../src/lib/academy-entitlement';

if (existsSync('.env.development.local')) loadEnv({ path: '.env.development.local' });
loadEnv({ path: '.env.local' });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function fail(msg: string): never {
    console.error(`\n❌ ${msg}\n`);
    process.exit(1);
}

if (!url || !serviceKey) {
    fail('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set.');
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

type Row = { id: string; raw_data: Record<string, any> };

const academyOf = (r: Row) => r.raw_data?.serviceRegistrations?.academy ?? {};
const lower = (v: unknown) => String(v ?? '').trim().toLowerCase();

async function main(): Promise<void> {
    console.log(modeBanner('Academy places nobody paid for', false, targetHost()));

    //   Every user with an Academy registration. Paged, because the platform's
    //   user table is the biggest one here and a single select would truncate.
    const rows: Row[] = [];
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
        const { data, error } = await admin
            .from('users')
            .select('id, raw_data')
            .range(from, from + PAGE - 1);
        if (error) fail(`Reading users failed: ${error.message}`);
        if (!data || data.length === 0) break;
        rows.push(...(data as Row[]));
        if (data.length < PAGE) break;
    }

    const withAcademy = rows.filter((r) => Object.keys(academyOf(r)).length > 0);

    const granted: Row[] = [];
    const unverified: Row[] = [];
    const legacy: Row[] = [];

    for (const r of withAcademy) {
        const a = academyOf(r);
        const status = lower(a.paymentStatus);
        const isLegacy = Boolean(r.raw_data?._isLegacy || r.raw_data?.legacyOnboardedBy || a._isLegacy);

        if (isLegacy) { legacy.push(r); continue; }
        if ((ACADEMY_GRANTED_STATUSES as readonly string[]).includes(status)) { granted.push(r); continue; }
        if ((ACADEMY_PAID_STATUSES as readonly string[]).includes(status) && !a.paymentVerifiedBy) {
            unverified.push(r);
        }
    }

    console.log(`Users with an Academy registration: ${withAcademy.length}`);
    console.log('');
    console.log(`GRANTED — lose access when #975 deploys:  ${granted.length}`);
    for (const r of granted) {
        const a = academyOf(r);
        console.log(`   ${r.id}  ${r.raw_data?.email ?? '(no email)'}`);
        console.log(`      plan=${a.plan ?? '(none)'}  grantedBy=${a.grantedBy ?? '(unrecorded)'}  `
            + `grantedAt=${a.grantedAt ?? '(unrecorded)'}  source=${a.entitlementSource ?? '(none)'}`);
    }

    console.log('');
    console.log(`UNVERIFIED "completed" — KEEP access, reported for the same rule: ${unverified.length}`);
    for (const r of unverified) {
        console.log(`   ${r.id}  ${r.raw_data?.email ?? '(no email)'}  `
            + `status=${academyOf(r).paymentStatus}  paymentVerifiedBy=(none)`);
    }

    console.log('');
    console.log(`LEGACY — unaffected by the rule:          ${legacy.length}`);
    console.log('');
    console.log('Nothing was written. This script has no --apply.');
    if (granted.length > 0) {
        console.log('');
        console.log(`⚠️  ${granted.length} learner(s) can open the Academy today and will not be able`);
        console.log('   to after this merges. Decide each one before merging: take the fee, or');
        console.log('   record a payment through the door that verifies one.');
    }
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
