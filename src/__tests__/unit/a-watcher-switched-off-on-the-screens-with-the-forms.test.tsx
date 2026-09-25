/**
 * @jest-environment jsdom
 */

/**
 *   #922 A ROUTE GROUP IS NOT PART OF THE URL, AND ONE `.includes('/member')`
 *   TURNED THIS OFF ON HALF THE APPLICATION.
 *
 *   components/common/GlobalScrollWatcher is mounted in app/layout, so it is on
 *   every page, and no test had ever named it. Its own header states its job:
 *   "ensures users on mobile don't miss feedback after submitting forms."
 *
 *   It decided where NOT to run with
 *
 *       EXCLUDED_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'))
 *           && !pathname.includes('/application')
 *           && !pathname.includes('/member')
 *
 *   — a SUBTREE match on /academy, /wave, /marketplace, /cooperatives,
 *   /farm-nation and /export, with two escape hatches.
 *
 * ── THE SECOND HATCH COULD NEVER FIRE ───────────────────────────────────────
 *
 *   Every member area in this app lives in a Next ROUTE GROUP — `(member)`,
 *   `(learner)`, `(app)` — and route groups are stripped from the URL.
 *   `app/farm-nation/(member)/offers/page.tsx` is served at
 *   `/farm-nation/offers`, which contains no `/member`. Measured across all 254
 *   pages: the only URLs containing `/member` are /admin/cooperatives/members and
 *   /admin/wave/members, and /admin was never on the list, so the clause could
 *   not un-exclude a single page. It was written against the filesystem path.
 *
 * ── WHAT IT COST, COUNTED ───────────────────────────────────────────────────
 *
 *       excluded under the subtree rule   122 of 254 pages
 *       excluded under exact match          9 of 254 pages
 *
 *   The 113 in between are the signed-in screens: /academy/dashboard,
 *   /cooperatives/my-savings, /marketplace/seller/dashboard,
 *   /farm-nation/inquiries, /export/portfolio, every orders list, every savings
 *   screen. A component whose purpose is form feedback was off wherever the forms
 *   are.
 *
 * ── AND THE LIST ALREADY THOUGHT IN EXACT MATCHES ───────────────────────────
 *
 *   `/wave/landing` is listed separately although the subtree rule made `/wave`
 *   cover it. That redundancy is the tell: the list names PAGES, as its own
 *   heading says, and the subtree rule was a later accident. Exact match now, and
 *   both hatches go with it — `/academy/application` is simply not equal to
 *   `/academy`.
 *
 *   WIDENING IS SAFE BECAUSE THE GUARD IS STRICT, and that is asserted below
 *   rather than assumed: only role="alert" or data-message, only after a 1.5s
 *   readiness delay, and only when the element is not already on screen. The
 *   subtree exclusion was compensating for an older matcher that fired on bare
 *   colour classes, and that matcher is already gone.
 *
 *   `jest` is the GLOBAL here — see #392 and the note in
 *   a-back-button-that-went-nowhere-and-a-step-you-could-not-see.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { act, render } from '@testing-library/react';
import { stripComments } from '@/lib/testing/strip-comments';
import { ledgerVerdict, LEDGER_HELD } from '@/lib/testing/ledger';

let pathname = '/dashboard';

jest.mock('next/navigation', () => ({
    usePathname: () => pathname,
    useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
    useSearchParams: () => new URLSearchParams(),
}));

import GlobalScrollWatcher from '@/components/common/GlobalScrollWatcher';

const ROOT = process.cwd();
const WATCHER = 'src/components/common/GlobalScrollWatcher.tsx';
const code = (rel: string) =>
    stripComments(readFileSync(join(ROOT, rel), 'utf8'), { label: rel, minRetainedRatio: 0.2 });

const scrollIntoView = jest.fn();

/*
 *   jsdom DOES NOT IMPLEMENT innerText, and the component reads it.
 *
 *   `node.innerText?.trim().length > 0` is `undefined > 0`, which is false — so
 *   without this every positive assertion in this file fails, on correct code,
 *   for a reason that has nothing to do with the component. That is the same
 *   trap as the router mock in
 *   a-back-button-that-went-nowhere-and-a-step-you-could-not-see: a harness gap
 *   and the defect look identical from the assertion's side.
 *
 *   Mirrored onto textContent, which is what innerText gives for the flat error
 *   markup this watcher looks for. Not a claim that the two are equivalent in
 *   general — innerText is layout-aware and textContent is not.
 */
