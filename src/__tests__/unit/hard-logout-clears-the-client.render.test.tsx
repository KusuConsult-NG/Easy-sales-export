/**
 * @jest-environment jsdom
 */

/**
 *   #337 THE RECOVERY BUTTON DID NOT PERFORM THE RECOVERY, AND ITS FALLBACK
 *        LEFT THE DEPLOYMENT.
 *
 *        HardLogoutButton is rendered by EVERY error page — root, admin,
 *        marketplace, farm-nation, export — under the caption "Recommended if
 *        you are stuck in a login loop". It is the control a user reaches when
 *        the app has already broken, so what it actually does matters more
 *        than what most buttons do.
 *
 *        IT CLEARED NO CLIENT STATE. The label reads "Clear Cache & Hard
 *        Logout" and the tooltip "Clear all session data and force a fresh
 *        login". The handler called logoutAction() and nothing else.
 *        logoutAction is thorough about COOKIES — root-domain and host-scoped,
 *        session and CSRF, then signOut() — but it runs on the server and
 *        cannot reach the browser. So the state most likely to be causing the
 *        loop the caption names was never touched: `lastActivity`, the
 *        timestamp SessionActivityTracker reads to decide a session has gone
 *        idle. A stale value there signs the user out again right after they
 *        log in — which IS the loop — and the button advertised as its cure
 *        left it exactly where it was.
 *
 *        AND THE FALLBACK WENT TO PRODUCTION:
 *
 *            window.location.href = 'https://easysalesexport.com/auth/login';
 *
 *        From staging, a preview build or localhost, a failed logout sent the
 *        user to a DIFFERENT DEPLOYMENT — where their session has nothing to do
 *        with the one that just failed, and where the cookies just cleared do
 *        not apply. Relative now.
 *
 *        WHAT IS DELIBERATELY NOT CLEARED. `localStorage.clear()` is the
 *        obvious way to honour "clear all session data", and it would silently
 *        destroy `wave_briefing_pending_sync` — a WAVE briefing registration
 *        submitted while offline and held until connectivity returns
 *        (wave/briefing/page.tsx writes it on !navigator.onLine and replays it
 *        on reconnect). Unsent user data is not cache. That key is stepped
 *        around, which is this audit's no-data-loss rule applied to browser
 *        storage.
 *
 *        ALSO CORRECTED, same layer: MarketplaceRouteGuard's header said
 *        access was still enforced "inside /marketplace/(member)/". There is no
 *        (member) segment. The enforcement is real and lives in
 *        marketplace/seller/layout.tsx and marketplace/buyer/layout.tsx, which
 *        both fail CLOSED; the comment now names them.
 */

import { readFileSync } from 'fs';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { stripComments } from '@/lib/testing/strip-comments';

const mockLogoutAction = jest.fn();
jest.mock('@/app/actions/auth', () => ({
    logoutAction: (...args: unknown[]) => mockLogoutAction(...args),
}));

import {
    HardLogoutButton,
    clearClientSessionState,
    SESSION_STORAGE_KEYS_CLEARED,
    CLIENT_KEYS_PRESERVED,
} from '@/components/auth/HardLogoutButton';

const source = (rel: string) => stripComments(readFileSync(rel, 'utf-8'));
const BUTTON = 'src/components/auth/HardLogoutButton.tsx';
const GUARD = 'src/components/marketplace/MarketplaceRouteGuard.tsx';

