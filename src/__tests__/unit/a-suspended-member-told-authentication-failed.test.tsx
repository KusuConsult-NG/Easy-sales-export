/**
 * @jest-environment jsdom
 */

/**
 *   #927 FOUR EMITTERS WROTE A SPECIFIC REASON AND THE LOGIN SCREEN REPLACED IT
 *   WITH "AUTHENTICATION FAILED."
 *
 *   The batch is app/not-found, app/loading, app/auth/error/page,
 *   app/invite-error/page, app/hub/register/page and
 *   admin/chatbot/[sessionId]/page — six files no test had named.
 *
 *   LoginForm decided what to show with
 *
 *       errorParam in errorMap ? errorMap[errorParam] : errorMap["Default"]
 *
 *   and Default is "Authentication failed." Swept every emitter of
 *   `/auth/login?error=`:
 *
 *       middleware.ts:442            error=SessionError       not a key → generic
 *       lib/hub-guard.ts             requireSession's PROSE   not a key → generic
 *       components/admin/AdminShell  the same prose           not a key → generic
 *       app/hub/register/page        the same prose           not a key → generic
 *
 *   requireSession returns exactly five of those sentences, and one of them is
 *   "Your account has been suspended." So a SUSPENDED MEMBER was told
 *   "Authentication failed." — which reads as a mistyped password. They would try
 *   it again, and again, and never learn the reason. Same for "Account not found"
 *   and for the admin check that asks them to retry.
 *
 * ── THE GENERIC FALLBACK IS RIGHT, AND THAT DECIDES WHICH SIDE IS THE DEFECT ─
 *
 *   The obvious repair — print the text when it is not a known key — is a phishing
 *   hole: `?error=Your%20account%20is%20closed,%20call%20%2B234…` would render an
 *   attacker's sentence in the platform's voice on the screen where people type
 *   their password. LoginForm's refusal to show unknown text is a feature, so the
 *   EMITTERS are wrong to send prose. They send codes now, from one shared list in
 *   lib/auth-error-codes, and `sessionResult.error.error` is untouched — 283 places
 *   read that contract and the prose is still right for an API body.
 *
 * ── AND #921 HAD RECURRED ON THE 404 ────────────────────────────────────────
 *
 *   app/not-found was `onClick={() => window.history.back()}` — no fallback, no
 *   router. That is exactly the no-op #921 fixed in BackButton, on the one page
 *   whose visitors most often arrive from a dead EXTERNAL link, where
 *   history.length is 1. It rendered, looked enabled, and did nothing.
 *
 *   Swapping it to <BackButton> would have imported that component's chevron and
 *   classes into a screen with its own styling, and a sweep found TEN hand-rolled
 *   back calls in all, across seven files. So the RULE moved to lib/go-back and
 *   the presentation stayed each screen's own. Two are fixed here because their
 *   destination was not a judgement call: the 404 already offers Go Home beside
 *   it, and the chatbot thread's button is literally labelled "Back to sessions"
 *   with /admin/chatbot existing. The remaining EIGHT are a ledger.
 *
 *   `jest` is the GLOBAL here, per #392.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, render, screen } from '@testing-library/react';
import { stripComments } from '@/lib/testing/strip-comments';
import { ledgerVerdict, LEDGER_HELD } from '@/lib/testing/ledger';
import {
    AUTH_ERROR_MESSAGES, authErrorCodeFor, authErrorMessageFor,
} from '@/lib/auth-error-codes';
import { goBackOr } from '@/lib/go-back';

const back = jest.fn();
const push = jest.fn();

jest.mock('next/navigation', () => ({
    useRouter: () => ({
        back: (...a: unknown[]) => back(...a),
        push: (...a: unknown[]) => push(...a),
        replace: jest.fn(),
    }),
    useSearchParams: () => new URLSearchParams(),
    usePathname: () => '/',
    useParams: () => ({ sessionId: 's1' }),
}));

jest.mock('@/app/actions/telemetry', () => ({
    logTelemetryAction: jest.fn(async () => undefined),
}));

import NotFound from '@/app/not-found';

const ROOT = process.cwd();
const code = (rel: string) =>
    stripComments(readFileSync(join(ROOT, rel), 'utf8'), { label: rel, minRetainedRatio: 0.2 });

const GUARD = 'src/lib/session-guard.ts';
const LOGIN = 'src/components/auth/LoginForm.tsx';
const EMITTERS = [
    'src/lib/hub-guard.ts',
    'src/components/admin/AdminShell.tsx',
    'src/app/hub/register/page.tsx',
];

beforeEach(() => {
    jest.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#927 — the reason survives the trip to the login screen', () => {
    it('THE DEFECT: every sentence requireSession can return now has a code', () => {
        //   Read off session-guard itself, so a reworded message fails HERE rather
        //   than silently degrading to the generic on a real login screen.
        const guard = code(GUARD);
        const sentences = [...guard.matchAll(/error:\s*"([^"]{12,})"/g)].map((m) => m[1]);

        expect(sentences.length).toBeGreaterThanOrEqual(4);

        for (const sentence of sentences) {
            const mapped = authErrorCodeFor(sentence);
            //   Not the catch-all: each of these is a distinct thing to tell
            //   somebody, which is the whole point of the finding.
            expect({ sentence, code: mapped }).not.toEqual({ sentence, code: 'auth_required' });
            expect(AUTH_ERROR_MESSAGES[mapped]).toBe(sentence);
        }
    });

    it('A SUSPENDED MEMBER is told they are suspended', () => {
        //   The case that made this worth fixing.
        expect(authErrorMessageFor(authErrorCodeFor('Your account has been suspended.')))
            .toBe('Your account has been suspended.');
        expect(authErrorMessageFor('account_suspended')).not.toBe('Authentication failed.');
    });

    it('and the middleware\'s own code is no longer generic either', () => {
        //   middleware.ts:442 sends SessionError when NextAuth crashes decrypting
        //   a session — a real state with a real remedy.
        expect(code('src/middleware.ts')).toContain('/auth/login?error=SessionError');
        expect(authErrorMessageFor('SessionError')).not.toBe('Authentication failed.');
        expect(authErrorMessageFor('SessionError')).toContain('sign in again');
    });

    it('THE CONTROL: an unknown code is still refused, not printed', () => {
        //   This is the security half. Rendering URL text on the password screen in
        //   the platform's voice is a phishing hole, so the generic answer is
        //   correct and must stay.
        expect(authErrorMessageFor('Your account is closed, call +2348000000000'))
            .toBe('Authentication failed.');
        expect(authErrorMessageFor('nonsense')).toBe('Authentication failed.');
    });

    it('and the standard not-signed-in redirect still says nothing', () => {
        //   SessionRequired is deliberately empty: arriving at a guarded page is
        //   not an error to shout about.
        expect(authErrorMessageFor('SessionRequired')).toBe('');
    });

    it('the three prose emitters send a CODE now', () => {
        for (const rel of EMITTERS) {
            const src = code(rel);

            expect(src).toContain('authErrorCodeFor(errorMessage)');
            expect(src).not.toContain('encodeURIComponent(errorMessage)');
        }
    });

    it('and authErrorCodeFor can never return prose', () => {
        //   The guarantee that makes the emitters safe: whatever they pass in, what
        //   comes out is a short code, so nothing can put a sentence in a URL.
        for (const input of ['Your account has been suspended.', 'anything at all',
            '', null, undefined]) {
            const out = authErrorCodeFor(input as string);

            expect(out).toMatch(/^[A-Za-z_]+$/);
            expect(out.length).toBeLessThan(32);
        }
    });

    it('LoginForm reads the shared list rather than its own copy', () => {
        const login = code(LOGIN);

        expect(login).toContain('authErrorMessageFor(errorParam)');
        expect(login).not.toContain('"CredentialsSignin": "Invalid email or password"');
    });

    it('and the messages it always had are unchanged', () => {
        //   The map MOVED; it did not change. #912's lesson.
        expect(authErrorMessageFor('CredentialsSignin')).toBe('Invalid email or password');
        expect(authErrorMessageFor('MissingCSRF'))
            .toBe('Session expired — please refresh the page and try again.');
        expect(authErrorMessageFor('AccessDenied'))
            .toBe('You do not have permission to access that resource.');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#927 — the 404\'s Go Back button goes somewhere', () => {
    it('THE DEFECT: with no history it navigates to the home page', () => {
        //   jsdom reports history.length as 1, which is exactly the state a visitor
        //   arriving from a dead external link is in. This used to call
        //   window.history.back() and do nothing at all.
        render(<NotFound />);
        fireEvent.click(screen.getByRole('button', { name: /Go Back/ }));

        expect(push).toHaveBeenCalledWith('/');
        expect(back).not.toHaveBeenCalled();
    });

    it('and pops history when there IS history', () => {
        const original = window.history.length;
        Object.defineProperty(window.history, 'length', { value: 5, configurable: true });
        try {
            render(<NotFound />);
            fireEvent.click(screen.getByRole('button', { name: /Go Back/ }));

            expect(back).toHaveBeenCalledTimes(1);
            expect(push).not.toHaveBeenCalled();
        } finally {
            Object.defineProperty(window.history, 'length', { value: original, configurable: true });
        }
    });

    it('THE CONTROL: the page still offers Go Home and its popular links', () => {
        render(<NotFound />);

        expect(screen.getByRole('link', { name: /Go Home/ })).toBeTruthy();
        expect(screen.getByText('404')).toBeTruthy();
        expect(screen.getByRole('link', { name: 'Marketplace' })).toBeTruthy();
    });

    it('goBackOr itself always does one or the other', () => {
        //   The rule, asked directly. There is no path through it that leaves a
        //   clicked button doing nothing — which is the entire finding.
        const router = { back: jest.fn(), push: jest.fn() };

        goBackOr(router, '/somewhere');
        expect(router.back.mock.calls.length + router.push.mock.calls.length).toBe(1);
    });

    it('and BackButton shares that rule rather than restating it', () => {
        const button = code('src/components/ui/BackButton.tsx');

        expect(button).toContain('goBackOr(router, fallbackPath)');
        expect(button).not.toContain('window.history.length > 1');
    });

    it('the chatbot thread button goes where its own label says', () => {
        //   "Back to sessions", and /admin/chatbot exists — so this one needed no
        //   judgement about the destination.
        const page = code('src/app/admin/chatbot/[sessionId]/page.tsx');

        expect(page).toContain('goBackOr(router, "/admin/chatbot")');
        expect(page).toContain('Back to sessions');
    });

    it('THE LEDGER — screens still calling back() with no fallback', () => {
        //   Eight call sites across five files, of the TEN the sweep found. Each
        //   needs a per-screen answer to "where does back mean when there is no
        //   history", and deciding that eight times in one pass is how a working
        //   screen starts navigating somewhere wrong. They are reached by
        //   moving around INSIDE the app, so no-history is possible via a bookmark
        //   but is not the normal case — unlike a 404, where it is.
        const REMAINING = [
            'src/app/admin/marketplace/disputes/[id]/page.tsx',
            'src/app/marketplace/seller/products/[id]/edit/EditProductClient.tsx',
            'src/app/marketplace/checkout/page.tsx',
            'src/app/marketplace/sell/create/page.tsx',
            'src/app/dashboard/disputes/new/NewDisputeClient.tsx',
        ];
        const calls = REMAINING.reduce(
            (n, rel) => n + (code(rel).match(/router\.back\(\)/g) ?? []).length, 0);

        //   EIGHT, counted rather than remembered. My first pass at this number
        //   said seven, because EditProductClient carries THREE of them and I
        //   totalled the grep by eye. The ledger caught it, which is what it is for.
        expect(ledgerVerdict(calls, 8)).toBe(LEDGER_HELD);
    });

    it('and the two that were fixed are off it', () => {
        expect(code('src/app/not-found.tsx')).not.toContain('window.history.back()');
        expect(code('src/app/admin/chatbot/[sessionId]/page.tsx')).not.toContain('router.back()');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#927 — the three screens in this batch that were already right', () => {
    it('/invite-error maps exactly the reasons the platform emits', () => {
        //   Five for five, measured both ways — and it is the pattern LoginForm was
        //   missing: a fixed code set, an unknown one falling back to a safe
        //   default, and never the URL's own text on the screen.
        const page = code('src/app/invite-error/page.tsx');

        for (const reason of ['used', 'expired', 'invalid', 'unavailable', 'error']) {
            expect(page).toContain(`${reason}: {`);
        }
        expect(page).toContain('MESSAGES[reason] || MESSAGES["invalid"]');
    });

    it('/auth/error is reached by NextAuth itself, not by app code', () => {
        //   Nothing in the tree links it, which reads like a dead page until you
        //   find `pages.error` in the auth config. Recorded so the next reader does
        //   not delete it.
        expect(code('src/lib/auth.ts')).toContain('error: "/auth/error"');
        expect(code('src/app/auth/error/page.tsx')).toContain('OAuthAccountNotLinked');
    });

    it('and the Edge config has no pages.error, which costs nothing', () => {
        //   auth.config.ts is the Edge half and declares only signIn. The
        //   middleware never relies on pages.error — it catches its own crash and
        //   redirects to /auth/login?error=SessionError — so the asymmetry is
        //   harmless. Pinned rather than "fixed", because adding it would imply the
        //   Edge runtime renders that page, and it does not.
        const edge = code('src/lib/auth.config.ts');

        expect(edge).toContain('signIn: "/auth/login"');
        expect(edge).not.toContain('error: "/auth/error"');
        expect(code('src/middleware.ts')).toContain('/auth/login?error=SessionError');
    });

    it('/loading is a spinner and nothing else', () => {
        const loading = code('src/app/loading.tsx');

        expect(loading).toContain('animate-spin');
        expect(loading).toContain('Loading...');
        //   No data, no props, nothing to get wrong.
        expect(loading).not.toContain('useState');
    });

    it('/hub/register still redirects both ways it always did', () => {
        const page = code('src/app/hub/register/page.tsx');

        expect(page).toContain('/profile?notice=complete-your-hub-registration');
        expect(page).toContain('authErrorCodeFor(errorMessage)');
    });
});
