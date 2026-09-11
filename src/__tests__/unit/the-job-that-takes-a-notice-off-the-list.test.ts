/**
 * @jest-environment node
 */

/**
 *   #650 THE JOB THAT TAKES A NOTICE OFF THE LIST, EXECUTED — AND THE CLAIM
 *        UNDERNEATH IT, CHECKED.
 *
 *   `cron/age-notifications` was the last of the eight scheduled jobs with no
 *   test that calls it. Its siblings are covered; this one was named in a
 *   manifest and run by nothing.
 *
 *   It exists for #615, which is the other half of #534: the owner opened the
 *   notification panel and got two months of "New WAVE Application" in a single
 *   column, back to the first submission, because `notifyAdmins` writes one row
 *   per admin per application and nothing ever aged one out. #534 put a window
 *   on the SCREEN and said plainly that the store still grows without bound.
 *
 * ── THE PREMISE IS THE PART WORTH CHECKING ──────────────────────────────────
 *
 *   The route's header states a fact about code it does not own:
 *
 *       "The reader that feeds the list and the bell skips archived rows."
 *
 *   If that were false the whole job would be a no-op on the only surface it
 *   was built for — `archived: true` written onto rows that keep appearing,
 *   which is #618's silo rule, #623's `finance:refund` and #624's visibility
 *   list all over again: a declaration nothing consults.
 *
 *   IT LOOKED FALSE. `infrastructure/notifications/service.ts` has the paged
 *   reader and the unread count, and NEITHER filters archived rows — the page
 *   query is `where(userId).orderBy(createdAt).limit()`, and the count is
 *   `where(userId).where(read == false).count()`. `isOnTheList`, the shared
 *   predicate the ageing module exports for exactly this, has ONE caller in the
 *   entire codebase.
 *
 *   IT IS TRUE, AND THAT ONE CALLER IS WHY. The bell and the notifications page
 *   both read `getMyNotifications` in actions/my-data.ts, which filters through
 *   `isOnTheList`; the two functions in the service are orphans with no callers
 *   at all. So the premise holds — for one reason, in one place, with nothing
 *   asserting it. It is asserted here now, because "the job is pointless" and
 *   "the job works" are separated by that single `.filter()`.
 *
 *   The over-read in that reader is pinned with it. Archived rows are dropped
 *   AFTER the query, so a page made entirely of archived rows would come back
 *   empty while current ones sat just past the limit; it reads a multiple and
 *   trims. Remove the multiple and this job starts emptying people's panels.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { stripComments } from '@/lib/testing/strip-comments';
import { COLLECTIONS } from '@/lib/types/firestore';
import { NOTIFICATION_ARCHIVE_AFTER_DAYS, isOnTheList } from '@/lib/notification-ageing';

const ROOT = process.cwd();
const code = (rel: string) => stripComments(readFileSync(join(ROOT, rel), 'utf8'), { label: rel });

const SECRET = 'cron-secret-for-tests';
const NOTIFS = COLLECTIONS.NOTIFICATIONS;

let store: FakeDbHandle;

/** `days` ago, as an ISO string. */
const agoISO = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

function seedNotice(id: string, over: Record<string, unknown> = {}): void {
    store.seed(NOTIFS, id, {
        userId: 'member-1',
        type: 'wave',
        title: 'New WAVE Application',
        message: 'Ada Obi applied.',
        link: '/admin/wave/applications',
        read: true,
        createdAt: agoISO(NOTIFICATION_ARCHIVE_AFTER_DAYS.read + 1),
        ...over,
    });
}

const cron = async (auth: string | null = `Bearer ${SECRET}`) => {
    const { GET } = await import('@/app/api/cron/age-notifications/route');
    const req = { headers: { get: (k: string) => (k === 'authorization' ? auth : null) } };
    const res = await GET(req as any);
    return { status: res.status, body: await res.json() as any };
};

