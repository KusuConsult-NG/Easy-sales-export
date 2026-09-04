/**
 * @jest-environment jsdom
 */

/**
 *   #314 A COMPONENT CALLED SessionGuard, MOUNTED APP-WIDE, GUARDED NOTHING —
 *        AND ANOTHER FILE WROTE A FLAG "TO SATISFY" IT.
 *
 *        Its doc comment claimed two behaviours:
 *
 *          1. "Volatile Session: Detects fresh entries (e.g. from external
 *              URLs) and forces a re-login if a previous session exists but
 *              tab state is lost."
 *          2. "Redirect Loop Prevention: Uses a guard flag to ensure sign-out
 *              is only triggered once per entry."
 *
 *        The body set `ese_session_active` when authenticated and removed it
 *        when not. It never read the flag, never compared anything, and never
 *        signed anybody out. `signOut` was imported and never called, which is
 *        precisely what made the file read as though it did.
 *
 *        `ese_session_active` was written in two files and read in ZERO. The
 *        second writer was LoginForm, under the comment "Register session as
 *        active in this tab to satisfy SessionGuard" — somebody wrote code to
 *        satisfy a check that does not exist. That is the cost of naming a
 *        component for a control it does not perform: the belief spreads to the
 *        next person.
 *
 *        #314 corrected the description and pinned the behaviour. Whether to
 *        BUILD the control was left open.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   #240 THE DECISION: THE VOLATILE-SESSION RULE IS DROPPED, AND THE RISK IT
 *        WAS GROPING AT IS CLOSED WHERE IT CAN ACTUALLY BE CLOSED.
 *
 *        THREE MEASURED REASONS FOR DROPPING IT.
 *
 *        1. ITS TRIGGER CANNOT TELL THE TARGET FROM ORDINARY USE. sessionStorage
 *           is per-tab, so "authenticated with no flag" is the state of a link
 *           opened in a new tab, a bookmark, an email link, and a restored
 *           browser session — identical to the case the rule was aimed at.
 *           Building it signs real members out of a live platform for opening a
 *           second tab. A control that cannot distinguish its target from its
 *           users is not a control.
 *
 *        2. ITS STATED PREMISE WAS FALSE. #314's own note said "a session cookie
 *           set on easysalesexport.com is presented on the module domains too".
 *           It is not: lib/auth.config.ts configures the session cookie with no
 *           `domain`, and @auth/core adds none, so the cookie is host-only and
 *           every module host has its own. That claim is asserted against the
 *           config below rather than repeated.
 *
 *        3. THE REAL RISK IS A COOKIE PROPERTY, AND NO COMPONENT CAN SEE IT.
 *           @auth/core writes the session token with `expires = now + maxAge`
 *           unconditionally, so the cookie is PERSISTENT: closing the browser
 *           leaves a member signed in for up to eight hours, and on a shared
 *           computer the next person is signed in as them. Nothing in a browser
 *           reliably reports "the browser was closed" — that is what a
 *           session-scoped cookie is for, and @auth/core 5.0.0-beta.32 does not
 *           let this app ask for one (`expires` is applied after the spread of
 *           `cookies.sessionToken.options`).
 *
 *        SO THE GAP IS CLOSED IN THE CONTROL THAT ALREADY OWNS IT.
 *        SessionActivityTracker measures how long since the member did
 *        anything, and it was erasing the evidence: an unconditional
 *        `writeLastActivity(Date.now())` on mount, so reopening the browser two
 *        hours later restarted the ten-minute clock. It now HONOURS a stored
 *        timestamp that belongs to the session being stood in, and the existing
 *        `remaining <= 0` branch does the rest.
 *
 *        `authAt` — when THIS session was minted (#306) — is what makes that
 *        safe. A timestamp older than it belongs to a previous session, so a
 *        fresh login can never be signed out by the last one's clock, from any
 *        login path including ones added later. That loop is not hypothetical:
 *        HardLogoutButton exists partly because of it.
 */

import React from 'react';
import { render, act, fireEvent } from '@testing-library/react';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

const ROOT = process.cwd();
const code = (rel: string) => stripComments(readFileSync(join(ROOT, rel), 'utf-8'), { label: rel });

const mockSignOut = jest.fn();
let sessionState: { data: any; status: string } = { data: null, status: 'loading' };

jest.mock('next-auth/react', () => ({
    useSession: () => sessionState,
    signOut: (...a: any[]) => mockSignOut(...a),
}));

import SessionActivityTracker, { belongsToThisSession } from '@/components/auth/SessionActivityTracker';

const FLAG = 'ese_session_active';
const MINUTE = 60 * 1000;

/** The tracker's own constant, restated here only as the scenario's clock. */
const TIMEOUT_MS = 10 * MINUTE;

function authenticatedSince(authAt: number | undefined) {
    sessionState = { data: { user: { id: 'u1', authAt } }, status: 'authenticated' };
}

beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    localStorage.clear();
    sessionStorage.clear();
    sessionState = { data: null, status: 'loading' };
});

afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
});

