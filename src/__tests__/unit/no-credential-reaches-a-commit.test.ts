/**
 * @jest-environment node
 */

/**
 *   #662 THE LEAKED KEY CANNOT BE UNLEAKED. THE NEXT ONE CAN BE STOPPED.
 *
 *   A Paystack `sk_live_` key is in this repository's history — added in
 *   `c767ff8e`, removed in `a57f5e95`. Removing it from the working tree did not
 *   remove it from the history, and it is still recoverable by anyone who can
 *   clone. Rotation is the only remedy for THAT key and it is the owner's to do;
 *   nothing in this repository can undo it.
 *
 *   What this repository can do is make the next one impossible to commit, and
 *   it did not. CI scans the full history with gitleaks and `fetch-depth: 0` —
 *   which is right, and runs AFTER THE PUSH. By then the secret is on a remote
 *   and the only remedy is rotation again. The pre-commit hook ran eslint and
 *   tsc and looked at nothing else.
 *
 * ── WHY A NARROW CHECK AND NOT A SECOND GITLEAKS ────────────────────────────
 *
 *   gitleaks carries hundreds of rules and an entropy model, and re-running it
 *   on every commit would be slow enough to be switched off. This is a short
 *   list of PROVIDER-ASSIGNED PREFIXES — `sk_live_`, `AKIA`, a PRIVATE KEY
 *   block, a JWT whose decoded payload says `role: service_role` — where a match
 *   is not a guess.
 *
 *   Deliberately NOT matched: anything containing the words password, secret or
 *   token. This codebase is full of those in variable names, comments and test
 *   fixtures, and a check that fires on correct code is a check that gets
 *   disabled — which is the same reasoning lib/firestore-serialize's
 *   `minRetainedRatio` records, and #658's whole finding.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

const guard = async () => await import('../../../scripts/no-credentials-in-staged.mjs' as string);

/**
 * Samples that are the SHAPE of a credential and are not credentials.
 *
 * Every one is invented here, character by character, and none of them has ever
 * been valid anywhere. A test for a secret-scanner that used a real secret
 * would be the defect it exists to prevent.
 */
const FAKE = {
    paystackLive: 'sk_live_' + 'a'.repeat(24),
    paystackTest: 'sk_test_' + 'b'.repeat(24),
    aws: 'AKIA' + 'C'.repeat(16),
    google: 'AIza' + 'd'.repeat(35),
    privateKey: '-----BEGIN RSA PRIVATE KEY-----',
};

