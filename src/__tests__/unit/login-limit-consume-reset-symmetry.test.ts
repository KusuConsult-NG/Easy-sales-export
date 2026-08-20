/**
 * @jest-environment node
 */

/**
 * Anything that consumes a login attempt must also give it back on success.
 *
 * THE BUG THIS CODIFIES
 * ---------------------
 * Two places in this application consume a login attempt:
 *
 *   src/lib/auth.ts             authorize(), "STEP 3: Rate limit check"
 *   src/app/actions/auth.ts     preValidateLoginAction(), step 2
 *
 * Only the first ever called resetLoginAttempts. The limit is consumed BEFORE
 * the password is checked — deliberately, so a wrong password costs a token —
 * which means the thing that makes it "five FAILURES" rather than "five logins"
 * is the reset on success. The Server Action had no reset, so its counter only
 * ever went up.
 *
 * WHY IT HID
 * ----------
 * With Upstash reachable both paths share one Redis counter, so authorize()'s
 * reset covered the action's consume by accident and nothing looked wrong.
 *
 * It surfaces the moment either path falls back to the in-memory store, because
 * Next compiles a Server Action and the NextAuth route handler into SEPARATE
 * server bundles — separate module instances, separate Maps. authorize()'s reset
 * clears its own Map and cannot reach the action's, so the action's counter
 * climbs by one per SUCCESSFUL login and refuses the sixth with "Too many
 * failed login attempts" after five clean sign-ins.
 *
 * A production-build Playwright run allowed e2e.user exactly five sign-ins and
 * refused the sixth with the correct password on screen. That is this defect.
 *
 * WHY THIS TEST IS STRUCTURAL
 * ---------------------------
 * The pairing is the invariant, and it is a property of the SET of call sites,
 * not of any one function. A behavioural test of preValidateLoginAction would
 * need Supabase Auth, the Firestore-compat adapter, the migrator and the
 * schema-normaliser all mocked, and it would still say nothing about a third
 * call site added next month. Reading the source says exactly the thing that
 * went wrong: somebody added a consume without a reset.
 *
 * src/__tests__/unit/login-limit-fallback-reset.test.ts covers the behaviour of
 * the reset itself.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const SRC = join(process.cwd(), 'src');

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            if (entry === '__tests__' || entry === 'node_modules') continue;
            walk(full, out);
        } else if (/\.tsx?$/.test(entry)) {
            out.push(full);
        }
    }
    return out;
}

/** Comment bodies stripped, so a mention in prose is not mistaken for a call. */
function codeOf(file: string): string {
    return readFileSync(file, 'utf-8')
        .split('\n')
        .filter(line => {
            const t = line.trim();
            return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
        })
        .join('\n');
}

const files = walk(SRC).map(file => ({ file, code: codeOf(file) }));

/** Files that actually CALL consumeLoginAttempt, not merely import or define it. */
const consumers = files.filter(
    ({ file, code }) =>
        /consumeLoginAttempt\s*\(/.test(code) &&
        // rate-limit.ts declares it; it is not a consumer of itself.
        !file.endsWith(join('lib', 'rate-limit.ts'))
);

describe('every login-attempt consumer resets on success', () => {
    it('found the call sites (sanity)', () => {
        // Without this, a rename or a moved directory empties the loop below and
        // this file passes having checked nothing.
        expect(consumers.length).toBeGreaterThanOrEqual(2);

        const names = consumers.map(c => c.file.replace(process.cwd() + '/', ''));
        expect(names).toContain('src/lib/auth.ts');
        expect(names).toContain('src/app/actions/auth.ts');
    });

    it.each(
        // Lazily named so a new consumer appears here automatically.
        consumers.map(c => [c.file.replace(process.cwd() + '/', ''), c] as const)
    )('%s also calls resetLoginAttempts', (_name, consumer) => {
        expect(
            /resetLoginAttempts\s*\(/.test(consumer.code),
            // Jest ignores the second argument to expect() for a bare boolean,
            // so the explanation goes in the matcher message below instead.
        ).toBe(true);
    });

    it('names the reason, so a failure above is actionable', () => {
        // Kept separate because expect(boolean) carries no custom message. Any
        // consumer missing its reset is listed by path.
        const missing = consumers
            .filter(c => !/resetLoginAttempts\s*\(/.test(c.code))
            .map(c => c.file.replace(process.cwd() + '/', ''));

        expect(
            missing.length === 0
                ? 'ok'
                : `These call consumeLoginAttempt but never resetLoginAttempts, so their ` +
                  `counter only ever climbs and a SUCCESSFUL login is eventually refused ` +
                  `with "Too many failed login attempts": ${missing.join(', ')}`
        ).toBe('ok');
    });

    it('the reset is reachable on the success path, not only in a catch', () => {
        // A reset that only runs while handling an error would satisfy the
        // regex above and fix nothing.
        const action = codeOf(join(SRC, 'app', 'actions', 'auth.ts'));

        // In preValidateLoginAction the password is proven at
        // `const uid = responseData.user.id;` — every earlier branch returns
        // failure. The reset must come after that line.
        const uidAt = action.indexOf('const uid = responseData.user.id');
        const resetAt = action.indexOf('resetLoginAttempts(');

        expect(uidAt).toBeGreaterThan(-1);
        expect(resetAt).toBeGreaterThan(uidAt);
    });

    it('both consumers still consume — the limit was not simply removed', () => {
        // The vacuity guard for the whole file. Deleting consumeLoginAttempt
        // everywhere would make every assertion above trivially true and leave
        // the login form with no brute-force protection at all.
        for (const consumer of consumers) {
            expect(/consumeLoginAttempt\s*\(/.test(consumer.code)).toBe(true);
        }
        expect(consumers.length).toBeGreaterThanOrEqual(2);
    });
});
