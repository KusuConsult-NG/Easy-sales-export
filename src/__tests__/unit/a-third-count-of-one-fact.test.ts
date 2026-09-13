/**
 * @jest-environment node
 */

/**
 *   #687 A THIRD COUNT OF ONE FACT, MAINTAINED BY NINE WRITERS, BYPASSED BY
 *   FIVE, AND READ BY NOTHING.
 *
 *   #416 found two notification badges counting one fact differently and made
 *   them agree by construction. There was a third, and it was the one whose
 *   function said it was the truth:
 *
 *       /** Gets the current unread count directly from Firestore truth *\/
 *       export async function getUnreadCount(userId: string): Promise<number> {
 *           const userDoc = await db.collection(USERS).doc(userId).get();
 *           if (userDoc.exists) {
 *               const data = userDoc.data();
 *               if (data && typeof data.unreadCount === "number") {
 *                   return data.unreadCount;          // <- the cached counter
 *               }
 *           }
 *           …count, then BACKFILL the field so this path never runs again
 *       }
 *
 *   It read a DENORMALISED COUNTER and took the real count only when that field
 *   was ABSENT — then wrote the field, so the real count could never run again.
 *
 * ── AND THE COUNTER WAS ALREADY WRONG ───────────────────────────────────────
 *
 *   Nine call sites create notifications through the service, which incremented
 *   it. FIVE go straight to the collection and never did:
 *
 *       app/actions/in-app-broadcast.ts        the in-app broadcast
 *       app/actions/marketplace/_quotes.ts     a new quote request
 *       app/actions/wallet.ts  (twice)         withdrawal approved / declined
 *       lib/marketplace-notifications.ts       the shared helper — 7 callers
 *
 *   Meanwhile markAllAsRead wrote 0. So for any member who had ever cleared
 *   their bell and then been sent a notification down one of those five paths,
 *   this function returned 0 over unread mail. And markNotificationAsRead
 *   decremented with `Math.max(0, current - 1)`, so reading those notifications
 *   dragged the figure further below the truth.
 *
 *   IT WAS HARMLESS ONLY BECAUSE NOTHING CALLED IT. `getUnreadCountAction` is
 *   its only caller and has no callers of its own; both live badges count rows.
 *   That is the whole defect — the obvious-looking function, with the most
 *   authoritative docstring, was the broken one, and the next person needing a
 *   count would have reached for it.
 *
 * ── WHAT WAS DONE ───────────────────────────────────────────────────────────
 *
 *   The rule is stated ONCE, in lib/unread-notification-count.ts, and all three
 *   readers come through it. The service keeps no counter: the increment, the
 *   decrement, the zeroing and the backfill are all gone, which also takes an
 *   extra document read and write off the mark-as-read path and lets
 *   createNotification drop a two-operation batch that #679 established is not
 *   atomic anyway.
 *
 *   THE STORED FIELD IS LEFT WHERE IT IS on user documents that carry it.
 *   Nothing here destroys a record to tidy up, and a stale number nothing reads
 *   costs nothing; what mattered was that it stopped being presented as truth.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';
import { stripComments } from '@/lib/testing/strip-comments';
import { countUnreadNotifications } from '@/lib/unread-notification-count';
import { createNotification, markNotificationAsRead, getUnreadCount }
    from '@/infrastructure/notifications/service';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null,
    setCache: async () => undefined,
    deleteCache: async () => undefined,
    redis: null,
}));

const ROOT = process.cwd();
const code = (rel: string) => stripComments(readFileSync(join(ROOT, rel), 'utf8'), { label: rel });

const ME = 'member-1';
let store: FakeDbHandle;

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
});

/** A notification written the way the five bypassing paths write one. */
const seedDirect = (id: string, read = false) =>
    store.seed(COLLECTIONS.NOTIFICATIONS, id, {
        userId: ME,
        type: 'marketplace',
        title: 'New Quote Request',
        message: 'You have received a new quote request.',
        read,
        createdAt: new Date('2026-09-01T10:00:00Z').toISOString(),
    });

