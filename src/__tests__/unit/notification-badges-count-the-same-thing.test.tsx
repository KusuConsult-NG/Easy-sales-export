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
import { NOTIFICATION_BADGE_WINDOW, FILTER_TAB_TYPES } from '@/lib/notification-filter';

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
/**
 *   #687 The counting rule moved OUT of the action and into one server-only
 *   module, because a THIRD copy of it turned up in the notification service —
 *   a cached `users.unreadCount` that five of the platform's notification
 *   writers never touched. #416's property is unchanged and is now structural:
 *   there is one query to agree with rather than two that happen to match.
 */
const RULE = 'src/lib/unread-notification-count.ts';
const SERVICE = 'src/infrastructure/notifications/service.ts';
const PUSH = 'src/hooks/usePushPermissionState.ts';

beforeEach(() => { asMock.mockReset(); });

// ─────────────────────────────────────────────────────────────────────────────
describe('#416 — one rule, one window, two badges', () => {
    it('THE COUNT READS THE SAME WINDOW THE PANEL DOES', () => {
        const src = code(RULE);
        // Not a bare .count() over every unread row any more — that was the
        // half of #416 that made the nav badge exceed the bell and stay up.
        expect(src).not.toMatch(/where\("read", "==", false\)\s*\.count\(\)/);
        expect(src).toMatch(/\.limit\(NOTIFICATION_BADGE_WINDOW\)/);

        /*
         *   #634 AND SUBTRACTS NOTHING FROM IT.
         *
         *   The other half of #416's repair was to make both badges apply
         *   `isNotificationVisible`, so the two would stop disagreeing. They
         *   did stop disagreeing — on zero. That filter hid module-typed
         *   notifications from members without an active registration for the
         *   module, which is most of the people they are addressed to, so a
         *   buyer with five unread escrow rows had no bell count at all.
         *
         *   Asserted as an absence, because the finding is that there is no
         *   predicate here to get wrong.
         */
        expect(src).not.toMatch(/isNotificationVisible/);
        expect(src).toMatch(/return snap\.docs\.length;/);
    });

    it('and the panel reads the same window from the same constant', () => {
        expect(code(PANEL)).toMatch(/getMyNotifications\(NOTIFICATION_BADGE_WINDOW\)/);
        expect(NOTIFICATION_BADGE_WINDOW).toBe(50);
    });

    it('and BOTH count the same thing over it — unread rows belonging to this user', () => {
        /*
         * The property #416 is actually about, now that neither side filters.
         * The action's query is scoped to the session's own id and to unread,
         * and capped at the window; the panel counts `!n.read` over the same
         * window it fetched. Two ways of writing one number.
         */
        const rule = code(RULE);
        expect(rule).toMatch(/\.where\("userId", "==", userId\)/);
        expect(rule).toMatch(/\.where\("read", "==", false\)/);
        expect(code(PANEL)).toMatch(/notifications\.filter\(\(n\) => !n\.read\)\.length/);
    });

    it('#687 AND THE ACTION DELEGATES RATHER THAN KEEPING ITS OWN COPY', () => {
        /*
         *   The property #416 could only assert by comparing two files is
         *   structural now: the action holds no query of its own to drift.
         *
         *   Asserted in both directions — it calls the rule, and it no longer
         *   carries the query — because "calls the rule" alone would survive a
         *   change that called it and then ignored the answer.
         */
        const action = code(ACTION);
        expect(action).toMatch(/return countUnreadNotifications\(userId\);/);
        const fn = action.slice(action.indexOf('export async function getMyUnreadNotificationCount'));
        const body = fn.slice(0, fn.indexOf('\n}'));
        expect(body).not.toMatch(/COLLECTIONS\.NOTIFICATIONS/);
        expect(body).not.toMatch(/NOTIFICATION_BADGE_WINDOW/);
    });

    it('#687 AND THE SERVICE DELEGATES TO THE SAME RULE, WITH NO CACHED COUNTER', () => {
        /*
         *   THE finding. getUnreadCount read `users.unreadCount` and took the
         *   real count only when that field was ABSENT, then backfilled it so
         *   the real count could never run again — over a counter five
         *   notification writers never incremented and markAllAsRead set to
         *   zero. It returned 0 over unread mail.
         */
        const service = code(SERVICE);
        expect(service).toMatch(/return countUnreadNotifications\(userId\);/);
        expect(service).not.toMatch(/unreadCount/);
    });

    it('and the count takes no userId from the browser', () => {
        // Rule 1 of this module: never accept a userId from the browser. It
        // takes no parameters at all, and reads the id off the session.
        const src = code(ACTION);
        expect(src).toMatch(/export async function getMyUnreadNotificationCount\(\): Promise<number>/);
        expect(src).toMatch(/const userId = session\?\.user\?\.id;/);
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
        expect(src).toMatch(/loadFailed && notifications\.length === 0/);
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
describe('#417/#634 — the clause, and then the rule it belonged to', () => {
    /*
     *   #417 WAS A REAL FINDING INSIDE A RULE THAT SHOULD NOT HAVE EXISTED.
     *
     *   isNotificationVisible ran its three tests in the order
     *
     *       if (!serviceRegistrations) return false;   // "hide all
     *                                                  //  module-specific"
     *       if (!MODULE_TYPE_MAP[type]) return true;   // "unknown type —
     *                                                  //  show it"
     *
     *   so for anyone with no serviceRegistrations — every account before it
     *   joins a module — the second line could never run, and a notification
     *   with no recognisable type was dropped without trace. Reordering the
     *   tests fixed that, and left the other clause doing exactly what it said:
     *   dropping a member's escrow, dispute, export and land notifications
     *   because they hold no registration for the module those came from.
     *
     *   #634 removed the predicate. A notification is written to one userId by
     *   the code that knows why that person should receive it; there is nothing
     *   left for a subscription to overrule.
     *
     *   Pinned as an absence so it cannot come back by a different name — a
     *   file that has no visibility rule and a file that has one nobody calls
     *   look the same from the outside, and only one of them is safe.
     */
    it('NOTHING DECIDES WHETHER A MEMBER MAY SEE THEIR OWN NOTIFICATION', () => {
        const filter = code('src/lib/notification-filter.ts');
        expect(filter).not.toMatch(/isNotificationVisible/);
        expect(filter).not.toMatch(/MODULE_TYPE_MAP/);
        expect(filter).not.toMatch(/serviceRegistrations/);

        // And no caller kept a copy of the rule after the export went away.
        const files = walk(join(ROOT, 'src'));
        const holders = files
            .map((f) => relative(ROOT, f))
            .filter((f) => /isNotificationVisible/.test(code(f)));
        expect({ holders }).toEqual({ holders: [] });
    });

    it('and the type vocabulary is still accounted for — every type has a home or is plainly unclassified', () => {
        /*
         * #417's other assertion, kept and re-aimed. The union in
         * createNotificationAction is this platform's notification vocabulary.
         * It used to be checked against the filter's two tables; it is checked
         * against the TAB table now, so a new type that no tab collects shows
         * up here rather than becoming a row reachable only under "All".
         *
         * Not every type needs a tab — `info`, `success`, `warning`, `error`,
         * `system`, `general` are the panel's own chrome and are listed as the
         * exceptions, by name, so adding a twelfth type does not quietly join
         * them.
         */
        const src = code('src/app/actions/notifications.ts');
        const m = src.match(/type:\s*((?:"[a-z_]+"\s*\|\s*)+"[a-z_]+");/);
        expect(m).not.toBeNull();
        const written = m![1].split('|').map((s) => s.trim().replace(/"/g, ''));
        expect(written.length).toBeGreaterThanOrEqual(11);

        const NO_TAB_BY_DESIGN = ['info', 'success', 'warning', 'error', 'system', 'general'];
        const collected = new Set(Object.values(FILTER_TAB_TYPES).flat());
        const homeless = written.filter((t) => !collected.has(t) && !NO_TAB_BY_DESIGN.includes(t));
        expect({ homeless }).toEqual({ homeless: [] });

        // …and the exceptions list is not a way to empty the check.
        expect(collected.size).toBeGreaterThanOrEqual(12);
    });
});