const notice = (id: string) => store.get(NOTIFS, id) as Record<string, any>;

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    process.env.CRON_SECRET = SECRET;
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#650 — a notice that has stopped being news comes off the list', () => {
    it('ARCHIVES A READ NOTICE PAST ITS WINDOW', async () => {
        seedNotice('N1');

        const { body } = await cron();

        expect({ archived: body.archived, current: body.current })
            .toEqual({ archived: 1, current: 0 });
        expect(notice('N1').archived).toBe(true);
        expect(typeof notice('N1').archivedAt).toBe('string');
    });

    it('AND KEEPS EVERY FIELD IT HAD — nothing is deleted', async () => {
        /*
         *   The standing rule for this codebase, and the right engineering: a
         *   notification is the only record that somebody was TOLD something,
         *   and destroying that to shorten a list trades a real fact for a
         *   cosmetic one. Clearing the flag has to put the row back.
         */
        seedNotice('N1');

        await cron();

        expect(notice('N1')).toMatchObject({
            userId: 'member-1', type: 'wave', title: 'New WAVE Application',
            message: 'Ada Obi applied.', link: '/admin/wave/applications', read: true,
        });
    });

    it('AND LEAVES A READ NOTICE INSIDE ITS WINDOW ALONE — the control', async () => {
        //   Every assertion above is satisfied by a job that archives whatever
        //   it finds, which would hide notices a member has not finished with.
        seedNotice('N1', { createdAt: agoISO(NOTIFICATION_ARCHIVE_AFTER_DAYS.read - 1) });

        const { body } = await cron();

        expect({ archived: body.archived, current: body.current })
            .toEqual({ archived: 0, current: 1 });
        expect(notice('N1').archived).toBeUndefined();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#650 — and an UNREAD one is given six times as long', () => {
    it('AN UNREAD NOTICE PAST THE READ WINDOW IS STILL CURRENT', async () => {
        /*
         *   THE asymmetry, and the safety-critical direction. #594's note on
         *   this same screen is the reason: "A notification is how this platform
         *   tells somebody an order was disputed, a loan was approved, a
         *   withdrawal failed." Hiding an unread one of those at thirty days
         *   because the read ones are noisy would be the same class of harm as
         *   the blank page that note was written about.
         */
        seedNotice('N1', {
            read: false,
            createdAt: agoISO(NOTIFICATION_ARCHIVE_AFTER_DAYS.read + 1),
        });

        const { body } = await cron();

        expect({ archived: body.archived, current: body.current })
            .toEqual({ archived: 0, current: 1 });
        expect(notice('N1').archived).toBeUndefined();
    });

    it('AND IS ARCHIVED ONCE IT IS GENUINELY HISTORICAL', async () => {
        //   The pair. A window that never closes is not a window, and the pile
        //   #534 is about would keep growing at the unread end.
        seedNotice('N1', {
            read: false,
            createdAt: agoISO(NOTIFICATION_ARCHIVE_AFTER_DAYS.unread + 1),
        });

        const { body } = await cron();

        expect(body.archived).toBe(1);
        expect(notice('N1').archived).toBe(true);
    });

    it('AND A MISSING `read` FIELD IS TREATED AS UNREAD', async () => {
        //   The safe direction for a row written before the field existed:
        //   `read !== true` earns the long window, not the short one.
        seedNotice('N1', {
            read: undefined,
            createdAt: agoISO(NOTIFICATION_ARCHIVE_AFTER_DAYS.read + 10),
        });

        const { body } = await cron();

        expect({ archived: body.archived, current: body.current })
            .toEqual({ archived: 0, current: 1 });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#650 — and the rows it cannot judge are reported, not guessed at', () => {
    it('A NOTICE WITH NO DATE IS LEFT ALONE AND COUNTED', async () => {
        /*
         *   "We cannot tell how old this is" must not become "old enough to
         *   hide". Reported rather than silently skipped, because a growing
         *   `undated` count means rows are arriving without a usable createdAt —
         *   a defect in a WRITER, which this job must not paper over.
         */
        seedNotice('N1', { createdAt: undefined });

        const { body } = await cron();

        expect({ undated: body.undated, archived: body.archived })
            .toEqual({ undated: 1, archived: 0 });
        expect(notice('N1').archived).toBeUndefined();
    });

    it('AND AN UNREADABLE DATE IS UNDATED, NOT EPOCH-OLD', async () => {
        //   The elapsed-time lie toDateOrNull exists to prevent: `new Date("")`
        //   is Invalid, and a NaN comparison would send it either way.
        seedNotice('N1', { createdAt: 'not a date at all' });

        const { body } = await cron();

        expect({ undated: body.undated, archived: body.archived })
            .toEqual({ undated: 1, archived: 0 });
    });

    it('AND A TIMESTAMP OBJECT IS UNDERSTOOD — #605', async () => {
        //   Four date shapes are stored in this codebase. A row is not spared
        //   archiving merely because its timestamp arrived as `{ _seconds }`.
        const secondsAgo = Math.floor(
            (Date.now() - (NOTIFICATION_ARCHIVE_AFTER_DAYS.read + 5) * 86_400_000) / 1000,
        );
        seedNotice('N1', { createdAt: { _seconds: secondsAgo, _nanoseconds: 0 } });

        const { body } = await cron();

        expect({ archived: body.archived, undated: body.undated })
            .toEqual({ archived: 1, undated: 0 });
    });

    it('AND AN ALREADY-ARCHIVED ROW IS NOT WRITTEN AGAIN', async () => {
        //   Idempotence, and the reason a missed run costs latency rather than
        //   correctness. A second pass must not move archivedAt forward.
        seedNotice('N1', { archived: true, archivedAt: '2026-01-01T00:00:00.000Z' });

        const { body } = await cron();

        expect({ alreadyArchived: body.alreadyArchived, archived: body.archived })
            .toEqual({ alreadyArchived: 1, archived: 0 });
        expect(notice('N1').archivedAt).toBe('2026-01-01T00:00:00.000Z');
    });

    it('AND A ROW THAT VANISHED BETWEEN THE READ AND THE WRITE IS NOT COUNTED', async () => {
        /*
         *   #612's rule, executed. `updateExisting` rather than `update`: the
         *   adapter treats an update to a missing row as a silent no-op, so a
         *   row deleted mid-sweep would otherwise be reported as archived — a
         *   count that says work was done when none was.
         */
        seedNotice('N1');
        seedNotice('N2');
        const { supabaseDb } = await import('@/lib/supabase-db');
        const originalGet = (global as any).mockFirestoreGet.getMockImplementation();
        (global as any).mockFirestoreGet.mockImplementation(async (...args: any[]) => {
            const result = await originalGet(...args);
            //   Delete N2 straight after the sweep's single read, so it is in
            //   the snapshot and genuinely gone by the time its write runs.
            //   Through the adapter rather than the store handle, which has no
            //   delete — the first attempt seeded `undefined` over the row,
            //   which is not the same thing and let the write succeed.
            await supabaseDb.collection(NOTIFS).doc('N2').delete();
            return result;
        });

        const { body } = await cron();

        expect(body.archived).toBe(1);
        expect(body.failures).toEqual(['N2: no longer exists']);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#650 — and the run refuses callers', () => {
    it('REFUSES A REQUEST WITHOUT THE SECRET', async () => {
        seedNotice('N1');

        const res = await cron(null);

        expect(res.status).toBe(401);
        expect(notice('N1').archived).toBeUndefined();
    });

    it('AND REFUSES THE WRONG SECRET', async () => {
        seedNotice('N1');

        const res = await cron('Bearer not-the-secret');

        expect(res.status).toBe(401);
        expect(notice('N1').archived).toBeUndefined();
    });

    it('AND FAILS CLOSED WHEN NO SECRET IS CONFIGURED', async () => {
        //   An unset secret must not mean an open endpoint — #645's shape.
        delete process.env.CRON_SECRET;
        seedNotice('N1');

        const res = await cron('Bearer anything');

        expect(res.status).toBe(500);
        expect(notice('N1').archived).toBeUndefined();

        process.env.CRON_SECRET = SECRET;
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#650 — the premise: the list really does skip what this job marks', () => {
    it('THE READER BEHIND THE BELL AND THE PAGE FILTERS THROUGH isOnTheList', () => {
        /*
         *   Without this the job is a declaration nothing consults — rows marked
         *   `archived` that keep appearing, and a member's panel exactly as long
         *   as it was. #618, #623 and #624 are the same shape, and each of them
         *   was a rule that read as authoritative while governing nothing.
         *
         *   Asserted on the ONE reader that matters. The paged reader and the
         *   unread count in infrastructure/notifications/service.ts do NOT filter
         *   archived rows — and they have no callers; both the bell
         *   (NotificationCenter) and /dashboard/notifications read this instead.
         */
        const src = code('src/app/actions/my-data.ts');
        expect(src).toContain('.filter(isOnTheList)');
        expect(src).toContain('from "@/lib/notification-ageing"');
    });

    it('AND BOTH SURFACES REALLY DO READ THAT FUNCTION — a positive control', () => {
        //   Otherwise the assertion above is a statement about a function nobody
        //   calls, which is precisely what the two in the service turned out to
        //   be.
        expect(code('src/components/layout/NotificationCenter.tsx'))
            .toContain('getMyNotifications(');
        expect(code('src/app/dashboard/notifications/NotificationsClient.tsx'))
            .toContain('getMyNotifications(');
    });

    it('AND IT OVER-READS, so a page of archived rows is not an empty page', () => {
        /*
         *   The filter runs AFTER the query, so asking the database for exactly
         *   `max` rows and then dropping the archived ones returns fewer than
         *   asked for — and a member whose newest `max` rows are all archived
         *   gets an empty panel over notices that exist.
         *
         *   This is the assertion that stops this job breaking that reader: the
         *   multiple only matters once something starts writing `archived`, and
         *   this job is that something.
         */
        const src = code('src/app/actions/my-data.ts');
        expect(src).toContain('.limit(max * 3)');
        expect(src).toContain('.slice(0, max)');
    });

    it('AND THE OTHER READER IS EITHER UNUSED OR FILTERS TOO', () => {
        /*
         *   THE TRAP THIS FINDING FOUND WHILE CHECKING THE PREMISE, guarded
         *   where it is rather than rewritten.
         *
         *   `infrastructure/notifications/service.ts` holds what LOOKS like the
         *   canonical paged reader — it carries #534's entire write-up about
         *   reading every notification a user ever received — and it does not
         *   filter archived rows. It is safe today only because nothing calls
         *   it: both surfaces read getMyNotifications instead.
         *
         *   "Safe because nothing calls it" is a property that expires the first
         *   time somebody wires it up, and it is the obvious function to reach
         *   for. So the rule is stated as the disjunction it actually is: that
         *   reader must either stay unused OR consult isOnTheList. Failing this
         *   tells the next person which of the two they have to do.
         */
        const service = code('src/infrastructure/notifications/service.ts');
        const filters = service.includes('isOnTheList');

        const callers = ['src/components/layout/NotificationCenter.tsx',
            'src/app/dashboard/notifications/NotificationsClient.tsx',
            'src/app/dashboard/notifications/page.tsx',
            'src/app/notifications/page.tsx']
            .filter((f) => /getUserNotificationsAction|getUnreadCountAction/.test(code(f)));

        expect({ filters, wiredTo: callers })
            .toEqual({ filters: false, wiredTo: [] });
    });

    it('AND THE PREDICATE ITSELF IS STRICT', () => {
        //   `archived !== true`, not falsy: a row carrying the STRING "true"
        //   stays on the list rather than vanishing on a truthy check.
        expect(isOnTheList({})).toBe(true);
        expect(isOnTheList({ archived: false })).toBe(true);
        expect(isOnTheList({ archived: 'true' as unknown })).toBe(true);
        expect(isOnTheList({ archived: true })).toBe(false);
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored and diffed after each.
 *
 *     MUTANT                                                        RESULT
 *     THE DEFECT: the two windows collapse into one                   KILLED
 *     an unread notice is judged by the read window                   KILLED
 *     a row with no usable date is archived anyway                    KILLED
 *     an already-archived row is swept again                          KILLED
 *     the boundary flips at the window                                KILLED
 *     the route archives without asking the rule                      KILLED
 *     a vanished row is counted as archived — #612 undone             KILLED
 *     the cron secret stops being required                            KILLED
 *     THE PREMISE: the list stops filtering archived rows             KILLED
 *     the reader stops over-reading, so a page of archived is empty   KILLED
 *     isOnTheList becomes a truthy check                              KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                              SURVIVED ✓
 *
 *   The last three are the ones this file exists for. Everything above them
 *   tests the job; those three test whether the job MEANS anything, and they
 *   live in a different module that the job's header makes a claim about. A
 *   suite that stopped at the route would have gone on passing while the thing
 *   it archives stayed on everybody's list.
 *
 *   "The reader stops over-reading" is the one this job could cause on its own.
 *   The filter runs after the query, so it only bites once something starts
 *   writing `archived` — and this job is that something. It was correct before
 *   anything could have noticed.
 *
 * ── NO DEFECT WAS FOUND IN THE ROUTE ────────────────────────────────────────
 *
 *   Both windows, the undated and already-archived paths, the four date shapes,
 *   the #612 vanished-row count and the secret were all correct. Second cron in
 *   a row where the honest result is "it works"; what changes is that it is held
 *   there, and that the cross-module claim in its header is now asserted rather
 *   than believed.
 */