// ─────────────────────────────────────────────────────────────────────────────
describe('#687 — the count comes from the rows, whoever wrote them', () => {
    it('THE DEFECT: a stale counter no longer answers for the rows', async () => {
        /*
         *   THE test. The member has three unread notifications from a path
         *   that never touched the counter, and a counter saying zero because
         *   they cleared their bell earlier. The old getUnreadCount returned
         *   the zero.
         */
        store.seed(COLLECTIONS.USERS, ME, { email: 'me@example.com', unreadCount: 0 });
        seedDirect('n-1');
        seedDirect('n-2');
        seedDirect('n-3');

        expect(await getUnreadCount(ME)).toBe(3);
    });

    it('AND A COUNTER THAT OVERSTATES IS IGNORED THE SAME WAY', async () => {
        //   The other direction, so the fix cannot be "always return more".
        //   A drifted counter is wrong both ways: the decrement is
        //   Math.max(0, n - 1) over increments that did not all happen.
        store.seed(COLLECTIONS.USERS, ME, { email: 'me@example.com', unreadCount: 99 });
        seedDirect('n-1');

        expect(await getUnreadCount(ME)).toBe(1);
    });

    it('AND READ ROWS ARE NOT COUNTED — the rule still has to be right', async () => {
        //   The control on both lines above. "Count every row" would satisfy
        //   them and make the badge uncleanable, which is #416's defect.
        store.seed(COLLECTIONS.USERS, ME, { email: 'me@example.com' });
        seedDirect('n-1', true);
        seedDirect('n-2', false);
        seedDirect('n-3', true);

        expect(await getUnreadCount(ME)).toBe(1);
    });

    it('AND ANOTHER MEMBER\'S MAIL IS NOT COUNTED', async () => {
        //   The second control. The rule reads a userId; a query that dropped
        //   the scope would inflate every badge on the platform.
        store.seed(COLLECTIONS.NOTIFICATIONS, 'theirs', {
            userId: 'someone-else', read: false, type: 'marketplace',
            createdAt: new Date('2026-09-01T10:00:00Z').toISOString(),
        });
        seedDirect('mine');

        expect(await countUnreadNotifications(ME)).toBe(1);
    });

    it('AND THE THREE READERS GIVE ONE ANSWER', async () => {
        /*
         *   The property #416 established for two badges, extended to the third
         *   reader that disagreed with both. Asked of the same store, in the
         *   same breath, so there is no room for them to differ.
         */
        store.seed(COLLECTIONS.USERS, ME, { email: 'me@example.com', unreadCount: 41 });
        seedDirect('n-1');
        seedDirect('n-2');

        const [viaRule, viaService] = await Promise.all([
            countUnreadNotifications(ME),
            getUnreadCount(ME),
        ]);
        expect({ viaRule, viaService }).toEqual({ viaRule: 2, viaService: 2 });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#687 — and nothing maintains a second figure any more', () => {
    it('CREATING A NOTIFICATION WRITES THE NOTIFICATION AND NOTHING ELSE', async () => {
        store.seed(COLLECTIONS.USERS, ME, { email: 'me@example.com' });

        const res = await createNotification({
            userId: ME, type: 'system', title: 'Hello', message: 'Body', link: '/dashboard',
        } as any);

        expect(res.success).toBe(true);
        expect(store.size(COLLECTIONS.NOTIFICATIONS)).toBe(1);
        //   The user document is untouched — no counter appears on it.
        expect((store.get(COLLECTIONS.USERS, ME) as any).unreadCount).toBeUndefined();
        //   And the count is right, derived from the row that was written.
        expect(await countUnreadNotifications(ME)).toBe(1);
    });

    it('AND MARKING ONE READ TOUCHES ONE DOCUMENT', async () => {
        /*
         *   This ran a transaction that read the USER document and wrote it
         *   back, on the hot path, to decrement a counter nothing consulted.
         */
        store.seed(COLLECTIONS.USERS, ME, { email: 'me@example.com' });
        seedDirect('n-1');
        seedDirect('n-2');

        expect((await markNotificationAsRead('n-1', ME)).success).toBe(true);

        expect((store.get(COLLECTIONS.NOTIFICATIONS, 'n-1') as any).read).toBe(true);
        expect((store.get(COLLECTIONS.USERS, ME) as any).unreadCount).toBeUndefined();
        expect(await countUnreadNotifications(ME)).toBe(1);
    });

    it('AND IT STILL REFUSES SOMEBODY ELSE\'S NOTIFICATION', async () => {
        //   The control on the line above: removing the transaction must not
        //   remove the ownership check it also carried.
        store.seed(COLLECTIONS.NOTIFICATIONS, 'theirs', {
            userId: 'someone-else', read: false, type: 'system',
            createdAt: new Date('2026-09-01T10:00:00Z').toISOString(),
        });

        const res = await markNotificationAsRead('theirs', ME);

        expect(res.success).toBe(false);
        expect((store.get(COLLECTIONS.NOTIFICATIONS, 'theirs') as any).read).toBe(false);
    });

    it('AND THE SERVICE NAMES NO COUNTER AT ALL', () => {
        //   The ratchet. An increment added back anywhere in this file
        //   re-creates a second source of truth for a number the rows already
        //   answer.
        expect(code('src/infrastructure/notifications/service.ts')).not.toContain('unreadCount');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#687 — the bypass that made the counter wrong is measured, not assumed', () => {
    /** Every application source file. */
    const sources = (): string[] => {
        const out: string[] = [];
        const walk = (dir: string) => {
            for (const entry of readdirSync(dir)) {
                if (entry === 'node_modules' || entry === '__tests__' || entry === '.next') continue;
                const full = join(dir, entry);
                if (statSync(full).isDirectory()) { walk(full); continue; }
                if (/\.(ts|tsx)$/.test(entry) && !/\.test\./.test(entry)) out.push(full);
            }
        };
        walk(join(ROOT, 'src'));
        return out;
    };

    /**
     *   Files that CREATE a notification directly.
     *
     *   `.add(…)` or `.doc()` with NO argument — an id the adapter generates,
     *   which is what a new row looks like. `.doc(someId)` is a lookup: the
     *   notifications screen and the ageing job both address rows that already
     *   exist, and counting them as writers put two readers on this list the
     *   first time it ran.
     */
    const CREATE = /collection\(\s*COLLECTIONS\.NOTIFICATIONS\s*\)\s*\.\s*(?:add\s*\(|doc\s*\(\s*\))/;
    const directWriters = (): string[] =>
        sources()
            .filter((f) => CREATE.test(stripComments(readFileSync(f, 'utf8'), { label: relative(ROOT, f) })))
            .map((f) => relative(ROOT, f).replace(/\\/g, '/'))
            .sort();

    it('THE SWEEP IS READING THE APPLICATION', () => {
        //   The control for the list below.
        expect(sources().length).toBeGreaterThan(500);
    });

    it('FIVE WRITERS STILL BYPASS THE SERVICE — AND THAT IS NOW HARMLESS', () => {
        /*
         *   Recorded rather than rewired, and the distinction matters.
         *
         *   Routing these five through createNotification would be the OTHER
         *   repair: it would make a counter correct that nothing reads, at the
         *   cost of a second write per notification. Deleting the counter makes
         *   the same five writers correct for free, because the count is taken
         *   from the rows they write.
         *
         *   This list fails when a sixth appears, which is the point: it should
         *   be read alongside this note rather than discovered later.
         */
        expect(directWriters()).toEqual([
            'src/app/actions/in-app-broadcast.ts',
            'src/app/actions/marketplace/_quotes.ts',
            'src/app/actions/wallet.ts',
            'src/infrastructure/notifications/service.ts',
            'src/lib/marketplace-notifications.ts',
        ]);
    });

    it('AND EVERY ONE OF THEM WRITES `read`, WHICH IS WHAT THE COUNT FILTERS ON', () => {
        /*
         *   The half that would make the new rule silently wrong. The adapter
         *   compares as TEXT, so `where("read", "==", false)` does NOT match a
         *   row that has no `read` key — `raw_data->>'read'` is NULL and NULL
         *   is not false. An unread notification missing the field would be
         *   invisible to every badge on the platform.
         *
         *   Measured rather than trusted, because the count now rests on it
         *   entirely: there is no counter left to disagree and give the game
         *   away.
         */
        for (const f of directWriters()) {
            const src = code(f);
            const writes = src.split(new RegExp(CREATE.source, 'g')).slice(1);
            for (const [i, chunk] of writes.entries()) {
                expect({ file: f, write: i, setsRead: /\bread:\s*false\b/.test(chunk.slice(0, 1200)) })
                    .toEqual({ file: f, write: i, setsRead: true });
            }
        }
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored and diffed after each.
 *
 *     MUTANT                                                        RESULT
 *     THE DEFECT: getUnreadCount reads the cached counter again       KILLED
 *     the counter is preferred only when it is non-zero               KILLED
 *     the rule counts every row, read or not                          KILLED
 *     the rule drops the userId scope                                 KILLED
 *     the rule drops the window cap                                   KILLED
 *     createNotification increments a counter again                   KILLED
 *     markNotificationAsRead decrements a counter again               KILLED
 *     markNotificationAsRead loses its ownership check                KILLED
 *     the direct-writer sweep is narrowed to nothing                  KILLED
 *     a direct writer stops setting `read: false`                     KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                              SURVIVED ✓
 *
 * ── WHAT WAS MEASURED, AND WHERE ────────────────────────────────────────────
 *
 *   The notification writers were found by scanning every .ts/.tsx under src
 *   for a write into COLLECTIONS.NOTIFICATIONS, and the service's call sites by
 *   searching for createNotification and createBulkNotifications across the
 *   same tree: nine through the service, five around it. `getUnreadCountAction`
 *   was searched for over the whole application and has no caller, which is the
 *   only reason the wrong number never reached a member.
 */