/** A JWT whose payload decodes to the role Supabase stamps on a service key. */
function fakeJwt(role: string): string {
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o), 'utf8').toString('base64url');
    return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ role, iss: 'supabase' })}.${'s'.repeat(43)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#662 — it finds the shapes this platform actually holds', () => {
    it.each(Object.entries(FAKE))('CATCHES %s', async (_name, sample) => {
        const { findCredentials } = await guard();
        expect(findCredentials(`const k = "${sample}";`)).toHaveLength(1);
    });

    it('AND A SUPABASE SERVICE-ROLE KEY, BY ITS DECODED CLAIM', async () => {
        /*
         *   Matched on the payload rather than on "looks like a JWT". A JWT in a
         *   fixture is ordinary; one that says `role: service_role` is the key
         *   that bypasses row-level security on every table.
         */
        const { findCredentials } = await guard();
        expect(findCredentials(`SUPABASE_SERVICE_ROLE_KEY=${fakeJwt('service_role')}`)).toHaveLength(1);
    });

    it('AND REPORTS WHICH LINE, SO THE MESSAGE CAN BE ACTED ON', async () => {
        const { findCredentials } = await guard();
        const text = ['const a = 1;', 'const b = 2;', `const k = "${FAKE.paystackLive}";`].join('\n');

        expect(findCredentials(text, 'src/thing.ts')).toEqual([
            { rule: 'Paystack live secret key', file: 'src/thing.ts', line: 3 },
        ]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#662 — and it does not fire on correct code', () => {
    /*
     *   THE CONTROLS, and they matter more than the cases above. A scanner that
     *   refuses ordinary commits is a scanner somebody passes --no-verify to,
     *   and then it guards nothing at all. Every sample here is real text from
     *   this repository or the obvious shape of it.
     */
    it.each([
        ['a variable NAME', 'const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;'],
        ['a placeholder', 'NEXTAUTH_SECRET: placeholder-ci-secret-placeholder-ci-secret'],
        ['prose about a key', '// Rotate the Paystack sk_live key — it is in the history.'],
        ['a bearer header', 'Authorization: Bearer ${cronSecret}'],
        ['a test password', "await page.fill('input[name=password]', 'e2e-Password-123');"],
        ['an anon JWT', `NEXT_PUBLIC_SUPABASE_ANON_KEY=${fakeJwt('anon')}`],
        ['an authenticated JWT', `token=${fakeJwt('authenticated')}`],
        ['a short sk- word', 'const sk = "sk-1";'],
        ['a hex digest', `const hash = "${'a'.repeat(64)}";`],
    ])('IGNORES %s', async (_what, sample) => {
        const { findCredentials } = await guard();
        expect(findCredentials(sample)).toEqual([]);
    });

    it('AND IGNORES THE ENV EXAMPLE FILE AND ITS OWN SOURCE', () => {
        /*
         *   .env.example exists to show the shape of a value, and this scanner
         *   and its test necessarily contain every pattern they look for. Left
         *   as a source assertion because the skip list is applied by the hook's
         *   file walk, which needs a git index to exercise.
         */
        const src = read('scripts/no-credentials-in-staged.mjs');
        expect(src).toContain('^\\.env\\.example$');
        expect(src).toContain('no-credentials-in-staged\\.mjs$');
        expect(src).toContain('no-credential-reaches-a-commit\\.test\\.ts$');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#662 — and it is wired to something that runs', () => {
    it('THE PRE-COMMIT HOOK CALLS IT, AND STOPS WHEN IT FAILS', () => {
        /*
         *   A scanner nothing invokes is the shape this audit has spent more
         *   findings on than any other. `|| exit 1` because a hook that runs a
         *   check and ignores its status is the same thing with extra steps.
         */
        const hook = read('.husky/pre-commit');
        expect(hook).toContain('node scripts/no-credentials-in-staged.mjs || exit 1');
        //   Before lint-staged: the cheap refusal comes first.
        expect(hook.indexOf('no-credentials-in-staged'))
            .toBeLessThan(hook.indexOf('npx lint-staged'));
    });

    it('AND CI STILL SCANS THE WHOLE HISTORY, WHICH THIS DOES NOT REPLACE', () => {
        /*
         *   The other half. This hook sees only what is STAGED, so it says
         *   nothing about the key already in the history — and a repository that
         *   swapped a full-history scan for a staged-file check would have
         *   traded the stronger instrument for the faster one.
         */
        const ci = read('.github/workflows/ci.yml');
        expect(ci).toContain('gitleaks/gitleaks-action@');
        expect(ci).toContain('fetch-depth: 0');
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored and diffed after each.
 *
 *     MUTANT                                                        RESULT
 *     THE DEFECT: the live-key rule is removed                        KILLED
 *     the service-role rule stops decoding the payload                KILLED
 *     the rule list starts matching the word "secret"                 KILLED
 *     the scanner reports the file but not the line                   KILLED
 *     the hook calls it and ignores the exit status                   KILLED
 *     the hook runs it after lint-staged                              KILLED
 *     CI's history scan is dropped now that a hook exists             KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                              SURVIVED ✓
 *
 * ── WHAT IS NOT CLAIMED ─────────────────────────────────────────────────────
 *
 *   This does nothing about the key already in `c767ff8e`. Nothing in a
 *   repository can: a value that has been pushed is a value that has to be
 *   rotated. It is recorded on the owner-side list for that reason and stays
 *   there until it is rotated.
 */
