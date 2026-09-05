/**
 * @jest-environment jsdom
 */

/**
 *   #416 TWO NOTIFICATION BADGES FOR ONE FACT, COUNTED DIFFERENTLY — AND THE
 *   BIGGER ONE COULD NOT BE CLEARED.
 *
 *   From the untested-module sweep: useUnreadNotifications and
 *   usePushPermissionState were the last two hooks no test named.
 *
 *   TWO COUNTS, TWO RULES, TWO WINDOWS.
 *
 *     NotificationCenter's bell   unread among the 50 it fetched, AFTER
 *                                 isNotificationVisible drops modules the
 *                                 member is not subscribed to
 *     DashboardNav's badge        getMyUnreadNotificationCount — a server-side
 *                                 .count() over EVERY unread row, unfiltered
 *
 *   Both are on the dashboard at the same time. A member subscribed to one
 *   module with unread rows from another saw two different numbers side by
 *   side, and the larger one had no way down: opening the panel marks the
 *   VISIBLE ones read, so the unfiltered count stayed up forever. A badge
 *   counting things the panel will not show is a badge you cannot clear.
 *
 *   #390's class with a symptom you can see. The rule is stated once now — same
 *   window (NOTIFICATION_BADGE_WINDOW), same isNotificationVisible, same
 *   registrations and roles off the session — so the two agree by construction.
 *
 *   AND THE PANEL SAID "NO NOTIFICATIONS YET" WHEN IT COULD NOT READ THEM. The
 *   fetch failure was a bare console.error; the list stayed empty and the empty
 *   state rendered. #307/#408's class, in the notification centre itself. It now
 *   distinguishes the two, and keeps rows it already has when a later poll
 *   fails.
 *
 *   AND usePushPermissionState IS A HOOK FOR A FEATURE THAT DOES NOT EXIST.
 *   Nothing imports it, and there is no service worker, no pushManager, no
 *   subscription store, no sender, no web-push dependency — this file is the
 *   only mention of the Notification API in src. Kept, not deleted, with a
 *   header saying what is missing: wiring the banner alone would ask every
 *   member for a permission the platform can never use, and a denied permission
 *   is not re-askable. #384's class.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the count drops the visibility filter        KILLED
 *     the count drops the shared window            KILLED
 *     the panel calls a failed read empty again    KILLED
 *     the hook resets the count to 0 on failure    KILLED
 *     reword the header prose                      SURVIVED, as intended
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { renderHook, waitFor, act } from '@testing-library/react';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { useUnreadNotifications } from '@/hooks/useUnreadNotifications';
import { getMyUnreadNotificationCount } from '@/app/actions/my-data';
import { NOTIFICATION_BADGE_WINDOW, isNotificationVisible } from '@/lib/notification-filter';

jest.mock('@/app/actions/my-data', () => ({
    getMyUnreadNotificationCount: jest.fn(),
}));

const asMock = getMyUnreadNotificationCount as unknown as jest.Mock;

const ROOT = process.cwd();
const code = (p: string) => stripComments(readFileSync(join(ROOT, p), 'utf-8'), { label: relative(ROOT, p) });

/** Every .ts/.tsx under a directory, tests excluded. */
function walk(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) {
            if (name === '__tests__' || name === 'node_modules') continue;
            out.push(...walk(full));
        } else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) {
            out.push(full);
        }
    }
    return out;
}

const PANEL = 'src/components/layout/NotificationCenter.tsx';
const ACTION = 'src/app/actions/my-data.ts';
const PUSH = 'src/hooks/usePushPermissionState.ts';

beforeEach(() => { asMock.mockReset(); });

