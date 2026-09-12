/**
 *   #615 NOTHING AGED A NOTIFICATION OUT, AND ONE SCREEN SHOWED TWO MONTHS OF
 *        THEM IN A SINGLE COLUMN.
 *
 *   #534 recorded the symptom and fixed half of it: "It asked for 200 and
 *   rendered every one, on an eight-second poll. The owner opened it and got two
 *   months of 'New WAVE Application' in a single column, back to the first
 *   submission — notifyAdmins writes one row per admin per application, nothing
 *   ages a notification out, and this screen put no window on what it showed."
 *
 *   That commit put a window on the SCREEN and said plainly the store still
 *   grows without bound. This is the other half, offered there and built now.
 *
 * ── NOTHING IS DELETED ──────────────────────────────────────────────────────
 *
 *   An aged notification is MARKED, not removed: `archived: true` plus
 *   `archivedAt`, every other field untouched, and clearing the flag puts it
 *   back. That is this codebase's standing rule and it is also the right call —
 *   a notification is the only record that somebody was told something, and
 *   destroying that to shorten a list trades a real fact for a cosmetic one.
 *
 * ── TWO WINDOWS, AND THE ASYMMETRY IS THE POINT ─────────────────────────────
 *
 *   A READ notification has done its job; thirty days is generous. An UNREAD one
 *   has not, and #594's note on this very screen is why that matters: "A
 *   notification is how this platform tells somebody an order was disputed, a
 *   loan was approved, a withdrawal failed." So unread rows get six months.
 *
 *   One window for both would have to be the longer one to be safe, and then it
 *   would not solve #534's pile at all, which is mostly read-and-ignored admin
 *   chatter.
 *
 * ── AND A ROW WITH NO DATE IS LEFT ALONE ────────────────────────────────────
 *
 *   Reported as `undated`, never archived. "We cannot tell how old this is" must
 *   not become "old enough to hide" — the elapsed-time lie `toDateOrNull` exists
 *   to prevent, and the one this job would be most likely to commit.
 *
 * ── WHAT THIS DOES NOT DECIDE ───────────────────────────────────────────────
 *
 *   Whether the row should have been written at all. notifyAdmins writes one per
 *   ADMIN per APPLICATION, which is why the pile is the size it is. Changing
 *   that is a product decision about who should be told what; this ages what
 *   exists and does not reduce what arrives, and saying otherwise would leave
 *   the real cause unexamined.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import {
    ageingDecision,
    archivedFields,
    isOnTheList,
    NOTIFICATION_ARCHIVE_AFTER_DAYS,
} from '@/lib/notification-ageing';

const NOW = new Date('2026-09-10T12:00:00.000Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

describe('#615 — when a notification stops being news', () => {
    it('A READ ONE COMES OFF THE LIST AFTER THIRTY DAYS', () => {
        expect(ageingDecision({ read: true, createdAt: daysAgo(31) }, NOW))
            .toMatchObject({ archive: true, allowedDays: 30 });
        expect(ageingDecision({ read: true, createdAt: daysAgo(29) }, NOW))
            .toEqual({ archive: false, reason: 'still_current' });

        //   EXACTLY thirty days is still current — "after thirty days", not "on
        //   the thirtieth". A mutant swapping `>` for `>=` survived until this
        //   line existed, because 29 and 31 agree under both and only the
        //   boundary tells them apart. It is one day on one row, and it is the
        //   difference between a rule and an approximation.
        expect(ageingDecision({ read: true, createdAt: daysAgo(30) }, NOW))
            .toEqual({ archive: false, reason: 'still_current' });
    });

    it('AND AN UNREAD ONE GETS SIX MONTHS, WHICH IS THE WHOLE ASYMMETRY', () => {
        //   The case that makes the two windows worth having. At 31 days a read
        //   row goes and an unread row stays — one number could not do both.
        expect(ageingDecision({ read: false, createdAt: daysAgo(31) }, NOW))
            .toEqual({ archive: false, reason: 'still_current' });
        expect(ageingDecision({ read: false, createdAt: daysAgo(181) }, NOW))
            .toMatchObject({ archive: true, allowedDays: 180 });
        expect(ageingDecision({ read: false, createdAt: daysAgo(180) }, NOW))
            .toEqual({ archive: false, reason: 'still_current' });
    });

    it('AND A ROW WITH NO READ FLAG IS TREATED AS UNREAD', () => {
        //   The safe direction. A row whose `read` never arrived must not be
        //   hidden on the shorter window because a field was missing.
        expect(ageingDecision({ createdAt: daysAgo(31) }, NOW))
            .toEqual({ archive: false, reason: 'still_current' });
        expect(ageingDecision({ read: 'yes' as unknown, createdAt: daysAgo(31) }, NOW))
            .toEqual({ archive: false, reason: 'still_current' });
    });

    it('AND A ROW WITH NO USABLE DATE IS NEVER ARCHIVED', () => {
        for (const bad of [undefined, null, '', 'not a date', {}]) {
            expect(ageingDecision({ read: true, createdAt: bad }, NOW))
                .toEqual({ archive: false, reason: 'no_timestamp' });
        }
    });

    it('AND IT READS ALL FOUR DATE SHAPES, SO A TIMESTAMP IS NOT MISTAKEN FOR NO DATE', () => {
        //   #605's finding, applied. A createdAt that arrived as `{ _seconds }`
        //   would otherwise be reported `undated` for ever and never age out.
        const secs = Math.floor(new Date(daysAgo(400)).getTime() / 1000);
        for (const shape of [
            daysAgo(400),
            new Date(daysAgo(400)),
            new Date(daysAgo(400)).getTime(),
            { seconds: secs },
            { _seconds: secs },
            { toDate: () => new Date(daysAgo(400)) },
        ]) {
            expect(ageingDecision({ read: true, createdAt: shape }, NOW)).toMatchObject({ archive: true });
        }
    });

    it('AND ARCHIVING IS IDEMPOTENT', () => {
        expect(ageingDecision({ read: true, archived: true, createdAt: daysAgo(400) }, NOW))
            .toEqual({ archive: false, reason: 'already_archived' });
    });

    it('THE MARK IS A FLAG, NOT A DELETION, AND IT IS REVERSIBLE', () => {
        const fields = archivedFields(NOW);
        expect(fields).toEqual({ archived: true, archivedAt: NOW.toISOString() });
        //   Nothing that removes anything. If this ever grows a delete, the row
        //   it was recording is gone and cannot be put back.
        expect(Object.keys(fields).sort()).toEqual(['archived', 'archivedAt']);
    });

    it('AND THE LIST FILTERS ON THE SHARED PREDICATE', () => {
        expect(isOnTheList({})).toBe(true);
        expect(isOnTheList({ archived: false })).toBe(true);
        expect(isOnTheList({ archived: true })).toBe(false);
        //   Only an explicit true hides a row: a string "true" out of a bad write
        //   must not silently remove somebody's notification.
        expect(isOnTheList({ archived: 'true' as unknown })).toBe(true);
    });

    it('THE WINDOWS ARE THE ONES THE JOB AND THE PROSE BOTH NAME', () => {
        expect(NOTIFICATION_ARCHIVE_AFTER_DAYS).toEqual({ read: 30, unread: 180 });
    });
});

describe('#615 — the job that applies it', () => {
    const route = readFileSync(
        join(process.cwd(), 'src/app/api/cron/age-notifications/route.ts'), 'utf8');

    it('DELETES NOTHING', () => {
        expect(route).not.toMatch(/\.delete\(/);
        expect(route).toContain('archivedFields(');
    });

    it('AND DECIDES THROUGH THE SHARED RULE RATHER THAN ITS OWN COPY', () => {
        //   A job with its own idea of "old" is the second copy of a contract,
        //   which is the defect this audit keeps finding. It calls the rule.
        expect(route).toContain('ageingDecision(data, now)');
        expect(route).not.toMatch(/24 \* 60 \* 60 \* 1000/);
    });

    it('AND REFUSES A CALLER WITHOUT THE CRON SECRET, LIKE ITS SIBLINGS', () => {
        //   #659 RE-ANCHORED. "Like its siblings" is now literally true: the
        //   eight siblings each wrote this check out by hand, all with `!==`
        //   and in four subtly different shapes, and they share one gate. The
        //   behaviour this asserted — 500 with no secret, 401 with a wrong one —
        //   is exercised against the gate itself in
        //   the-strict-comparison-reached-one-door.
        expect(route).toContain('refuseUnauthorisedCron(');
    });

    it('AND ONE BAD ROW DOES NOT END THE SWEEP', () => {
        //   The rest are still worth ageing and the run is idempotent, so a
        //   failure is retried rather than blocking every row behind it.
        expect(route).toMatch(/catch \(err\)[\s\S]*?failures\.push/);
    });

    it('AND IT REPORTS WHAT IT COULD NOT DATE, RATHER THAN HIDING IT', () => {
        //   A growing `undated` count means a writer is producing rows without a
        //   usable createdAt. That is a defect somewhere else, and a sweep that
        //   quietly skipped them would be the thing that hides it.
        expect(route).toContain('undated');
        expect(route).toContain('updateExisting(');
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored and diffed after each.
 *
 *     MUTANT                                                        RESULT
 *     one window for both read and unread                            KILLED
 *     `read` treated as truthy rather than === true                  KILLED
 *     archive a row with no usable timestamp                         KILLED
 *     re-archive a row already archived                              KILLED
 *     `ageDays > allowed` → `>=` (archive ON the boundary day)       KILLED
 *     isOnTheList: truthy check instead of === true                  KILLED
 *     archivedFields: also null out the message                      KILLED
 *     the job: its own age arithmetic instead of the shared rule     KILLED
 *     the job: drop the CRON_SECRET check                            KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                             SURVIVED ✓
 *
 *   THE BOUNDARY MUTANT SURVIVED THE FIRST ROUND. Every case was 29 or 31 days,
 *   and those agree under both spellings — only exactly thirty tells them apart.
 *   It is one day on one row, and it is the difference between a rule and an
 *   approximation; the two boundary cases exist now for both windows.
 */