Object.defineProperty(HTMLElement.prototype, 'innerText', {
    configurable: true,
    get(this: HTMLElement) { return this.textContent ?? ''; },
});

beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    document.body.innerHTML = '';
    (Element.prototype as unknown as { scrollIntoView: unknown }).scrollIntoView = scrollIntoView;
    //   Off screen by default, so the "already visible" check does not silently
    //   suppress every assertion below.
    Element.prototype.getBoundingClientRect = () =>
        ({ top: 5_000, bottom: 5_100 }) as DOMRect;
});

afterEach(() => {
    jest.useRealTimers();
});

/** Mount on `path`, let the readiness delay pass, then add `html` to the body. */
async function onPage(path: string, html: string): Promise<void> {
    pathname = path;
    render(<GlobalScrollWatcher />);

    //   The component ignores anything added in the first 1.5 seconds.
    act(() => { jest.advanceTimersByTime(1_600); });

    await act(async () => {
        document.body.insertAdjacentHTML('beforeend', html);
        //   MutationObserver callbacks are microtasks; the scroll itself is
        //   behind a 50ms timeout.
        await Promise.resolve();
        jest.advanceTimersByTime(100);
    });
}

const ALERT = '<div role="alert">Your payment could not be verified</div>';

// ─────────────────────────────────────────────────────────────────────────────
describe('#922 — the watcher runs on the screens that have the forms', () => {
    it('THE CONTROL: it scrolls to an alert on an ordinary signed-in screen', () => {
        //   Every "it is watched now" assertion below is worthless if the happy
        //   path does not work at all.
        return onPage('/dashboard', ALERT).then(() => {
            expect(scrollIntoView).toHaveBeenCalledTimes(1);
        });
    });

    it.each([
        '/academy/dashboard',
        '/cooperatives/my-savings',
        '/marketplace/seller/dashboard',
        '/farm-nation/inquiries',
        '/export/portfolio',
        '/wave/earnings',
    ])('watches %s, which the subtree rule excluded', async (path) => {
        //   Six of the 113 member screens the dead `/member` clause was supposed
        //   to protect. One per module.
        await onPage(path, ALERT);

        expect(scrollIntoView).toHaveBeenCalledTimes(1);
    });

    it.each([
        '/',
        '/wave',
        '/wave/landing',
        '/marketplace',
        '/academy',
        '/cooperatives',
        '/farm-nation',
        '/export',
        '/contact',
    ])('still leaves the public page %s alone', async (path) => {
        //   The nine the list names. `/wave/landing` needs its own entry now that
        //   `/wave` no longer covers its subtree — and it already had one.
        await onPage(path, ALERT);

        expect(scrollIntoView).not.toHaveBeenCalled();
    });

    it('and the two dead-and-accidental clauses are gone', () => {
        const src = code(WATCHER);

        expect(src).toContain('EXCLUDED_PATHS.includes(pathname)');
        expect(src).not.toContain("includes('/member')");
        expect(src).not.toContain("startsWith(p + '/')");
    });

    it('POSITIVE CONTROL: the file was read, not silently empty', () => {
        expect(code(WATCHER)).toContain('export default function GlobalScrollWatcher');
    });

    it('POSITIVE CONTROL: innerText is readable in this environment', () => {
        //   Without the polyfill above, every scroll assertion in this file fails
        //   on correct code. Asserted so a future jsdom that implements innerText
        //   does not leave a silent shim behind.
        const el = document.createElement('div');
        el.textContent = 'Your payment could not be verified';

        expect(el.innerText.trim().length).toBeGreaterThan(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#922 — the strict guard that makes widening safe', () => {
    it('ignores an element with no role and no data-message', () => {
        //   The thing the subtree exclusion was compensating for: stat cards and
        //   table rows appearing during a data load.
        return onPage('/academy/dashboard', '<div class="text-red-600">₦1,240,000</div>')
            .then(() => {
                expect(scrollIntoView).not.toHaveBeenCalled();
            });
    });

    it('accepts data-message as well as role=alert', async () => {
        await onPage('/academy/dashboard', '<div data-message="1">Saved</div>');

        expect(scrollIntoView).toHaveBeenCalledTimes(1);
    });

    it('ignores an empty alert', async () => {
        await onPage('/academy/dashboard', '<div role="alert">   </div>');

        expect(scrollIntoView).not.toHaveBeenCalled();
    });

    it('ignores anything added before the readiness delay has passed', async () => {
        //   The jumpy-page-load guard. Without it, widening the watched set would
        //   scroll on first paint everywhere.
        pathname = '/academy/dashboard';
        render(<GlobalScrollWatcher />);

        await act(async () => {
            document.body.insertAdjacentHTML('beforeend', ALERT);
            await Promise.resolve();
            jest.advanceTimersByTime(100);
        });

        expect(scrollIntoView).not.toHaveBeenCalled();
    });

    it('does not scroll to an alert that is already on screen', async () => {
        //   Why a fixed-position toast costs nothing: it is always in the
        //   viewport.
        Element.prototype.getBoundingClientRect = () =>
            ({ top: 10, bottom: 60 }) as DOMRect;

        await onPage('/academy/dashboard', ALERT);

        expect(scrollIntoView).not.toHaveBeenCalled();
    });

    it('finds an alert nested inside the node that was added', async () => {
        //   How a real form renders it: the error appears inside a wrapper.
        await onPage('/academy/dashboard', `<section><div class="p-4">${ALERT}</div></section>`);

        expect(scrollIntoView).toHaveBeenCalledTimes(1);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#922 — the route-group fact this turned on', () => {
    /** Every page URL the app serves, with (group) segments stripped. */
    function pageUrls(): string[] {
        const urls: string[] = [];
        const walk = (dir: string): void => {
            for (const entry of readdirSync(join(ROOT, dir))) {
                const rel = `${dir}/${entry}`;
                if (statSync(join(ROOT, rel)).isDirectory()) { walk(rel); continue; }
                if (entry !== 'page.tsx') continue;
                const segments = rel
                    .replace(/^src\/app/, '')
                    .replace(/\/page\.tsx$/, '')
                    .split('/')
                    .filter((s) => s && !/^\(.*\)$/.test(s));
                urls.push('/' + segments.join('/'));
            }
        };
        walk('src/app');
        return urls.filter((u) => !u.startsWith('/api')).sort();
    }

    /** EXCLUDED_PATHS, read out of the component rather than restated here. */
    function excludedPaths(): string[] {
        const src = code(WATCHER);
        const list = src.slice(src.indexOf('EXCLUDED_PATHS = ['), src.indexOf('];'));
        const paths = [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]);

        //   A parser that found nothing would make both counts below zero and
        //   both ledgers meaningless.
        expect(paths).toContain('/contact');
        return paths;
    }

    it('NO member-area URL contains "/member", because the group is stripped', () => {
        //   THE fact the dead clause got wrong. Asserted over the real tree, so it
        //   stays true only while the route groups do.
        const withMember = pageUrls().filter((u) => u.includes('/member'));

        expect(withMember).toEqual(['/admin/cooperatives/members', '/admin/wave/members']);
    });

    it('and the member screens really are served without it', () => {
        const urls = pageUrls();

        for (const url of ['/farm-nation/offers', '/wave/earnings', '/academy/progress',
            '/cooperatives/my-savings', '/export/portfolio']) {
            expect(urls).toContain(url);
        }
    });

    it('THE LEDGER — pages this watcher does not run on', () => {
        //   Read off the COMPONENT's list, not a copy of it. A copy would hold at
        //   nine while the component excluded something else entirely — which is
        //   the whole class of defect this file is about.
        const urls = pageUrls();
        const excluded = urls.filter((u) => excludedPaths().includes(u));

        //   Nine, down from 122. Raise this only for a page that is genuinely
        //   public and genuinely should not scroll, and say which.
        expect(ledgerVerdict(excluded.length, 9)).toBe(LEDGER_HELD);
        expect(urls.length).toBeGreaterThan(200);
    });

    it('and the old rule really did exclude 122 of them', () => {
        //   The number in the header, reproduced rather than asserted from memory —
        //   otherwise "122" is a claim nobody can check.
        const old = pageUrls().filter((u) =>
            excludedPaths().some((p) => u === p || u.startsWith(p + '/'))
            && !u.includes('/application') && !u.includes('/member'));

        expect(old.length).toBe(122);
    });
});
