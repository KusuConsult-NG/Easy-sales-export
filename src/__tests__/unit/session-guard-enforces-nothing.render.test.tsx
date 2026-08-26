/**
 * @jest-environment jsdom
 */

/**
 *   #314 A COMPONENT CALLED SessionGuard, MOUNTED APP-WIDE, GUARDS NOTHING —
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
 *        The body sets `ese_session_active` when authenticated and removes it
 *        when not. It never reads the flag, never compares anything, and never
 *        signs anybody out. `signOut` was imported and never called, which is
 *        precisely what made the file read as though it did.
 *
 *        `ese_session_active` is written in two files and read in ZERO. The
 *        second writer is LoginForm, under the comment "Register session as
 *        active in this tab to satisfy SessionGuard" — somebody wrote code to
 *        satisfy a check that does not exist. That is the cost of naming a
 *        component for a control it does not perform: the belief spreads to
 *        the next person.
 *
 *        #42 and #114 are the same shape on data — a field written and never
 *        read. This is that shape on a security control, in the file whose
 *        name is the reason nobody looked.
 *
 * WHY THIS MOUNTS THE COMPONENT
 * -----------------------------
 * "It does not sign anybody out" is a claim about behaviour, and #287's
 * mutation run settled that a source ratchet cannot make claims about
 * behaviour: `if (false)` preserves every string it greps for. So the guard is
 * rendered against a live session, an expired one, and the volatile case its
 * comment described, and signOut is asserted never to fire. This is also the
 * first security component in the codebase to execute in any test.
 *
 * WHAT IS NOT DONE HERE
 * ---------------------
 * The missing control is not built. It signs real members out of a live
 * platform, and a wrong threshold locks them out — that is an owner decision,
 * not an audit fix. The two controls that DO sign users out are pinned below
 * so this is not misread as "sessions are unguarded".
 */

import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

const ROOT = process.cwd();
const code = (rel: string) => stripComments(readFileSync(join(ROOT, rel), 'utf-8'), { label: rel });

const mockSignOut = jest.fn();
let sessionState: { data: any; status: string } = { data: null, status: 'loading' };
let pathname = '/dashboard';

jest.mock('next-auth/react', () => ({
    useSession: () => sessionState,
    signOut: (...a: any[]) => mockSignOut(...a),
}));
jest.mock('next/navigation', () => ({
    usePathname: () => pathname,
}));

import SessionGuard from '@/components/auth/SessionGuard';

const FLAG = 'ese_session_active';

beforeEach(() => {
    jest.clearAllMocks();
    sessionStorage.clear();
    pathname = '/dashboard';
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#314 — mounted, against every case its comment described', () => {
    it('AN AUTHENTICATED SESSION: sets the flag and signs nobody out', async () => {
        sessionState = { data: { user: { id: 'u1' } }, status: 'authenticated' };

        render(<SessionGuard />);

        await waitFor(() => expect(sessionStorage.getItem(FLAG)).toBe('true'));
        expect(mockSignOut).not.toHaveBeenCalled();
    });

    it('AN UNAUTHENTICATED ONE: clears the flag and signs nobody out', async () => {
        sessionStorage.setItem(FLAG, 'true');
        sessionState = { data: null, status: 'unauthenticated' };

        render(<SessionGuard />);

        await waitFor(() => expect(sessionStorage.getItem(FLAG)).toBeNull());
        expect(mockSignOut).not.toHaveBeenCalled();
    });

    it('THE VOLATILE CASE ITSELF — a signed-in cookie in a tab that never logged in', async () => {
        // THE test. This is the exact scenario the deleted comment described:
        // sessionStorage is per-tab, so an authenticated session with NO flag
        // is a session that arrived from somewhere else. The comment said this
        // "forces a re-login". Nothing happens.
        expect(sessionStorage.getItem(FLAG)).toBeNull();
        sessionState = { data: { user: { id: 'u1' } }, status: 'authenticated' };

        render(<SessionGuard />);

        // It does not force a re-login. It writes the flag and moves on, so
        // the very state that was supposed to trigger the guard is erased by
        // the guard itself.
        await waitFor(() => expect(sessionStorage.getItem(FLAG)).toBe('true'));
        expect(mockSignOut).not.toHaveBeenCalled();
    });

    it('and it stands aside on /auth, which is the one behaviour it does have', async () => {
        pathname = '/auth/login';
        sessionState = { data: { user: { id: 'u1' } }, status: 'authenticated' };

        render(<SessionGuard />);

        // Vacuity guard: if the effect never ran at all, the assertions above
        // would pass for the wrong reason.
        await waitFor(() => expect(sessionStorage.getItem(FLAG)).toBeNull());
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#314 — the flag has no reader anywhere', () => {
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

    it('WRITTEN IN TWO FILES, READ IN NONE', () => {
        const files = sourceFiles().filter((f) => code(f).includes(FLAG));
        const readers = files.filter((f) =>
            new RegExp(`getItem\\(\\s*["']${FLAG}["']`).test(code(f)));

        expect(files).toEqual([
            'src/components/auth/LoginForm.tsx',
            'src/components/auth/SessionGuard.tsx',
        ]);
        expect(readers).toEqual([]);
    });

    it('and LoginForm no longer says the write is required to satisfy anything', () => {
        expect(readFileSync(join(ROOT, 'src/components/auth/LoginForm.tsx'), 'utf-8'))
            .not.toMatch(/^\s*\/\/ Register session as active in this tab to satisfy SessionGuard$/m);
    });

    it('signOut is no longer imported into a file that never calls it', () => {
        const src = code('src/components/auth/SessionGuard.tsx');

        expect(src).not.toMatch(/signOut/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#314 — what DOES sign a user out, so this is not misread', () => {
    /**
     * Pinned so "SessionGuard enforces nothing" is never quoted as "sessions
     * are unguarded". Two real controls exist; what is missing is specifically
     * the volatile-session rule.
     */
    it('SessionActivityTracker signs out on idle', () => {
        expect(code('src/components/auth/SessionActivityTracker.tsx')).toMatch(/await signOut\(/);
    });

    it('useSessionExpiry signs out when the token expires', () => {
        expect(code('src/hooks/useSessionExpiry.ts')).toMatch(/signOut\(/);
    });
});