/** Mount and let the mount effect's queued state update and one tick run. */
function mountAndTick() {
    render(<SessionActivityTracker />);
    act(() => { jest.advanceTimersByTime(1100); });
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#240 — the rule that was dropped, and why it could not have worked', () => {
    it('THE COMPONENT NAMED FOR IT IS GONE', () => {
        // Not neutered in place. A component mounted app-wide, named
        // SessionGuard, writing a key nothing reads, IS the hazard — it is what
        // made somebody write code to satisfy it.
        expect(existsSync(join(ROOT, 'src/components/auth/SessionGuard.tsx'))).toBe(false);
        expect(code('src/components/layout/ClientLayout.tsx')).not.toMatch(/<SessionGuard\s*\/>/);
        expect(code('src/components/layout/ClientLayout.tsx')).not.toMatch(/import SessionGuard/);
    });

    it('and its flag is written nowhere at all now', () => {
        // Was: written in two files, read in none. The sweep is derived rather
        // than a hand-written list, so a third writer appearing later fails
        // here.
        function sourceFiles(): string[] {
            const out: string[] = [];
            const walk = (dir: string) => {
                for (const e of readdirSync(dir)) {
                    if (e === 'node_modules' || e === '__tests__') continue;
                    const full = join(dir, e);
                    if (statSync(full).isDirectory()) walk(full);
                    else if (full.endsWith('.ts') || full.endsWith('.tsx')) out.push(full.slice(ROOT.length + 1));
                }
            };
            walk(join(ROOT, 'src'));
            return out.sort();
        }

        const writers = sourceFiles().filter((f) =>
            new RegExp(`(setItem|removeItem)\\(\\s*["']${FLAG}["']`).test(code(f)));

        expect(writers).toEqual([]);
    });

    it('THE PREMISE IT RESTED ON IS FALSE: the session cookie is host-only', () => {
        // Reason 2, measured against the config rather than asserted. A cookie
        // with no `domain` is not sent to sibling hosts, so a session on
        // www.easysalesexport.com is NOT presented on farmnation.easysalesexport.com.
        const config = code('src/lib/auth.config.ts');
        const sessionCookie = config.slice(
            config.indexOf('sessionToken:'),
            config.indexOf('csrfToken:'),
        );

        expect(sessionCookie.length).toBeGreaterThan(100);   // vacuity guard on the slice
        expect(sessionCookie).not.toMatch(/domain\s*:/);
    });

    it('and @auth/core really does write a persistent cookie, which is reason 3', () => {
        // The measurement behind "closing the browser does not end the session".
        // Read from the installed package, so an upgrade that makes the cookie
        // session-scoped fails here and the note can be rewritten.
        const core = readFileSync(
            join(ROOT, 'node_modules/@auth/core/lib/actions/callback/index.js'), 'utf-8');

        expect(core).toMatch(/cookieExpires\.setTime\(cookieExpires\.getTime\(\) \+ sessionMaxAge \* 1000\)/);
        expect(core).toMatch(/expires: cookieExpires/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#240 — whose timestamp is it', () => {
    const AUTH_AT = 1_000_000;

    it('one recorded after this session started belongs to it', () => {
        expect(belongsToThisSession(AUTH_AT + 1, AUTH_AT)).toBe(true);
        expect(belongsToThisSession(AUTH_AT, AUTH_AT)).toBe(true);
    });

    it('one recorded BEFORE it does not — this is what stops the login loop', () => {
        // The hazard the unconditional reset was covering, and the reason this
        // is keyed on authAt rather than on a clear-at-login call that only the
        // login paths somebody remembered would make.
        expect(belongsToThisSession(AUTH_AT - 1, AUTH_AT)).toBe(false);
    });

    it('and everything unknown answers no, so the clock is seeded rather than fired', () => {
        // Fail toward the member. NaN is #350's unreadable-value case; a
        // missing authAt is a session minted before #306 stamped one.
        expect(belongsToThisSession(NaN, AUTH_AT)).toBe(false);
        expect(belongsToThisSession(Infinity, AUTH_AT)).toBe(false);
        expect(belongsToThisSession(AUTH_AT + 1, undefined)).toBe(false);
        expect(belongsToThisSession(AUTH_AT + 1, null)).toBe(false);
        expect(belongsToThisSession(AUTH_AT + 1, '1000000')).toBe(false);
        expect(belongsToThisSession(AUTH_AT + 1, NaN)).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#240 — mounted, against the cases the dropped rule described', () => {
    it('A COLD ENTRY SIGNS THE MEMBER OUT — the case that actually mattered', () => {
        // THE test. The member logged in, worked, closed the browser; the
        // cookie outlived it and they come back well past the idle timeout.
        // Before this, the mount effect overwrote the stored timestamp and gave
        // them a fresh ten minutes.
        const now = Date.now();
        authenticatedSince(now - 3 * 60 * MINUTE);
        localStorage.setItem('lastActivity', String(now - 2 * 60 * MINUTE));

        mountAndTick();

        expect(mockSignOut).toHaveBeenCalledTimes(1);
    });

    it('A SECOND TAB DOES NOT — the case the dropped rule would have broken', () => {
        // The whole reason the volatile rule was wrong. Another tab is already
        // signed in and active; sessionStorage is empty here because it is
        // per-tab, and that is not evidence of anything.
        const now = Date.now();
        authenticatedSince(now - 60 * MINUTE);
        localStorage.setItem('lastActivity', String(now - 5 * 1000));

        expect(sessionStorage.getItem(FLAG)).toBeNull();

        mountAndTick();

        expect(mockSignOut).not.toHaveBeenCalled();
    });

    it('A FRESH LOGIN DOES NOT, even with the previous session clock still stored', () => {
        // The loop HardLogoutButton documents. authAt is newer than the stored
        // timestamp, so it is ignored and the clock starts now.
        const now = Date.now();
        localStorage.setItem('lastActivity', String(now - 2 * 60 * MINUTE));
        authenticatedSince(now);

        mountAndTick();

        expect(mockSignOut).not.toHaveBeenCalled();
        expect(Number(localStorage.getItem('lastActivity'))).toBeGreaterThanOrEqual(now);
    });

    it('a session with no authAt is seeded, so deploying this ejects nobody', () => {
        // Sessions minted before #306 carry no authAt. They lose the cold-entry
        // protection until they expire; they must not lose their session.
        const now = Date.now();
        localStorage.setItem('lastActivity', String(now - 2 * 60 * MINUTE));
        authenticatedSince(undefined);

        mountAndTick();

        expect(mockSignOut).not.toHaveBeenCalled();
    });

    it('and nothing is seeded or fired while the session is still loading', () => {
        // Without this the mount effect would seed a timestamp with no authAt
        // to compare against — the unconditional write, reintroduced, and a
        // cold entry would look identical to a live one.
        localStorage.setItem('lastActivity', String(Date.now() - 2 * 60 * MINUTE));
        sessionState = { data: null, status: 'loading' };

        mountAndTick();

        expect(mockSignOut).not.toHaveBeenCalled();
        expect(Number(localStorage.getItem('lastActivity')))
            .toBeLessThan(Date.now() - 60 * MINUTE);
    });

    it('AND A RESUMED CLOCK CAN BE RESET BY THE MEMBER MOVING — it is resumed, not just read', () => {
        // The mount effect resumes the stored timestamp into component state as
        // well as leaving it in storage, and the difference shows up here.
        // `updateActivity` is debounced against that state: it only records
        // activity when the last recorded moment was more than 30 seconds ago.
        //
        // Resume the STORED moment and the first mousemove is 9m50s later, so
        // it records and the member keeps their session. Resume `Date.now()`
        // instead and the debounce believes activity was just recorded, the
        // storage value stays 9m50s old, and a member who is actively moving is
        // signed out ten seconds later.
        const now = Date.now();
        authenticatedSince(now - 60 * MINUTE);
        localStorage.setItem('lastActivity', String(now - (TIMEOUT_MS - 10_000)));

        mountAndTick();
        expect(mockSignOut).not.toHaveBeenCalled();

        act(() => { fireEvent.mouseMove(window); });
        act(() => { jest.advanceTimersByTime(30_000); });

        expect(mockSignOut).not.toHaveBeenCalled();
    });

    it('an idle-but-open tab still times out exactly as before', () => {
        // Vacuity guard on the whole change: #350's control must be untouched.
        const now = Date.now();
        authenticatedSince(now - 60 * MINUTE);
        localStorage.setItem('lastActivity', String(now - 5 * 1000));

        render(<SessionActivityTracker />);
        act(() => { jest.advanceTimersByTime(1100); });
        expect(mockSignOut).not.toHaveBeenCalled();

        // Time passes with no interaction, so the stored timestamp ages out.
        act(() => { jest.advanceTimersByTime(TIMEOUT_MS); });

        expect(mockSignOut).toHaveBeenCalledTimes(1);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#240 — what this is, and is not, stated in the file', () => {
    const raw = readFileSync(join(ROOT, 'src/components/auth/SessionActivityTracker.tsx'), 'utf-8');

    it('the mount effect no longer overwrites the stored timestamp unconditionally', () => {
        const src = code('src/components/auth/SessionActivityTracker.tsx');
        const effect = src.slice(src.indexOf('function checkTimeout'));

        expect(effect).toContain('const resume = belongsToThisSession(stored, authAt);');
        expect(effect).toContain('if (!resume) writeLastActivity(Date.now());');
    });

    it('and it says plainly that the cookie is still eight hours', () => {
        // #314's correction, kept: this is the browser acting on its own state,
        // not a session lifetime. A client that never runs it is not bound.
        expect(raw).toMatch(/maxAge: 8 \* 60 \* 60/);
        expect(raw).toMatch(/cannot shorten it/);
        // Wrap-tolerant: the sentence spans two comment lines.
        expect(raw).toMatch(/cookie is unchanged and remains valid for its eight hours/);
    });

    it('and names the fix it is standing in for, so it is not mistaken for one', () => {
        expect(raw).toMatch(/session-scoped cookie/);
        expect(raw).toMatch(/5\.0\.0-beta\.32/);
    });
});
