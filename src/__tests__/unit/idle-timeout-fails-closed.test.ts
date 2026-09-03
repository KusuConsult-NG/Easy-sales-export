/**
 * @jest-environment node
 */

/**
 *   #350 THE IDLE TIMEOUT WAS DISARMED BY ANY NON-NUMBER IN localStorage, FIRED
 *        signOut ONCE A SECOND WHEN IT DID WORK, AND COULD TAKE DOWN EVERY
 *        AUTHENTICATED PAGE.
 *
 *        SessionActivityTracker mounts in ClientLayout for every signed-in
 *        page. Four things in it.
 *
 *        (1) IT FAILED OPEN. The timestamp was read as:
 *
 *              parseInt(localStorage.getItem("lastActivity") || Date.now().toString(), 10)
 *
 *            The `||` covers null. It does not cover a value that is present
 *            and not a number — "abc", a truncated write, a value from an older
 *            build. parseInt returns NaN, `remaining` becomes NaN, and both
 *            decisions compare against it:
 *
 *              NaN <= WARNING_THRESHOLD_MS   false — no warning
 *              NaN <= 0                      false — no logout
 *
 *            So the tracker ticked once a second for as long as the tab was
 *            open and signed nobody out. A control anybody can switch off from
 *            their own devtools by typing one word into their own localStorage.
 *
 *        (2) IT LOGGED OUT REPEATEDLY. checkTimeout runs on a 1000ms interval
 *            and called handleLogout() every tick while `remaining <= 0`.
 *            signOut() navigates, but nothing cleared the interval and there
 *            was no in-flight guard, so an idle tab fired a burst of concurrent
 *            /api/auth/signout requests through the redirect.
 *
 *        (3) EVERY localStorage CALL WAS UNGUARDED. The accessor itself throws
 *            in Safari private browsing and wherever site data is blocked, so
 *            the first tick took down whatever page the member was on. The same
 *            class as #347, with a wider blast radius than any of its three
 *            screens, because this component is on all of them.
 *
 *        (4) AND THE HEADER DESCRIBED A DIFFERENT CONTROL: "30-minute
 *            inactivity timeout", "Warning modal 2 minutes before logout". The
 *            constants are ten minutes and sixty seconds, and always were. Two
 *            of the three statements of one rule were wrong.
 *
 *        WHAT THIS CONTROL IS NOT, stated in the file for the same reason #314
 *        corrected SessionGuard: it is a browser convenience and a
 *        shoulder-surfing guard, not a session lifetime. The NextAuth session
 *        is `maxAge: 8 * 60 * 60` and nothing server-side reads `lastActivity`.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { stripComments } from '@/lib/testing/strip-comments';

const source = (rel: string) => stripComments(readFileSync(rel, 'utf-8'));

const TRACKER = 'src/components/auth/SessionActivityTracker.tsx';
const code = source(TRACKER);

// ─────────────────────────────────────────────────────────────────────────────
describe('#350 — an unreadable timestamp no longer disarms the timeout', () => {
    it('THE PARSE RESULT IS CHECKED FOR BEING A NUMBER', () => {
        // THE test. `NaN <= 0` is false, and that was the whole failure.
        expect(code).toContain('Number.isFinite(raw)');
        expect(code).not.toMatch(/parseInt\(localStorage\.getItem\("lastActivity"\) \|\| Date\.now\(\)/);
    });

    it('and an unusable value restarts the clock rather than removing it', () => {
        // The alternative — treating it as infinitely old — would sign a member
        // out mid-session over a corrupt string.
        expect(code).toMatch(/Number\.isFinite\(raw\) \? raw : \(writeLastActivity\(Date\.now\(\)\), Date\.now\(\)\)/);
    });

    it('the two decisions it feeds are still exactly as strict', () => {
        // Vacuity guard: the point of the finite check is that THESE can fire.
        expect(code).toContain('remaining <= WARNING_THRESHOLD_MS && remaining > 0');
        expect(code).toContain('if (remaining <= 0) {');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#350 — logout happens once', () => {
    it('THERE IS AN IN-FLIGHT GUARD', () => {
        expect(code).toContain('const loggingOut = useRef(false);');
        expect(code).toMatch(/if \(loggingOut\.current\) return;\s*\n\s*loggingOut\.current = true;/);
    });

    it('and it is the FIRST thing handleLogout does', () => {
        // After the signOut call it would guard nothing.
        const body = code.slice(code.indexOf('async function handleLogout'));
        expect(body.indexOf('loggingOut.current')).toBeLessThan(body.indexOf('signOut('));
    });

    it('the interval that calls it still runs every second', () => {
        // Vacuity guard on the cost above: without the 1000ms tick there is
        // nothing to guard against.
        expect(code).toContain('setInterval(checkTimeout, 1000)');
        expect(code).toContain('return () => clearInterval(interval)');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#350 — storage cannot take down an authenticated page', () => {
    it('EVERY localStorage CALL GOES THROUGH A GUARDED HELPER', () => {
        // All three occurrences live inside readLastActivity /
        // writeLastActivity / clearLastActivity, each of which opens with a try.
        expect(code).toMatch(/function readLastActivity\(\): number \{\s*\n\s*try \{/);
        expect(code).toMatch(/function writeLastActivity\(at: number\): void \{\s*\n\s*try \{/);
        expect(code).toMatch(/function clearLastActivity\(\): void \{\s*\n\s*try \{/);

        const calls = code.split('\n').filter((l) => /localStorage\.(getItem|setItem|removeItem)/.test(l));
        expect(calls).toHaveLength(3);
    });

    it('and nothing outside them touches localStorage directly', () => {
        const helpers = code.slice(
            code.indexOf('function readLastActivity'),
            code.indexOf('export default function'),
        );
        const rest = code.replace(helpers, '');

        expect(rest).not.toMatch(/localStorage\./);
    });

    it('it really is mounted on every authenticated page', () => {
        // The blast radius, pinned rather than asserted from memory.
        expect(source('src/components/layout/ClientLayout.tsx'))
            .toContain('status === "authenticated" && <SessionActivityTracker />');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#350 — the header describes the control that exists', () => {
    const raw = readFileSync(TRACKER, 'utf-8');

    it('THE WRONG NUMBERS ARE GONE FROM THE DESCRIPTION', () => {
        // Scoped to the header's own list, because the #350 note below it
        // QUOTES the wrong wording as the tombstone — a whole-file grep would
        // hit my own record of the defect, which is the trap that has fired in
        // three separate ratchets in this codebase already.
        const header = raw.slice(raw.indexOf('/**'), raw.indexOf('#350 THE HEADER SAID'));

        expect(header).not.toMatch(/30-minute inactivity timeout/);
        expect(header).not.toMatch(/Warning modal 2 minutes before logout/);
        expect(header.length).toBeGreaterThan(200);   // vacuity guard on the slice
    });

    it('and the ones it states match the constants', () => {
        expect(code).toContain('const SESSION_TIMEOUT_MS = 10 * 60 * 1000;');
        expect(code).toContain('const WARNING_THRESHOLD_MS = 60 * 1000;');
        expect(raw).toMatch(/10-minute inactivity timeout, warning at 60 seconds remaining/);
    });

    it('it says plainly that this does NOT bound the session', () => {
        // #314's correction, applied to the component that looks most like an
        // enforcement and is not one.
        expect(raw).toMatch(/maxAge: 8 \* 60 \* 60/);
        expect(raw).toMatch(/cannot shorten it/);
        // The substantive half, and the one a reader needs: not just "the
        // session is longer" but "nothing on the server reads this at all".
        expect(raw).toMatch(/nothing server-side consults\s*\n?\s*\*?\s*`lastActivity`/);
    });

    it('and that claim is true — nothing outside this component reads the key', () => {
        // Measured, not asserted. If a server-side idle check is ever built,
        // this fails and the note can be rewritten.
        const { execSync } = require('child_process');
        const readers: string = execSync(
            "grep -rl 'lastActivity' --include=*.ts --include=*.tsx src/app/api src/lib src/app/actions || true",
            { encoding: 'utf-8' },
        );

        expect(readers.split('\n').filter(Boolean)).toEqual([]);
    });

    it('and the server session really is eight hours', () => {
        // Pinned against lib/auth.ts, so the claim above cannot go stale.
        expect(source('src/lib/auth.ts')).toContain('maxAge: 8 * 60 * 60');
    });
});
