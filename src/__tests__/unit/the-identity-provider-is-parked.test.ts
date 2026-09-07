/**
 * @jest-environment node
 */

/**
 *   #485 "VERIFIED" MEANT "A NUMBER WAS TYPED", AND EVERY SCREEN SAID VERIFIED.
 *
 *   The owner asked for the external identity provider to be commented out and
 *   referenced nowhere. Doing only that would have left the platform in its
 *   worst possible state — because that provider was the one thing that could
 *   ever have made the word "verified" true, and it was already not being
 *   called. Parking it without saying so would have turned a dormant lie into a
 *   permanent one.
 *
 *   SWEPT. Every path in the application that sets a KYC verification flag:
 *
 *     actions/kyc.ts            'kyc.bvnVerified': true, 'kyc.bvnStatus':
 *                               'verified' — written with no check of any kind
 *     api/kyc/verify-bvn        returned { isMatch: true }, called nothing
 *     api/kyc/verify-nin        returned { isMatch: true }, called nothing
 *     api/admin/kyc/verify-…    logged "Bypassing live verification", wrote
 *                               { bypassed: true }, and answered "BVN verified
 *                               successfully" under a button named after the
 *                               provider
 *     cooperative registration  bvnVerified: bvn ? true : false   (×3 sites)
 *     admin/_applications       userUpdate.bvnVerified = val("bvn") ? true : false
 *     admin/_legacy             bvnVerified: !!data.bvn
 *
 *   Seven places, one meaning: THE MEMBER SUPPLIED DIGITS. The admin user list
 *   rendered an emerald "Verified" badge off that flag, and an operator deciding
 *   whether to approve a loan or release a payout read it as a check that had
 *   happened.
 *
 *   AND THE ONE REAL CHECK WAS UNREACHABLE. DynamicDetailModal hid its
 *   confirm-this-identity button behind `!isVerified` — and isVerified was that
 *   same flag, true for everybody. So the only genuine verification the platform
 *   can perform could never be performed, because the screen already claimed it
 *   had been.
 *
 * ── WHAT THIS SUITE HOLDS ────────────────────────────────────────────────────
 *
 *   Two things that must not drift apart:
 *
 *     1. THE PROVIDER STAYS PARKED. Not deleted — the owner's standing rule is
 *        to fix rather than destroy, and the module carries repairs (#184's
 *        resolveMatch allowlist, two webhook-signature fixes) that would have to
 *        be redone. But nothing may import it, and its name may not spread back
 *        through the codebase.
 *
 *     2. THE GATES ARE UNTOUCHED. `bvnVerified` / `ninVerified` keep the exact
 *        values they have today, because export onboarding refuses to continue
 *        without them and updateOverallKYCStatus builds `kyc.status` — and so a
 *        broadcast audience — from them. This is the assertion that makes the
 *        change safe rather than brave, and it is the one most likely to be
 *        "simplified" away by somebody who reads the finding and not the
 *        constraint.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the parked module imported again                 KILLED
 *     the self-declared status written as 'verified'   KILLED
 *     the method dropped from the write                KILLED
 *     the badge reading the flag instead of the method KILLED
 *     the fake-ID gate switched back to opt-in         KILLED
 *     the admin route claiming an automated check      KILLED
 *     the confirm button hidden behind the flag again  KILLED
 *     the stored gate flipped to false                 KILLED
 *     reword this header                               SURVIVED, as intended
 *
 *   The first run of that table reported the control KILLED, which is a broken
 *   harness, not a strong suite. Two of the mutated files were both named
 *   route.ts, so they shared one backup and the restore wrote one over the
 *   other — every result after the fourth mutant was measured against a
 *   corrupted tree. Re-run with per-file backup names and a byte-for-byte
 *   integrity check on every restore. Audit the instrument before believing the
 *   measurement.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

const ROOT = process.cwd();
const src = (rel: string) => readFileSync(join(ROOT, rel), 'utf-8');
const code = (rel: string) => stripComments(src(rel), { label: rel });

/** The parked module. The one file allowed to carry the provider's name. */
const PARKED = 'src/lib/qoreid.ts';

