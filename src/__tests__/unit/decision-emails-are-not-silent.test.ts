/**
 * @jest-environment node
 */

/**
 *   #308 #217's FIX REACHED THE SHARED SENDER AND NINE DECISION PATHS KEPT
 *        THEIR OWN COPY.
 *
 *        #217 found that a missing RESEND_API_KEY was silent in production, and
 *        fixed sendEmailNotification to log it and return a failure. Its
 *        write-up listed what goes undelivered when that happens:
 *
 *          "membership approvals, rejections, password resets, briefing
 *           confirmations, withdrawal notifications, the legacy welcome
 *           carrying a member's temporary PIN — all quietly undelivered,
 *           indefinitely."
 *
 *        Those are exactly the paths that never called it. Nine sites across
 *        five files built their own Resend client behind
 *
 *            if (process.env.RESEND_API_KEY && appData.userEmail) { ... }
 *
 *        so with no key the whole block was skipped: no send, no log, no return
 *        value, nothing. #297's shape again — a fix landing on one copy — but
 *        with the copies being every module's APPROVE and REJECT decision:
 *        export (3), loans (2), academy (2), marketplace, and land. NINE.
 *
 *        A TENTH GREP HIT WAS DEAD CODE, AND CATCHING THAT IS THE POINT OF THE
 *        SHARED STRIPPER. admin/_legacy.ts appears to carry the same block, and
 *        I edited it before noticing that _inviteLegacyMemberAction's entire
 *        body sits inside `/* Original implementation below (deprecated ...`,
 *        opened at line 34 and closed 120 lines later; the live function returns
 *        "Method deprecated". lib/testing/strip-comments.ts documents exactly
 *        this file as "TRAP 2", and the assertion below — written against
 *        STRIPPED source — is what failed and sent me to look. The live legacy
 *        welcome uses sendLegacyMemberWelcomeEmail, which routes through the
 *        hardened shared sender and whose result is checked (#290). It was never
 *        part of this defect.
 *
 *        THE SECOND HALF OF THE CONDITION WAS THE SAME DEFECT IN MINIATURE. A
 *        member with no email on record was skipped just as quietly, and that
 *        is a data problem somebody could fix if they knew it existed. Only
 *        _land.ts logged it.
 *
 *        AND THE SCREENS TELL PEOPLE TO GO AND READ THE EMAIL.
 *        /export/onboarding/rejected and /marketplace/onboarding/rejected both
 *        say "check your inbox for detailed feedback". That is #290's shape —
 *        a screen announcing an email nobody sent.
 *
 * WHAT THIS DOES NOT DO
 * ---------------------
 * It does not route the nine through sendEmailNotification. Each carries its own
 * hand-written HTML body, and moving them wholesale is a large edit whose
 * failure mode is a broken template in a message somebody receives once. The
 * defect is the SILENCE and that is what is closed, in one line per site. The
 * duplication — ten Resend clients for one platform — is recorded here
 * rather than half-migrated.
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

function code(rel: string): string {
    return stripComments(readFileSync(join(process.cwd(), rel), 'utf-8'));
}

/** Every file that reached for Resend behind an env check. */
const DECISION_PATHS = [
    'src/app/actions/admin/_exports.ts',
    'src/app/actions/admin/_loans.ts',
    'src/app/actions/admin/_marketplace.ts',
    'src/app/actions/admin/_land.ts',
    'src/app/actions/academy/_ac_admin_review.ts',
];

