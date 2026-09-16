/**
 * @jest-environment node
 */

/**
 *   #828 A DEPLOY THAT SUCCEEDED, REPORTED AS A FAILURE — AND A LOSS THAT WAS
 *        REPORTED AS A FEATURE.
 *
 *   The owner pasted a real startup log:
 *
 *       ❌ Environment validation failed!
 *          1 that break one feature each, but still serve: KYC_ENCRYPTION_KEY
 *
 *   TWO THINGS ARE WRONG WITH THOSE TWO LINES.
 *
 *   THE FIRST is that nothing fatal was missing. The container started, served,
 *   and answered every request — and the headline told its operator the deploy
 *   had failed. #457's note sits directly above the code that prints it and
 *   describes exactly this harm; #457 split the BODY into two tiers and left
 *   the HEADLINE undifferentiated. A correct rule applied to some of the places
 *   it names, which is the shape this audit has found more often than any
 *   other. A red ❌ on a working deploy is also how a red ❌ stops being read.
 *
 *   THE SECOND is the tier. "break one feature each, but still serve" is true
 *   of every other name on that list: no email goes out until RESEND_API_KEY is
 *   set, and then email goes out. Uploads fail until the Cloudinary keys are
 *   set, and then uploads work. Each is a switch.
 *
 *   THIS ONE IS NOT A SWITCH. Verified against the write path in
 *   lib/kyc-identity-store: with no key, NO ciphertext is written at all — only
 *   the SHA-256 digest the duplicate check needs. The submission succeeds, the
 *   applicant is told nothing, and her NIN and BVN are unreadable by anyone,
 *   permanently. Setting the key repairs the next application and cannot
 *   recover a single earlier one. The cost is not a feature that is off; it is
 *   a quantity of permanently unreviewable KYC records that GROWS EVERY DAY the
 *   key stays unset.
 *
 *   #771 already established this reasoning for MFA_SECRET_KEY — "'One feature'
 *   is the wrong tier for that" — and applied it to that key only.
 *
 *   AND THE QUESTION IT LEAVES. The owner has since set the key, which stops
 *   the accrual and repairs nothing. So the only question left is HOW MANY, AND
 *   WHOSE — and nothing could answer it. The reviewer's screen says "Stored,
 *   but KYC_ENCRYPTION_KEY is not configured" one applicant at a time, and a
 *   number you can only learn by opening rows one by one is a number nobody
 *   learns. The forensic scan counts them now, and lists them, because those
 *   applicants would have to supply their numbers again for a reviewer to ever
 *   see one.
 *
 * ── MUTATION LOG ────────────────────────────────────────────────────────────
 *
 *     the headline printed unconditionally again                    KILLED
 *     the "container is starting" line removed                      KILLED
 *     the permanent-loss notice removed                             KILLED
 *     the counter treating a blank number as a casualty             KILLED
 *     the counter ignoring bvn and counting only nin                KILLED
 *     the verdict softened from "fail" to "warning"                 KILLED
 *     affectedIds emptied, the count kept                           KILLED
 *     reword this header                               SURVIVED, intended
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

jest.mock('resend', () => ({
    Resend: class { emails = { send: async () => ({ data: { id: 'e1' }, error: null }) }; },
}));
jest.mock('@/lib/redis', () => ({
    getCached: async () => null, setCache: async () => undefined,
    deleteCache: async () => undefined, redis: null,
}));

// ─────────────────────────────────────────────────────────────────────────────
describe('#828 — the startup log distinguishes a broken deploy from a working one', () => {
    /** Every variable the validator can ask for, so nothing else is missing. */
    const FULL: Record<string, string> = {
        NODE_ENV: 'production',
        NEXTAUTH_URL: 'https://x.example', NEXTAUTH_SECRET: 's'.repeat(40),
        NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'a'.repeat(40),
        NEXT_PUBLIC_URL: 'https://x.example', RESEND_API_KEY: 're_' + 'x'.repeat(30),
        PAYSTACK_SECRET_KEY: 'sk_test_' + 'x'.repeat(30), MFA_SECRET_KEY: 'm'.repeat(64),
        QR_ENCRYPTION_KEY: 'q'.repeat(64), KYC_ENCRYPTION_KEY: 'k'.repeat(64),
        //   #836 — otherwise this fixture's "everything configured" baseline
        //   reports a variable this suite is not about.
        NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: 'c2VydmVyLWFjdGlvbnMta2V5LTMyLWJ5dGVzISE=',
        SUPABASE_SERVICE_ROLE_KEY: 'srv' + 'x'.repeat(40),
        NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME: 'cloud', CLOUDINARY_API_KEY: '1234567890',
        CLOUDINARY_API_SECRET: 'c'.repeat(30),
    };

    /** Boot with `absent` unset, and return everything the log printed. */
    async function boot(absent: string[]): Promise<string> {
        const saved = { ...process.env };
        for (const k of Object.keys(FULL)) delete (process.env as any)[k];
        Object.assign(process.env, FULL);
        for (const k of absent) delete (process.env as any)[k];

        const lines: string[] = [];
        const take = (...a: unknown[]) => { lines.push(a.join(' ')); };
        const e = jest.spyOn(console, 'error').mockImplementation(take as never);
        const l = jest.spyOn(console, 'log').mockImplementation(take as never);
        const w = jest.spyOn(console, 'warn').mockImplementation(take as never);
        try {
            jest.resetModules();
            (await import('@/lib/env-validator')).logEnvValidation();
        } finally {
            e.mockRestore(); l.mockRestore(); w.mockRestore();
            process.env = saved as NodeJS.ProcessEnv;
        }
        return lines.join('\n');
    }

    it('THE OWNER\'S EXACT CASE NO LONGER SAYS THE DEPLOY FAILED', async () => {
        //   One degrading variable missing, nothing fatal. This is the log that
        //   was pasted, reproduced byte for byte before the fix.
        const out = await boot(['KYC_ENCRYPTION_KEY']);

        expect(out).not.toContain('Environment validation failed');
        expect(out).not.toContain('REFUSING TO START');
        //   And it says the thing the operator needed to know.
        expect(out).toContain('THE CONTAINER IS STARTING NORMALLY');
    });

    it('AND IT STILL SAYS WHAT IS MISSING AND WHAT THAT COSTS', async () => {
        //   Quieting the headline must not quiet the finding: the variable is
        //   genuinely unset and the operator still has to act on it.
        const out = await boot(['KYC_ENCRYPTION_KEY']);
        expect(out).toContain('KYC_ENCRYPTION_KEY');
        expect(out).toContain('cannot be undone later');
    });

    it('AND THE PERMANENT LOSS IS SAID WHERE IT CANNOT BE SCROLLED PAST', async () => {
        /*
         *   The tier — "break one feature each, but still serve" — files this
         *   beside QR codes and email. Those come back when the key is set.
         *   This does not.
         */
        const out = await boot(['KYC_ENCRYPTION_KEY']);
        expect(out).toMatch(/PERMANENT AND ONGOING/);
        expect(out).toMatch(/repairs the NEXT application and none of the previous/i);
    });

    it('CONTROL: A GENUINELY BROKEN DEPLOY STILL SAYS SO, LOUDLY', async () => {
        /*
         *   THE control that makes the rest of this describe mean anything. If
         *   quieting the headline had quieted it for a fatal variable too, the
         *   fix would have restored exactly the #450 defect it sits on top of:
         *   a container that reports success and dies on every request.
         */
        const out = await boot(['NEXTAUTH_SECRET']);
        expect(out).toContain('Environment validation failed');
        expect(out).toContain('STOP THE CONTAINER STARTING');
        expect(out).toContain('REFUSING TO START');
        expect(out).not.toContain('THE CONTAINER IS STARTING NORMALLY');
    });

    it('CONTROL: A FULLY CONFIGURED BOOT PRINTS NEITHER BANNER', async () => {
        //   Or every assertion above would pass against a validator that had
        //   simply stopped reporting.
        const out = await boot([]);
        expect(out).not.toContain('Environment validation failed');
        expect(out).not.toContain('THE CONTAINER IS STARTING NORMALLY');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#828 — and the scan counts what can never be read back', () => {
    let store: FakeDbHandle;

    beforeEach(() => {
        jest.clearAllMocks();
        store = installFakeDb();
        (globalThis as {
            mockRequireSession: { mockImplementation: (f: () => unknown) => void };
        }).mockRequireSession.mockImplementation(() => Promise.resolve({
            session: { user: { id: 'admin-1', roles: ['super_admin'], email: 'a@e.com', name: 'a' } },
            error: null,
        }));
        store.seed(COLLECTIONS.USERS, 'admin-1', { roles: ['super_admin'], email: 'a@e.com' });
    });

    /** The check this finding adds, out of the whole scan. */
    async function kycCheck() {
        const mod = await import('@/app/actions/forensics');
        const res = (await mod.runForensicScanAction()) as any;
        const all = (res.results ?? res.data ?? []) as any[];
        return all.find((r) => String(r.check).includes('#828'));
    }

    const app = (id: string, fields: Record<string, unknown>) =>
        store.seed(COLLECTIONS.WAVE_APPLICATIONS, id, {
            userId: `u-${id}`, status: 'pending',
            applicationDate: '2026-03-01T00:00:00.000Z',
            createdAt: '2026-03-01T00:00:00.000Z',
            ...fields,
        });

    it('COUNTS A ROW WHOSE NUMBER WAS HASHED WITH NO KEY CONFIGURED', async () => {
        //   The hash is written always; the ciphertext only when a key existed.
        //   A hash with no ciphertext is a number nobody can ever read.
        app('lost-1', { nin: 'sha256-of-her-nin', bvn: 'sha256-of-her-bvn' });

        const check = await kycCheck();
        expect(check).toBeDefined();
        expect(check.status).toBe('fail');
        expect(check.affectedIds).toEqual(['lost-1']);
        expect(check.details).toContain('1 NIN');
        expect(check.details).toContain('1 BVN');
    });

    it('AND DOES NOT COUNT A ROW WHOSE NUMBER IS READABLE', async () => {
        app('fine-1', {
            nin: 'sha256-of-her-nin', ninEncrypted: 'cipher',
            bvn: 'sha256-of-her-bvn', bvnEncrypted: 'cipher',
        });

        const check = await kycCheck();
        expect(check.affectedIds).toEqual([]);
    });

    it('AND DOES NOT COUNT A NUMBER SHE NEVER GAVE', async () => {
        /*
         *   #779's rule, and the easiest way to get this wrong: `hashData("")`
         *   is never written, so a blank stays null. Counting a null as a
         *   casualty would report every applicant who left the optional field
         *   empty as data loss — and on a register of 15,000 that is the
         *   difference between a real number and a panic.
         */
        app('blank-1', { nin: null, bvn: null });
        app('half-1', { nin: 'sha256-of-her-nin', ninEncrypted: 'cipher', bvn: null });

        const check = await kycCheck();
        expect(check.affectedIds).toEqual([]);
    });

    it('AND COUNTS EACH FIELD SEPARATELY — one lost number is not two', async () => {
        //   A row can lose one and keep the other: the key can be set between
        //   two writes, and #779's cohort predates both.
        app('nin-only', { nin: 'hash', bvn: 'hash', bvnEncrypted: 'cipher' });
        app('bvn-only', { nin: 'hash', ninEncrypted: 'cipher', bvn: 'hash' });

        const check = await kycCheck();
        expect(check.affectedIds.sort()).toEqual(['bvn-only', 'nin-only']);
        expect(check.details).toContain('1 NIN');
        expect(check.details).toContain('1 BVN');
    });

    it('AND NAMES THE MOST RECENT ONE, so a key that is set but not reaching the process shows', async () => {
        /*
         *   The check an operator actually needs after setting the key: if a
         *   loss is dated AFTER that, the variable is not reaching this
         *   process — which is a live misconfiguration and not history.
         */
        app('old', { nin: 'hash', applicationDate: '2026-01-05T00:00:00.000Z' });
        app('new', { nin: 'hash', applicationDate: '2026-09-14T00:00:00.000Z' });

        const check = await kycCheck();
        expect(check.details).toContain('2026-09-14');
    });

    it('CONTROL: AN EMPTY COLLECTION IS NOT A FAILURE', async () => {
        //   verdictFor's asymmetry: nothing found in a COMPLETE scan is a pass.
        const check = await kycCheck();
        expect(check.status).toBe('pass');
        expect(check.affectedIds).toEqual([]);
    });
});