// ─────────────────────────────────────────────────────────────────────────────
describe('#416 — one rule, one window, two badges', () => {
    it('THE COUNT APPLIES THE SAME VISIBILITY FILTER THE PANEL DOES', () => {
        const src = code(ACTION);
        // Not a bare .count() over every unread row any more.
        expect(src).not.toMatch(/where\("read", "==", false\)\s*\.count\(\)/);
        expect(src).toMatch(/isNotificationVisible\(/);
        expect(src).toMatch(/\.limit\(NOTIFICATION_BADGE_WINDOW\)/);
    });

    it('and the panel reads the same window from the same constant', () => {
        expect(code(PANEL)).toMatch(/getMyNotifications\(NOTIFICATION_BADGE_WINDOW\)/);
        expect(NOTIFICATION_BADGE_WINDOW).toBe(50);
    });

    it('and the filter it shares actually discriminates — otherwise none of this matters', () => {
        /**
         * The premise. If isNotificationVisible admitted everything, the two
         * counts would have agreed all along and the finding would be wrong.
         */
        const noSubscriptions = undefined;
        const wave = { wave: { status: 'approved' } };
        // A module-specific type is hidden without the subscription…
        // ('wave' — the map is keyed on the coarse type, not on an event name.)
        expect(isNotificationVisible('wave', noSubscriptions, [])).toBe(false);
        expect(isNotificationVisible('wave', { academy: { status: 'approved' } }, [])).toBe(false);
        // …and shown with it.
        expect(isNotificationVisible('wave', wave, [])).toBe(true);
        // An admin sees everything, which is why the count reads roles too.
        expect(isNotificationVisible('wave', noSubscriptions, ['admin'])).toBe(true);
        // And a universal type is never filtered.
        expect(isNotificationVisible('payment', noSubscriptions, [])).toBe(true);
    });

    it('and the count reads registrations AND roles off the session, not a parameter', () => {
        // Rule 1 of this module: never accept a userId from the browser.
        const src = code(ACTION);
        expect(src).toMatch(/export async function getMyUnreadNotificationCount\(\): Promise<number>/);
        expect(src).toMatch(/serviceRegistrations \?\? null/);
        expect(src).toMatch(/\.roles \?\? null/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#416 — the browser hook behind the nav badge', () => {
    it('REPORTS THE SERVER COUNT AND STOPS LOADING', async () => {
        asMock.mockResolvedValue(3);
        const { result } = renderHook(() => useUnreadNotifications('u1'));
        await waitFor(() => expect(result.current.unreadCount).toBe(3));
        expect(result.current.isLoading).toBe(false);
    });

    it('and does not poll at all without a signed-in user', async () => {
        const { result } = renderHook(() => useUnreadNotifications(undefined));
        await waitFor(() => expect(result.current.isLoading).toBe(false));
        expect(asMock).not.toHaveBeenCalled();
        expect(result.current.unreadCount).toBe(0);
    });

    it('and a FAILED poll does not wipe the count it already had', async () => {
        /**
         * The badge is the only signal a member has that something is waiting.
         * Resetting it to 0 on a transient failure is #408's shape: telling
         * somebody there is nothing when the truth is that we could not look.
         */
        asMock.mockResolvedValueOnce(4).mockRejectedValue(new Error('socket hang up'));

        // Every value the hook has EVER produced, not just the one at the end:
        // asserting only the final value passed even with a `setUnreadCount(0)`
        // in the catch, because the assertion ran before the rejection settled.
        const seen: number[] = [];
        const { result, rerender } = renderHook(
            (p: { id: string | undefined }) => {
                const r = useUnreadNotifications(p.id);
                seen.push(r.unreadCount);
                return r;
            },
            { initialProps: { id: 'u1' as string | undefined } },
        );
        await waitFor(() => expect(result.current.unreadCount).toBe(4));

        // A dependency change re-runs the effect, which is a real second poll —
        // a bare rerender() leaves the deps unchanged and tests nothing.
        rerender({ id: 'u1-again' });
        await waitFor(() => expect(asMock).toHaveBeenCalledTimes(2));
        // …and let the rejection actually land before looking.
        await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

        expect(result.current.unreadCount).toBe(4);
        // Never dipped to zero on the way.
        expect(seen.slice(seen.indexOf(4))).toEqual(seen.slice(seen.indexOf(4)).map(() => 4));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#416 — a failed read is not an empty inbox', () => {
    it('THE PANEL DISTINGUISHES "COULD NOT LOAD" FROM "NONE YET"', () => {
        const src = code(PANEL);
        expect(src).toMatch(/setLoadFailed\(true\)/);
        expect(src).toMatch(/setLoadFailed\(false\)/);
        expect(src).toMatch(/loadFailed && visibleNotifications\.length === 0/);
        expect(src).toMatch(/We could not load your notifications/);
        // …and the empty state is still there for the case that really is empty.
        expect(src).toMatch(/No notifications yet/);
    });

    it('and the failure branch does not blank rows it already had', () => {
        // setNotifications is not called in the catch.
        const src = code(PANEL);
        const catchBlock = src.slice(src.indexOf('} catch (err)'), src.indexOf('} finally {'));
        expect(catchBlock).not.toMatch(/setNotifications/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#416 — the push hook has no feature behind it', () => {
    it('NOTHING IN THIS REPOSITORY IMPLEMENTS BROWSER PUSH', () => {
        /**
         * Pinned so that the day somebody adds a service worker or a
         * subscription store, this test fails and points them at the hook that
         * has been waiting — rather than the hook being wired on its own and
         * asking members for a permission nothing can use.
         */
        // Code, not prose: the header names these three, so the scan runs on
        // comment-stripped source. (Two suites in this audit have tripped on
        // their own write-up; this is the third time it has been avoided by
        // stripping rather than by rewording.)
        expect(code(PUSH)).toMatch(/window\.Notification\.permission/);
        // The finding is recorded in the file itself — raw, since it is a note.
        expect(readFileSync(join(ROOT, PUSH), 'utf-8')).toMatch(/#416/);

        // The other half, absent from the WHOLE of src — the claim the title
        // makes. A repo scan, so adding a service worker anywhere fails here.
        const files = walk(join(ROOT, 'src'));
        for (const marker of ['navigator.serviceWorker', 'pushManager', 'PushSubscription']) {
            const hits = files.filter((f) => code(relative(ROOT, f)).includes(marker));
            expect({ marker, files: hits.map((f) => relative(ROOT, f)) })
                .toEqual({ marker, files: [] });
        }
    });

    it('and it records a dismissal as the browser\'s "denied" — noted, not yet fixed', () => {
        // Recorded honestly: this is wrong, and fixing it in isolation would be
        // fixing the front of a feature whose back does not exist.
        const src = code(PUSH);
        expect(src).toMatch(/localStorage\.setItem\(DISMISSED_KEY, "true"\)/);
        expect(src).toMatch(/setPermissionState\("denied"\)/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#417 — the filter\'s own "future-proof" clause was unreachable', () => {
    it('AN UNCLASSIFIABLE NOTIFICATION IS SHOWN, NOT SILENTLY DROPPED', () => {
        /**
         *   The three tests used to run in the order
         *
         *       if (!serviceRegistrations) return false;   // "hide all
         *                                                  //  module-specific"
         *       if (!MODULE_TYPE_MAP[type]) return true;   // "unknown type —
         *                                                  //  show it"
         *
         *   so for anyone with no serviceRegistrations — every account before
         *   it joins a module — the second line could never run, and a type
         *   nothing recognises was dropped without trace. Found by #416: the
         *   count started applying this filter and an existing fixture of
         *   notifications with NO type went to zero.
         */
        expect(isNotificationVisible('welcome', undefined, [])).toBe(true);
        expect(isNotificationVisible('', undefined, [])).toBe(true);
        expect(isNotificationVisible('some_future_type', null, null)).toBe(true);
    });

    it('and a MODULE type with no subscriptions is still hidden — the rule that was meant', () => {
        expect(isNotificationVisible('wave', undefined, [])).toBe(false);
        expect(isNotificationVisible('escrow', null, [])).toBe(false);
    });

    it('and the ordering is the fix, not a new special case', () => {
        const src = code('src/lib/notification-filter.ts');
        const mapLookup = src.indexOf('const requiredKeys = MODULE_TYPE_MAP[type]');
        const noRegs = src.indexOf('if (!serviceRegistrations) return false');
        expect(mapLookup).toBeGreaterThan(-1);
        expect(noRegs).toBeGreaterThan(-1);
        // The classification happens BEFORE the subscription check.
        expect(mapLookup).toBeLessThan(noRegs);
    });

    it('and it is latent today — every type this codebase writes is in one of the two sets', () => {
        /**
         * Stated as a fact that can go stale rather than as prose: the union in
         * createNotificationAction is the vocabulary, and every member of it is
         * either universal or mapped. A twelfth type added there without a home
         * fails here, which is exactly when somebody should think about it.
         */
        const src = code('src/app/actions/notifications.ts');
        const m = src.match(/type:\s*((?:"[a-z_]+"\s*\|\s*)+"[a-z_]+");/);
        expect(m).not.toBeNull();
        const written = m![1].split('|').map((s) => s.trim().replace(/"/g, ''));
        expect(written.length).toBeGreaterThanOrEqual(11);

        /**
         * Read against the filter's own two tables rather than through its
         * behaviour: after #417 an UNCLASSIFIED type and a UNIVERSAL one both
         * answer `true` for a user with no registrations, so behaviour alone
         * cannot tell them apart — an assertion built on it would be a check
         * that cannot fail, which is #331's shape and was the first draft here.
         */
        const filter = code('src/lib/notification-filter.ts');
        const universal = new Set(
            [...filter.matchAll(/^\s{4}"([a-z_]+)",$/gm)].map((x) => x[1]),
        );
        const mapped = new Set(
            [...filter.matchAll(/^\s{4}([a-z_]+):\s*\[/gm)].map((x) => x[1]),
        );
        expect(universal.size).toBeGreaterThanOrEqual(12);
        expect(mapped.size).toBeGreaterThanOrEqual(10);

        const homeless = written.filter((type) => !universal.has(type) && !mapped.has(type));
        expect({ homeless }).toEqual({ homeless: [] });
    });
});