// ─────────────────────────────────────────────────────────────────────────────
describe('#308 — no decision path skips a message in silence', () => {
    it.each(DECISION_PATHS)('%s no longer branches on the key itself', (path) => {
        // THE test. `if (process.env.RESEND_API_KEY)` is the whole defect: it
        // turns "we cannot send" into "we chose not to", with no output.
        expect(code(path)).not.toMatch(/if \(process\.env\.RESEND_API_KEY/);
    });

    it.each(DECISION_PATHS)('%s guards through the shared check instead', (path) => {
        expect(code(path)).toMatch(/canSendEmail\(/);
    });

    it('NOT ONE OF THEM IS LEFT — stated over the whole tree, not a file list', () => {
        // A file list is what let this survive #217. If a seventh path appears
        // with the old shape, this fails whether or not it is named above.
        const { execSync } = require('child_process');
        const hits: string[] = execSync(
            'grep -rln "if (process.env.RESEND_API_KEY" src --include=*.ts || true',
            { encoding: 'utf-8', cwd: process.cwd() },
        ).split('\n').filter(Boolean).filter((f: string) => !f.includes('__tests__'));

        // The two survivors are prose: this file's own explanation in
        // email-notifications.ts, and a comment in _marketplace.ts.
        const withLiveCode = hits.filter((f: string) =>
            /if \(process\.env\.RESEND_API_KEY/.test(code(f)));

        expect(withLiveCode).toEqual([]);
    });

    it('and the shared sender still fails loudly, which is what #217 established', () => {
        const src = code('src/lib/email-notifications.ts');

        expect(src).toMatch(/if \(!process\.env\.RESEND_API_KEY\)/);
        expect(src).toMatch(/RESEND_API_KEY not configured/);
        expect(src).toMatch(/success: false, error: 'Email service not configured'/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#308 — the guard itself', () => {
    const ORIGINAL = process.env.RESEND_API_KEY;
    let errors: string[];

    beforeEach(() => {
        jest.resetModules();
        errors = [];
    });

    afterEach(() => {
        if (ORIGINAL === undefined) delete process.env.RESEND_API_KEY;
        else process.env.RESEND_API_KEY = ORIGINAL;
    });

    async function guard() {
        jest.doMock('@/lib/logger', () => ({
            logger: {
                error: (m: string) => errors.push(String(m)),
                warn: () => undefined, info: () => undefined, debug: () => undefined,
            },
        }));
        const { canSendEmail } = await import('@/lib/email-notifications');
        return canSendEmail;
    }

    it('REFUSES AND SAYS SO when the key is absent', async () => {
        delete process.env.RESEND_API_KEY;
        const canSendEmail = await guard();

        expect(canSendEmail('loan decision email', 'ada@example.com')).toBe(false);
        expect(errors.join(' ')).toMatch(/loan decision email/);
        expect(errors.join(' ')).toMatch(/RESEND_API_KEY is not configured/);
    });

    it('AND WHEN THE MEMBER HAS NO ADDRESS — the half only one site logged', async () => {
        process.env.RESEND_API_KEY = 'test-key';
        const canSendEmail = await guard();

        expect(canSendEmail('export decision email', undefined)).toBe(false);
        expect(canSendEmail('export decision email', null)).toBe(false);
        expect(canSendEmail('export decision email', '')).toBe(false);
        // Whitespace is not an address either.
        expect(canSendEmail('export decision email', '   ')).toBe(false);

        expect(errors.filter((e) => /no email address on the record/.test(e))).toHaveLength(4);
    });

    it('and permits a real send, so the guard is not simply off', async () => {
        // Vacuity guard: returning false always would silence every email on
        // the platform and pass every assertion above.
        process.env.RESEND_API_KEY = 'test-key';
        const canSendEmail = await guard();

        expect(canSendEmail('academy decision email', 'ada@example.com')).toBe(true);
        expect(errors).toEqual([]);
    });

    it('names the context, so a log line says WHICH message went undelivered', async () => {
        delete process.env.RESEND_API_KEY;
        const canSendEmail = await guard();

        canSendEmail('the legacy welcome carrying a temporary PIN', 'a@e.com');

        expect(errors[0]).toContain('the legacy welcome carrying a temporary PIN');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#308 — what the screens promise', () => {
    /**
     * Recorded rather than changed. Both rejection screens tell the member to
     * read an email, and that claim is only true when the send actually
     * happened. The guard above does not make it true — it makes the failure
     * visible to whoever runs the platform, which is the part code can do.
     *
     * Pinned so that if somebody later removes the email from a rejection flow,
     * the screen that promises it is found in the same search.
     */
    it.each([
        ['src/app/marketplace/onboarding/rejected/page.tsx'],
        ['src/app/export/onboarding/rejected/page.tsx'],
    ])('%s still tells the member to check their inbox', (path) => {
        expect(readFileSync(join(process.cwd(), path), 'utf-8')).toMatch(/check your inbox/i);
    });

    it('and a rejection on each of those modules does attempt a send', () => {
        // The claim is at least backed by a code path. Export rejects in
        // admin/_exports.ts; marketplace in api/admin/marketplace/reject-seller.
        expect(code('src/app/actions/admin/_exports.ts')).toMatch(/canSendEmail\("export decision email"/);
        expect(code('src/app/api/admin/marketplace/reject-seller/route.ts'))
            .toMatch(/sendSellerRejectionEmail\(/);
    });
});