beforeEach(() => {
    mockLogoutAction.mockReset();
    mockLogoutAction.mockResolvedValue(undefined);
    window.localStorage.clear();
    window.sessionStorage.clear();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#337 — pressing it actually clears the client session state', () => {
    it('REMOVES lastActivity, THE TIMESTAMP THAT CAUSES THE LOOP', async () => {
        // THE test. A stale lastActivity is what SessionActivityTracker reads
        // to decide the session is idle, so it is the thing a user "stuck in a
        // login loop" most needs cleared.
        window.localStorage.setItem('lastActivity', '1');
        window.sessionStorage.setItem('anything', 'x');

        render(<HardLogoutButton />);
        await userEvent.click(screen.getByRole('button'));

        await waitFor(() => expect(mockLogoutAction).toHaveBeenCalled());
        expect(window.localStorage.getItem('lastActivity')).toBeNull();
        expect(window.sessionStorage.getItem('anything')).toBeNull();
    });

    it('PRESERVES the offline briefing registration, which is unsent user data', async () => {
        // The counterpart guard. localStorage.clear() would satisfy the test
        // above and destroy this.
        window.localStorage.setItem('wave_briefing_pending_sync', '{"fullName":"A"}');
        window.localStorage.setItem('lastActivity', '1');

        render(<HardLogoutButton />);
        await userEvent.click(screen.getByRole('button'));

        await waitFor(() => expect(mockLogoutAction).toHaveBeenCalled());
        expect(window.localStorage.getItem('wave_briefing_pending_sync'))
            .toBe('{"fullName":"A"}');
        expect(window.localStorage.getItem('lastActivity')).toBeNull();
    });

    it('clears BEFORE awaiting the action, because signOut navigates away', async () => {
        // logoutAction ends in signOut(), which redirects. Anything sequenced
        // after the await may never run, so the clear cannot live there.
        let clearedWhenCalled: string | null = 'not-called';
        mockLogoutAction.mockImplementation(() => {
            clearedWhenCalled = window.localStorage.getItem('lastActivity');
            return Promise.resolve();
        });
        window.localStorage.setItem('lastActivity', '1');

        render(<HardLogoutButton />);
        await userEvent.click(screen.getByRole('button'));

        await waitFor(() => expect(mockLogoutAction).toHaveBeenCalled());
        expect(clearedWhenCalled).toBeNull();
    });

    it('still signs out even when the browser refuses storage access', async () => {
        // Private mode and blocked-cookie settings throw on access. A logout
        // must not fail because a clear did.
        const spy = jest.spyOn(window.localStorage.__proto__, 'removeItem')
            .mockImplementation(() => { throw new Error('SecurityError'); });
        try {
            render(<HardLogoutButton />);
            await userEvent.click(screen.getByRole('button'));
            await waitFor(() => expect(mockLogoutAction).toHaveBeenCalled());
        } finally {
            spy.mockRestore();
        }
    });

    it('the helper is callable on its own and is the one the handler uses', () => {
        window.localStorage.setItem('lastActivity', '1');
        clearClientSessionState();
        expect(window.localStorage.getItem('lastActivity')).toBeNull();
        expect(source(BUTTON)).toContain('clearClientSessionState();');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#337 — the fallback stays in this deployment', () => {
    it('NO HARD-CODED PRODUCTION HOST REMAINS', () => {
        // THE second test. An absolute host here sends a staging or local user
        // to production on a failed logout.
        expect(source(BUTTON)).not.toContain('https://easysalesexport.com');
        expect(source(BUTTON)).not.toMatch(/window\.location\.href\s*=\s*['"]https?:/);
    });

    it('and the fallback is a relative path', () => {
        expect(source(BUTTON)).toMatch(/window\.location\.href = '\/auth\/login'/);
    });

    it('VACUITY GUARD: the component still renders and still logs out', async () => {
        // Every assertion above is about absent text; this is the one that
        // fails if the component were emptied.
        render(<HardLogoutButton />);
        const button = screen.getByRole('button');
        expect(button).toBeInTheDocument();
        await userEvent.click(button);
        await waitFor(() => expect(mockLogoutAction).toHaveBeenCalledTimes(1));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#337 — the two key lists are the record of the decision', () => {
    it('names what is cleared and what is kept', () => {
        expect([...SESSION_STORAGE_KEYS_CLEARED]).toContain('lastActivity');
        expect([...CLIENT_KEYS_PRESERVED]).toContain('wave_briefing_pending_sync');
    });

    it('and the preserved key really is an offline queue, not a preference', () => {
        // If this stops being unsent data, the preservation should be
        // revisited rather than carried on by habit.
        const briefing = source('src/app/wave/briefing/page.tsx');
        expect(briefing).toContain('wave_briefing_pending_sync');
        expect(briefing).toMatch(/!navigator\.onLine/);
        expect(briefing).toContain('registerForBriefingAction');
    });

    it('the cleared key really is the session idle timer', () => {
        const tracker = source('src/components/auth/SessionActivityTracker.tsx');
        expect(tracker).toContain('lastActivity');
        expect(tracker).toMatch(/timeSinceActivity/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#337 — the route guard points at enforcement that exists', () => {
    it('NO LONGER CLAIMS ENFORCEMENT AT A PATH THAT DOES NOT EXIST', () => {
        const raw = readFileSync(GUARD, 'utf-8');

        // The false CLAIM, verbatim — not the path itself. The correction has
        // to quote the old path to explain it, so asserting the path is absent
        // would fail on the tombstone rather than on a regression.
        expect(raw).not.toContain(
            'Protected routes inside /marketplace/(member)/ continue to enforce access');

        // And the segment really is absent from the app.
        const { existsSync } = require('fs');
        expect(existsSync('src/app/marketplace/(member)')).toBe(false);
    });

    it('and names the two layouts that do the enforcing', () => {
        const raw = readFileSync(GUARD, 'utf-8');
        expect(raw).toContain('marketplace/seller/layout.tsx');
        expect(raw).toContain('marketplace/buyer/layout.tsx');
    });

    it('which really do gate on module access and really do fail closed', () => {
        for (const layout of [
            'src/app/marketplace/seller/layout.tsx',
            'src/app/marketplace/buyer/layout.tsx',
        ]) {
            const src = source(layout);
            expect(src).toContain('requireHubRegistration');
            expect(src).toContain('checkModuleAccess');
            // The catch redirects rather than rendering the page.
            expect(src).toMatch(/catch[\s\S]{0,200}redirectPath =/);
        }
    });
});
