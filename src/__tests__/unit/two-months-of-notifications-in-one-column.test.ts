/**
 * @jest-environment node
 */

/**
 *   #534 NOTHING BOUNDED THE NOTIFICATION LIST, AND NOTHING EVER AGED ONE OUT.
 *
 *   Reported by the owner: "i logged into my account and got all these
 *   notifications why:" — followed by seventy-odd "New WAVE Application" rows
 *   running from two hours ago back to two months ago.
 *
 *   Traced end to end, and none of it is a bug in WAVE:
 *
 *     _wv_applications  every submission calls notifyAdmins
 *     notifyAdmins      queries every admin AND every super_admin and writes
 *                       ONE ROW PER ADMIN PER APPLICATION
 *     nothing           no cron ages a notification out. purgeOldAuditLogs
 *                       exists for audit rows and chatbot-db has its own
 *                       purge; NOTIFICATIONS has never had one, so every row
 *                       ever written to a member is still there
 *     the screen        asked for 200 and rendered all of them, on an
 *                       eight-second poll, with no window and no paging
 *
 *   So the notifications were not new and nothing had gone wrong at 2am. The
 *   platform simply had no answer to "how many of these should a person see at
 *   once", and the answer it used by default was "all of them".
 *
 * ── AND THE SERVICE READ WAS NOT BOUNDED AT ALL ─────────────────────────────
 *
 *       .where("userId","==",userId).orderBy("createdAt","desc").get()
 *
 *   No `.limit()`. The adapter caps an unlimited query at DEFAULT_QUERY_LIMIT
 *   and sets `truncated` on the snapshot, which nothing here read — so the
 *   function said "all the notifications" and meant "the newest five thousand".
 *   Its action has no caller, which is not a reason to leave it: every export of
 *   a `"use server"` module is a live POST endpoint (#374, #379).
 *
 * ── THE ONE THAT WOULD HAVE LIED ABOUT ITSELF ───────────────────────────────
 *
 *   markAllAsRead ran the same unbounded query and then finished with
 *
 *       await db.collection(USERS).doc(userId).set({ unreadCount: 0 })
 *
 *   unconditionally. Past the cap that marks five thousand, leaves the rest
 *   unread, and writes a counter saying none are — and getUnreadCount TRUSTS
 *   that counter, recounting only when the field is absent. The badge would have
 *   read zero for ever over thousands of unread rows.
 *
 *   NOBODY IS PAST THE CAP TODAY. The owner's own account is in the low
 *   hundreds. It is fixed because the shape is the one this audit keeps finding
 *   — a bounded read used as if complete, and a derived figure written from it —
 *   and stating that it has not fired is part of the finding rather than a
 *   reason to skip it.
 *
 * ── WHAT WAS DELIBERATELY NOT DONE ──────────────────────────────────────────
 *
 *   NOT ONE ROW IS DELETED, and no ageing job was added. The obvious shape for
 *   one is an `archived` flag set after N days, and it needs a schema field the
 *   existing rows do not have: a reader filtering on `archived == false` would
 *   make every notification written before today vanish, and a backfill of live
 *   data is not something this audit does from here. The flood is solved by the
 *   QUERY instead — a window plus a cursor — which needs no new field, no
 *   backfill, and destroys nothing. The owner's standing rule is that data is
 *   kept, and "show older" keeps it one click away rather than gone.
 *
 *   notifyAdmins STILL WRITES ONE ROW PER ADMIN. That is what an in-app
 *   notification is; the alternative is a shared feed with per-admin read state,
 *   which is a feature rather than a fix.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the service read unbounded again                 KILLED
 *     hasMore always false                             KILLED
 *     the cursor ignored                               KILLED
 *     markAllAsRead zeroing after a truncated sweep     KILLED
 *     the page back to a flat 200                      KILLED
 *     reword this header                               SURVIVED, as intended
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';
import { getUserNotifications, markAllAsRead } from '@/infrastructure/notifications/service';
// #534 The window size is in a client-safe module — see the note there. The
// screen is "use client" and may not reach the service.
import { NOTIFICATION_PAGE_SIZE } from '@/lib/notification-filter';

const ROOT = process.cwd();
const code = (p: string) => stripComments(readFileSync(join(ROOT, p), 'utf-8'), { label: p });

const SERVICE = 'src/infrastructure/notifications/service.ts';
const PAGE = 'src/app/dashboard/notifications/NotificationsClient.tsx';

const ME = 'admin-1';
let store: FakeDbHandle;

/** n notifications, newest last by id so the ordering is checkable. */
function seedNotifications(n: number, opts: { read?: boolean } = {}): void {
    for (let i = 0; i < n; i++) {
        store.seed(COLLECTIONS.NOTIFICATIONS, `n-${String(i).padStart(4, '0')}`, {
            userId: ME,
            type: 'wave',
            title: 'New WAVE Application',
            message: `application ${i}`,
            read: opts.read ?? false,
            // Ascending, so `desc` puts the highest index first.
            createdAt: new Date(1_700_000_000_000 + i * 60_000).toISOString(),
        });
    }
}

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#534 — the list is a page, not a history', () => {
    it('A HUNDRED NOTIFICATIONS COME BACK AS ONE PAGE', async () => {
        //   THE test. The owner had months of these and the read handed back
        //   every one of them.
        seedNotifications(100);

        const page = await getUserNotifications(ME);

        expect(page.notifications).toHaveLength(NOTIFICATION_PAGE_SIZE);
        expect(page.hasMore).toBe(true);
    });

    it('AND THE LAST PAGE SAYS SO', async () => {
        //   The vacuity guard on hasMore: a value that is always true is as
        //   useless as one that is always false.
        seedNotifications(NOTIFICATION_PAGE_SIZE);

        const page = await getUserNotifications(ME);

        expect(page.notifications).toHaveLength(NOTIFICATION_PAGE_SIZE);
        expect(page.hasMore).toBe(false);
    });

    it('AND AN EMPTY ACCOUNT IS NOT "THERE ARE MORE"', async () => {
        const page = await getUserNotifications(ME);

        expect(page.notifications).toEqual([]);
        expect(page.hasMore).toBe(false);
    });

    it('AND NEWEST FIRST, WHICH IS WHAT MAKES A WINDOW HONEST', async () => {
        //   A page is only defensible if it is the page a person wants. Ordered
        //   the other way, "the first twenty-five" would be the oldest.
        seedNotifications(40);

        const page = await getUserNotifications(ME);

        expect((page.notifications[0] as any).message).toBe('application 39');
    });

    it('AND A CALLER MAY ASK FOR MORE, WITHIN A CEILING', async () => {
        //   The limit is clamped: an unbounded read is what this finding is
        //   about, so a caller cannot ask for one by passing a large number.
        seedNotifications(300);

        expect((await getUserNotifications(ME, { limit: 60 })).notifications).toHaveLength(60);
        expect((await getUserNotifications(ME, { limit: 100_000 })).notifications).toHaveLength(200);
    });

    it('AND THE SECOND PAGE STARTS WHERE THE FIRST STOPPED', async () => {
        //   The cursor, executed. Without this the "Show older" control could
        //   hand back the same twenty-five for ever and every assertion above
        //   would still pass.
        seedNotifications(60);

        const first = await getUserNotifications(ME);
        const cursor = (first.notifications[first.notifications.length - 1] as any).createdAt;
        const second = await getUserNotifications(ME, { before: cursor });

        expect(second.notifications).toHaveLength(NOTIFICATION_PAGE_SIZE);
        const firstIds = first.notifications.map((n: any) => n.id);
        for (const n of second.notifications as any[]) {
            expect(firstIds).not.toContain(n.id);
        }
        expect((second.notifications[0] as any).message).toBe('application 34');
    });

    it('and the service no longer reads without a limit', () => {
        const src = code(SERVICE);
        const fn = src.slice(src.indexOf('export async function getUserNotifications'));

        expect(fn.slice(0, 900)).toContain('.limit(limit + 1)');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#534 — marking all read does not claim a zero it has not earned', () => {
    it('A COMPLETE SWEEP MARKS EVERYTHING AND ZEROES THE COUNT', async () => {
        seedNotifications(10);
        store.seed(COLLECTIONS.USERS, ME, { unreadCount: 10 });

        const res = await markAllAsRead(ME);

        expect(res.success).toBe(true);
        expect((res.data as any).truncated).toBe(false);
        expect((store.get(COLLECTIONS.USERS, ME) as any).unreadCount).toBe(0);
        expect((store.get(COLLECTIONS.NOTIFICATIONS, 'n-0005') as any).read).toBe(true);
    });

    it('AND IT SAYS SO WHEN THERE WAS NOTHING TO DO', async () => {
        //   The pre-existing behaviour that has to survive: an account with no
        //   unread rows still has its counter corrected to 0.
        store.seed(COLLECTIONS.USERS, ME, { unreadCount: 7 });

        expect((await markAllAsRead(ME)).success).toBe(true);
        expect((store.get(COLLECTIONS.USERS, ME) as any).unreadCount).toBe(0);
    });

    it('AND THE SWEEP IS THE ADAPTER\'S HONEST ONE, WHICH REPORTS ITS CEILING', () => {
        //   The read was a bare .get(), silently capped at DEFAULT_QUERY_LIMIT,
        //   and the zero was written regardless. `.all()` is the escape hatch
        //   that sets `truncated`, and the code reads it now.
        const src = code(SERVICE);
        const fn = src.slice(src.indexOf('export async function markAllAsRead'));

        expect(fn.slice(0, 2000)).toContain('.all()');
        expect(fn.slice(0, 3000)).toContain('if (snapshot.truncated)');
    });

    it('AND THE ZERO IS INSIDE THE COMPLETE BRANCH, NOT AFTER IT', () => {
        //   Position, not presence — the same check #532 needed. A truncation
        //   test written ABOVE an unconditional zero would read as a fix and be
        //   none.
        const src = code(SERVICE);
        const fn = src.slice(src.indexOf('export async function markAllAsRead'));
        const guard = fn.indexOf('if (snapshot.truncated) {', fn.indexOf('chunkSize'));
        const zero = fn.indexOf('unreadCount: 0', guard);
        const recount = fn.indexOf('.count()', guard);

        expect(guard).toBeGreaterThan(-1);
        expect(recount).toBeGreaterThan(guard);
        expect(zero).toBeGreaterThan(recount);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#534 — the screen asks for a window', () => {
    const src = () => code(PAGE);

    it('IT NO LONGER ASKS FOR TWO HUNDRED ROWS', () => {
        //   What the owner saw: two months in one column, refreshed every eight
        //   seconds.
        expect(src()).not.toContain('getMyNotifications(200)');
        expect(src()).toContain('getMyNotifications(pageSize + 1)');
    });

    it('AND IT SHARES THE WINDOW WITH THE SERVICE', () => {
        //   One number, not two. A screen with its own page size and a service
        //   with another is how "show more" ends up skipping rows.
        //
        //   Shared through lib/notification-filter, NOT through the service:
        //   this screen is a "use client" file, and importing the service put
        //   supabase-db into the client bundle. #382's ratchet caught that on
        //   the first full run and was right to.
        expect(src()).toContain('NOTIFICATION_PAGE_SIZE');
        expect(src()).toContain('from "@/lib/notification-filter"');
        expect(src()).not.toContain('@/infrastructure/notifications/service');
        expect(code(SERVICE)).toContain('from "@/lib/notification-filter"');
    });

    it('AND THERE IS A WAY TO THE OLDER ONES', () => {
        //   Nothing is hidden. The rows are still there and still ordered
        //   newest first; this asks for the next page.
        expect(src()).toContain('Show older notifications');
        expect(src()).toContain('setPageSize((n) => n + NOTIFICATION_PAGE_SIZE)');
    });

    it('AND IT IS SHOWN ONLY WHEN THE READ SAID THERE ARE MORE', () => {
        //   A permanent "show more" over a complete list is a control that lies.
        expect(src()).toContain('{!reachedEnd && filter === "all" && (');
    });

    it('and re-reading on a wider window is what the poll depends on', () => {
        //   The effect has to re-run when the window grows, or "show more"
        //   changes a number and fetches nothing.
        //
        //   #558 THIS PINNED THE DEPENDENCY ARRAY VERBATIM — the exact string
        //   `}, [userId, status, router, pageSize]);` — and so it failed when a
        //   FIFTH dependency was added for the server seed. Nothing about the
        //   behaviour it names had changed; the test was pinned to one spelling
        //   of the implementation, which is a defect class this audit has found
        //   several times over.
        //
        //   What it means is that `pageSize` is IN the list. That is what is
        //   asked now, and adding or removing anything else is free.
        const deps = src().match(/\}, \[([^\]]*)\]\);/g) ?? [];
        const pollDeps = deps.find(d => d.includes('userId') && d.includes('status'));

        expect({ found: pollDeps !== undefined }).toEqual({ found: true });
        expect(pollDeps).toContain('pageSize');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#534 — nothing is deleted, and the premise is measured', () => {
    it('NO AGEING JOB DELETES A NOTIFICATION', () => {
        //   The owner's standing rule. If an ageing job is added later it has to
        //   archive, and this fails if one arrives that removes rows instead.
        const src = code(SERVICE);

        expect(src).not.toMatch(/\.delete\(\)/);
    });

    it('AND THE PLATFORM REALLY HAS NO NOTIFICATION PURGE, WHICH IS THE PREMISE', () => {
        //   Measured rather than asserted: audit logs and chatbot rows both have
        //   one, so "there is no cleanup" is a statement about this collection
        //   specifically and it needs checking.
        expect(code('src/lib/audit-log.ts')).toContain('purgeOldAuditLogs');
        expect(code(SERVICE)).not.toMatch(/purge|cleanup|expire/i);
    });

    it('and notifyAdmins still writes one row per admin, deliberately', () => {
        //   Not a defect — it is what an in-app notification is. Pinned so the
        //   finding is not read as having changed the fan-out.
        expect(code('src/lib/admin-notifications.ts')).toContain('createBulkNotifications(');
    });
});