/** Every .ts/.tsx file the application actually runs. */
function runtimeFiles(dir = join(ROOT, 'src'), out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            if (entry === '__tests__') continue;
            runtimeFiles(full, out);
            continue;
        }
        if (!/\.tsx?$/.test(entry)) continue;
        const rel = full.slice(ROOT.length + 1);
        if (rel === PARKED) continue;
        if (rel.includes('__tests__') || rel.endsWith('.test.ts') || rel.endsWith('.test.tsx')) continue;
        out.push(rel);
    }
    return out;
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#485 — the external identity provider is parked', () => {
    it('NOTHING THAT RUNS IMPORTS IT', () => {
        //   THE assertion the owner asked for. An import is the only thing that
        //   can bring it back to life, so that is what is banned — not the
        //   string, which would fail on a comment explaining the parking.
        const importers = runtimeFiles().filter((rel) =>
            /from\s+['"](@\/lib\/qoreid|\.{1,2}\/[\w./-]*qoreid)['"]|require\(\s*['"][^'"]*qoreid/.test(code(rel)),
        );

        expect({ importers }).toEqual({ importers: [] });
    });

    it('AND ITS NAME DOES NOT APPEAR IN CODE OUTSIDE IT', () => {
        //   Comments explaining the decision are fine and necessary. A live
        //   identifier, URL segment, env var or log string is not: an operator
        //   reading a network log must not see a service being named that is not
        //   being called, which is exactly what the admin route did.
        //
        //   `kyc_qoreid_verify` is the one exception, and it is deliberate — see
        //   lib/audit-log.ts. Audit rows already carry that action name and
        //   renaming it would make them unreadable.
        const offenders = runtimeFiles()
            .map((rel) => [rel, code(rel)] as const)
            .filter(([, body]) => /qoreid/i.test(body))
            .filter(([, body]) => !/^[\s\S]*'kyc_qoreid_verify'[\s\S]*$/.test(body) || /qoreid/i.test(body.replace(/'kyc_qoreid_verify'/g, '')))
            .map(([rel]) => rel);

        expect({ offenders }).toEqual({ offenders: [] });
    });

    it('AND THE MODULE ITSELF IS STILL ON DISK, INTACT', () => {
        //   The control, and the owner's standing rule: fix, never destroy.
        //   Every assertion above is satisfied by deleting the file, which would
        //   throw away a repaired integration that has to be rebuilt from
        //   nothing if the provider ever returns.
        const parked = src(PARKED);

        expect(parked.length).toBeGreaterThan(5000);
        expect(parked).toContain('export function resolveMatch');
        expect(parked).toContain('export const qoreIdService');
    });

    it('and the retired webhook refuses rather than accepting into a dead collection', () => {
        const route = code('src/app/api/webhooks/identity-provider/route.ts');

        expect(route).toContain('status: 410');
        //   No database import at all: the receiver's real behaviour was
        //   accumulating unread rows from unauthenticated callers.
        expect(route).not.toContain('supabase-db');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#485 — no route claims a check that no longer exists', () => {
    it('THE BVN AND NIN ROUTES SAY THEY DID NOT CHECK', () => {
        //   They answered `{ isMatch: true }` and nothing else, and the browser
        //   callers write a verification flag off that. `isMatch` stays — the
        //   member's progress is gated on it and onboarding must not stop — but
        //   it no longer travels alone.
        for (const field of ['bvn', 'nin']) {
            const route = code(`src/app/api/kyc/verify-${field}/route.ts`);

            expect({ field, checked: route.includes('checked: false') })
                .toEqual({ field, checked: true });
            expect({ field, method: route.includes("method: 'self_declared'") })
                .toEqual({ field, method: true });
        }
    });

    it('AND THE ADMIN ROUTE RECORDS A HUMAN, NOT A SERVICE', () => {
        //   It logged "Bypassing live verification and marking as verified" and
        //   told the admin the identity was "verified successfully". It is a
        //   manual confirmation — a real and useful act — and it now says so,
        //   with the admin's id attached.
        const route = code('src/app/api/admin/kyc/manual-verify/route.ts');

        expect(route).toContain('manuallyVerifiedFields(field, session.user.id)');
        expect(route).toContain("action: 'kyc_manual_verify'");
        expect(route).toContain('No automated identity check was performed');
        expect(route).not.toContain('bypassed');
    });

    it('and business verification refuses instead of inventing a verdict', () => {
        const route = code('src/app/api/kyc/verify-business/route.ts');

        expect(route).toContain('status: 503');
        expect(route).toContain('checked: false');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#485 — every write says how the flag came to be set', () => {
    /**
     * Seven paths set these flags and not one recorded its provenance. A badge
     * cannot tell the truth about a record that does not carry it.
     */
    const WRITE_SITES: [string, number][] = [
        //   Three: BVN, NIN, and the voter's card — whose status said
        //   'verified' and whose sibling field said 'pending_manual_review', in
        //   the same update.
        ['src/app/actions/kyc.ts', 3],
        ['src/app/actions/cooperative/_coop_registration.ts', 6],
        ['src/app/actions/admin/_applications.ts', 2],
        ['src/app/actions/admin/_legacy.ts', 2],
    ];

    it.each(WRITE_SITES)('%s records a verification method', (rel, expected) => {
        const body = code(rel);
        const found = (body.match(/VerificationMethod/g) ?? []).length;

        expect({ rel, found }).toEqual({ rel, found: expected });
    });

    it('AND THE SELF-DECLARED PATHS DO NOT WRITE THE WORD "verified"', () => {
        //   actions/kyc.ts wrote 'kyc.bvnStatus': 'verified' with no check above
        //   it. That string is what an operator reads.
        const kyc = code('src/app/actions/kyc.ts');

        expect(kyc).toContain("'kyc.bvnStatus': 'self_declared'");
        expect(kyc).toContain("'kyc.ninStatus': 'self_declared'");
        expect(kyc).not.toContain("'kyc.bvnStatus': 'verified'");
        expect(kyc).not.toContain("'kyc.ninStatus': 'verified'");
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#485 — and the gates keep the value they have today', () => {
    /**
     * THE ASSERTION THAT MAKES THIS SAFE RATHER THAN BRAVE.
     *
     * Flipping the booleans was the tempting fix. Export onboarding refuses to
     * continue while `kycData.bvn` is set and `kycData.bvnVerified` is not, and
     * updateOverallKYCStatus builds `kyc.status` from them — which broadcast
     * targeting reads to assemble the "verified users" audience. A change here
     * stops onboarding for every new member and silently empties a segment.
     */
    it('THE STORED BOOLEAN IS STILL SET BY EVERY PATH THAT SET IT BEFORE', () => {
        expect(code('src/app/actions/kyc.ts')).toContain("'kyc.bvnVerified': true");
        expect(code('src/app/actions/kyc.ts')).toContain("'kyc.ninVerified': true");
        expect(code('src/app/actions/cooperative/_coop_registration.ts'))
            .toContain('bvnVerified: bvn ? true : false');
        expect(code('src/app/actions/admin/_legacy.ts')).toContain('bvnVerified: !!data.bvn');
    });

    it('AND THE GATE THAT DEPENDS ON IT IS STILL THERE TO DEPEND ON IT', () => {
        //   Control: if the export step's check were removed, the assertion
        //   above would still pass and the reason for it would be gone.
        const step = code('src/app/export/onboarding/steps/KYCVerificationStep.tsx');

        expect(step).toMatch(/kycData\.bvn[\s\S]{0,120}!kycData\.bvnVerified/);
    });

    it('and the overall KYC status still reads the booleans, not the strings', () => {
        const kyc = code('src/app/actions/kyc.ts');

        expect(kyc).toContain('kyc.bvnVerified === true');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#485 — the screens tell the difference', () => {
    it('THE ADMIN LIST BADGE READS THE METHOD, NOT THE FLAG', () => {
        //   It read `user.bvnVerified` and painted emerald "Verified" for the
        //   entire user base.
        const columns = code('src/app/admin/users/_columns.tsx');

        expect(columns).toContain('identityBadge(provided, { verified, method })');
        expect(columns).not.toMatch(/user\.bvnVerified \? 'bg-emerald/);
    });

    it('AND THE CONFIRM BUTTON IS REACHABLE FOR A SELF-DECLARED IDENTITY', () => {
        //   The defect that made the one real check impossible to perform: the
        //   button was hidden behind `!isVerified`, and isVerified was true for
        //   everybody.
        const modal = code('src/components/admin/DynamicDetailModal.tsx');

        expect(modal).toContain('const isVerified = isProvided && method === "manual_admin_review"');
        expect(modal).toContain('Self-declared');
    });

    it('and one function decides what a badge says, so two screens cannot disagree', () => {
        const lib = code('src/lib/identity-verification.ts');

        expect(lib).toContain('export function identityBadge');
        expect(lib).toContain("tone: 'checked'");
        //   An absent method is self_declared. Every row written before today
        //   has no method, and every one of them was written by a path that
        //   checked nothing.
        expect(lib).toContain("record?.method === 'manual_admin_review' ? 'manual_admin_review' : 'self_declared'");
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#485 — the last remaining check is not optional', () => {
    it('THE FAKE-ID GATE IS ON UNLESS EXPLICITLY TURNED OFF', () => {
        //   It was `=== 'true'` — off unless switched on — because the owner
        //   needed placeholder numbers while the provider was out. With the
        //   provider parked for good this pattern test is the ONLY check any
        //   identity number receives, and an only check must not be opt-in.
        const validators = code('src/lib/kyc-validators.ts');

        expect(validators).toContain("process.env.KYC_REJECT_FAKE_IDS !== 'false'");
    });

    it('AND IT ACTUALLY REJECTS THE PATTERNS IT NAMES', () => {
        //   #357: this function was `return false`, under a header listing four
        //   families it "blocked". The gate being on means nothing if the check
        //   behind it is inert again.
        const previous = process.env.KYC_REJECT_FAKE_IDS;
        delete process.env.KYC_REJECT_FAKE_IDS;
        try {
             
            const { isObviouslyFakeId } = require('@/lib/kyc-validators');

            for (const fake of ['11111111111', '12345678901', '12121212121', '98765432109']) {
                expect({ fake, rejected: isObviouslyFakeId(fake) }).toEqual({ fake, rejected: true });
            }
            //   And a plausible number is NOT rejected. Without this the gate
            //   could be satisfied by a function that refuses everything, which
            //   would stop enrolment entirely.
            expect(isObviouslyFakeId('22193847561')).toBe(false);
        } finally {
            if (previous === undefined) delete process.env.KYC_REJECT_FAKE_IDS;
            else process.env.KYC_REJECT_FAKE_IDS = previous;
        }
    });
});
