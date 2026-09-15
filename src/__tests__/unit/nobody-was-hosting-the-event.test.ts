/**
 * @jest-environment node
 */

/**
 *   #778 THE ADMINISTRATOR WAS ASKED TO JOIN HIS OWN EVENT, AND NOBODY HOSTED
 *        IT.
 *
 *   Reported by the owner: "the admin starts an event and its asked to join
 *   while users are asked to join so the entire event is not being hosted by
 *   the admin."
 *
 *   Three separate defects produce that one sentence, and they compound.
 *
 * ── (a) THE ROOM OPENED ON THE CLOCK, SO MEMBERS ARRIVED FIRST ──────────────
 *
 *   The member page decided a session was live from the schedule alone:
 *
 *       const start = new Date(s.scheduledAt).getTime();
 *       return now >= start && now < start + s.durationMinutes * 60_000;
 *
 *   Nothing asked whether it had been STARTED. The row carries `isActive`, the
 *   page declares it on its own interface and never reads it — and it would
 *   not have helped: the scheduling route writes `isActive: true` at CREATION,
 *   with a future `scheduledAt`, so it means "not cancelled", not "running".
 *
 *   So every member's room opened the minute the schedule said so, whether or
 *   not an administrator had pressed Start.
 *
 * ── (b) AND THE FIRST PERSON IN THE ROOM IS THE MODERATOR ───────────────────
 *
 *   The classroom runs on public meet.jit.si with no JWT tenant — the codebase
 *   says so itself, at CLASSROOM_JWT_IS_NOT_CONFIGURED. Such a room grants
 *   moderator to WHOEVER JOINS FIRST. `isModerator` is a claim the client makes
 *   to itself; the service never sees it.
 *
 *   Combined with (a): a member arriving at 10:00:03 for a 10:00 session is the
 *   real moderator, and the administrator arriving at 10:02 is an ordinary
 *   participant in his own event. That is the owner's sentence exactly.
 *
 *   Made worse by the prejoin screen, which was on for EVERYBODY including the
 *   host — so the one person who most needed to be in the room first was held
 *   at a "join?" prompt while members walked past him.
 *
 * ── (c) AND #188's LOBBY WAS NEVER ACTUALLY SWITCHED ON ─────────────────────
 *
 *   `executeCommand("toggleLobby", true)` ran synchronously, immediately after
 *   `new JitsiMeetExternalAPI(...)` — at which point the moderator is on the
 *   prejoin screen and has not joined. He holds no moderator role yet, because
 *   the role is granted on JOIN, so the command lands on nobody.
 *
 *   #188 recorded that it had closed an open room. The control it installed has
 *   been inert for its whole life, and (a) and (b) are why that was never
 *   noticed: there was usually a member in the room to be moderator instead.
 *
 * ── THE FIELD THAT WOULD HAVE MADE THE FIX INERT ────────────────────────────
 *
 *   The repair adds `startedAt` and opens the room from it. FOUND WHILE
 *   BUILDING THIS TEST: readWaveTrainingSessions projects the row field by
 *   field, and `startedAt` was not among them — so the page could never have
 *   seen it and the whole fix would have done nothing, in three files that each
 *   looked correct. That is the #773/#349 class, and it is why the projection
 *   is asserted here rather than trusted.
 *
 *   The projection spreads the key CONDITIONALLY rather than writing
 *   `?? null`, because absence and null must keep meaning different things: a
 *   row written before the stamp existed — including a session running right
 *   now — falls back to the old clock rule, while a row that carries the field
 *   unset is simply not started. `?? null` would have closed every live session
 *   the moment this shipped.
 *
 * ── MUTATION LOG ────────────────────────────────────────────────────────────
 *
 *     startedAt dropped from the projection                       KILLED
 *     the projection changed to `startedAt: ... ?? null`           KILLED
 *     isSessionOpen's legacy fallback removed                      KILLED
 *     isSessionOpen ignoring isActive: false                       KILLED
 *     the prejoin screen turned back on for the moderator          KILLED
 *     toggleLobby moved back to construction time                  KILLED
 *     startedAt not written on the update branch of start          KILLED
 *     reword this header                                 SURVIVED, intended
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { isSessionOpen, findOpenSession } from '@/lib/live-session-window';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

const T0 = Date.parse('2026-09-15T10:00:00.000Z');
const MIN = 60_000;

// ─────────────────────────────────────────────────────────────────────────────
describe('#778(a) — the room opens when the host starts it', () => {
    it('A SCHEDULED SESSION THAT NOBODY STARTED IS NOT OPEN', () => {
        /*
         *   THE test. Under the old rule this was open — the clock had reached
         *   the scheduled minute — and every member could walk in ahead of the
         *   administrator and take the moderator role with them.
         */
        const scheduled = {
            scheduledAt: new Date(T0).toISOString(),
            durationMinutes: 60,
            startedAt: null,
            isActive: true,
        };

        expect(isSessionOpen(scheduled, T0 + 3 * MIN)).toBe(false);
    });

    it('AND IT OPENS THE MOMENT IT IS STARTED', () => {
        //   The vacuity guard: a rule that closed everything would pass the
        //   test above and would end live training.
        const started = {
            scheduledAt: new Date(T0).toISOString(),
            durationMinutes: 60,
            startedAt: new Date(T0 + 5 * MIN).toISOString(),
            isActive: true,
        };

        expect(isSessionOpen(started, T0 + 6 * MIN)).toBe(true);
    });

    it('and it closes when the session has run its length, measured from the START', () => {
        //   Not from the schedule. A session started ten minutes late must run
        //   its full hour, not fifty minutes.
        const started = {
            scheduledAt: new Date(T0).toISOString(),
            durationMinutes: 60,
            startedAt: new Date(T0 + 10 * MIN).toISOString(),
            isActive: true,
        };

        expect(isSessionOpen(started, T0 + 65 * MIN)).toBe(true);
        expect(isSessionOpen(started, T0 + 71 * MIN)).toBe(false);
    });

    it('AN ENDED SESSION IS CLOSED WHATEVER THE CLOCK SAYS', () => {
        //   endWaveLiveSessionAction writes isActive: false. A host who ends
        //   early must not leave the room open for the rest of the hour.
        const ended = {
            scheduledAt: new Date(T0).toISOString(),
            durationMinutes: 60,
            startedAt: new Date(T0).toISOString(),
            isActive: false,
        };

        expect(isSessionOpen(ended, T0 + 10 * MIN)).toBe(false);
    });

    it('A LEGACY ROW WITH NO startedAt FALLS BACK TO THE CLOCK', () => {
        /*
         *   The compromise, asserted so it cannot be tidied away. A session in
         *   progress at the moment this ships has no stamp, and requiring one
         *   would close the room under the people in it.
         *
         *   Keyed on the field being ABSENT, not falsy — the object below has
         *   no `startedAt` property at all.
         */
        const legacy = {
            scheduledAt: new Date(T0).toISOString(),
            durationMinutes: 60,
            isActive: true,
        };

        expect(isSessionOpen(legacy, T0 + 3 * MIN)).toBe(true);
        expect(isSessionOpen(legacy, T0 + 61 * MIN)).toBe(false);
    });

    it('AND THE FALLBACK IS NARROW: a null stamp is not a legacy row', () => {
        //   The distinction the projection is built to preserve. If these two
        //   collapsed, either every live session would close or the stamp would
        //   mean nothing.
        const withNull = { scheduledAt: new Date(T0).toISOString(), durationMinutes: 60, startedAt: null };
        const withoutKey = { scheduledAt: new Date(T0).toISOString(), durationMinutes: 60 };

        expect(isSessionOpen(withNull, T0 + 3 * MIN)).toBe(false);
        expect(isSessionOpen(withoutKey, T0 + 3 * MIN)).toBe(true);
    });

    it('a malformed row is closed rather than thrown on', () => {
        expect(isSessionOpen({ scheduledAt: 'not a date', durationMinutes: 60 }, T0)).toBe(false);
        expect(isSessionOpen({ scheduledAt: new Date(T0).toISOString(), durationMinutes: 0 }, T0)).toBe(false);
        expect(isSessionOpen({ scheduledAt: new Date(T0).toISOString(), durationMinutes: NaN }, T0)).toBe(false);
    });

    it('findOpenSession picks the started one out of a schedule', () => {
        const sessions = [
            { id: 'later', scheduledAt: new Date(T0 + 120 * MIN).toISOString(), durationMinutes: 60, startedAt: null },
            { id: 'now', scheduledAt: new Date(T0).toISOString(), durationMinutes: 60, startedAt: new Date(T0).toISOString() },
            { id: 'past', scheduledAt: new Date(T0 - 300 * MIN).toISOString(), durationMinutes: 60, startedAt: new Date(T0 - 300 * MIN).toISOString() },
        ];

        expect(findOpenSession(sessions, T0 + 5 * MIN)?.id).toBe('now');
        expect(findOpenSession([], T0)).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#778 — the stamp survives the journey to the screen', () => {
    it('THE PROJECTION CARRIES startedAt AT ALL', () => {
        /*
         *   Found while building this suite: the reader projects field by
         *   field and `startedAt` was not among them, so the page could never
         *   have seen it and the whole repair would have been inert. Asserted
         *   here because three correct files plus one silent drop is exactly
         *   #773.
         */
        const src = stripComments(read('src/lib/wave-training-reader.ts'));

        expect(src).toMatch(/startedAt/);
    });

    it('AND CARRIES IT CONDITIONALLY, so a legacy row stays legacy', () => {
        //   `startedAt: ... ?? null` would give every pre-existing row the key
        //   with a null value, which live-session-window reads as "not
        //   started" — closing every session that is running right now.
        const src = stripComments(read('src/lib/wave-training-reader.ts'));

        expect(src).toMatch(/\.\.\.\(\s*data\.startedAt !== undefined/);
        expect(src).not.toMatch(/startedAt:\s*data\.startedAt[^\n]*\?\?\s*null/);
    });

    it('AND THE START ACTION WRITES IT ON BOTH OF ITS BRANCHES', () => {
        /*
         *   startWaveLiveSessionAction creates a session row when none exists
         *   and updates one when it does. A stamp on one branch is a stamp on
         *   none — the rule-reaching-some-of-the-places-it-names class, which
         *   is this audit's single most repeated finding.
         */
        const src = stripComments(read('src/app/actions/wave/_wv_admin_live.ts'));
        const start = src.split('_endWaveLiveSessionAction')[0];

        /*
         *   SCOPED TO THE SESSION WRITES. A first draft counted every
         *   `startedAt: new Date()` in the function and expected two — and
         *   found three, because the EVENT row (WAVE_TRAINING_EVENTS) has
         *   carried its own `startedAt` all along. Two collections, two
         *   different stamps, and a count cannot tell them apart. What matters
         *   is that both writes to the SESSION collection — the one the member
         *   page reads — carry it.
         */
        const sessionWrites = start
            .split('COLLECTIONS.WAVE_TRAINING_SESSIONS')
            .slice(1)
            //   WRITES ONLY. The function also QUERIES this collection to find
            //   out whether a row exists, and a query carries no stamp and
            //   should not — counting it would demand one.
            .filter(chunk => /^\s*\)?\s*(\.doc\([^)]*\))?\s*\.(add|update|updateExisting)\(\{/.test(chunk))
            //   the object literal each write passes
            .map(chunk => chunk.slice(0, chunk.indexOf('});')));

        expect(sessionWrites.length).toBe(2);
        for (const write of sessionWrites) {
            expect(write).toMatch(/startedAt:\s*new Date\(\)/);
        }
    });

    it('and the member page asks the shared rule rather than the clock', () => {
        const src = stripComments(read('src/app/wave/(member)/live-training/LiveTrainingClient.tsx'));

        expect(src).toMatch(/findOpenSession\(/);
        //   the hand-rolled clock comparison is gone
        expect(src).not.toMatch(/now >= start && now < end/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#778(b,c) — the host is in the room, and the lobby is real', () => {
    const classroom = () => stripComments(read('src/components/VideoClassroom.tsx'));

    it('THE MODERATOR IS NOT HELD AT A PREJOIN SCREEN', () => {
        //   He opened the page in order to host, and on a JWT-less room the
        //   person who is in first is the moderator. Holding him at a "join?"
        //   prompt is how a member ends up hosting.
        expect(classroom()).toMatch(/prejoinPageEnabled:\s*!isModeratorRef\.current/);
    });

    it('BUT A PARTICIPANT STILL IS', () => {
        //   The prejoin screen is where the lobby's "waiting to be admitted"
        //   state is shown. Turning it off for everybody would hide #188's
        //   control instead of fixing it.
        const src = classroom();
        expect(src).not.toMatch(/prejoinPageEnabled:\s*false\s*,/);
        expect(src).not.toMatch(/prejoinPageEnabled:\s*true\s*,/);
    });

    it('THE LOBBY IS ENABLED AFTER JOINING, not at construction', () => {
        /*
         *   The command was issued synchronously after the API object was
         *   built, before anybody had joined and therefore before there was a
         *   moderator to issue it. It must sit inside the
         *   `videoConferenceJoined` handler, which is the first moment a
         *   moderator exists.
         *
         *   Asserted as CONTAINMENT rather than as textual order: an ordering
         *   assertion is satisfied by the wrong occurrence, which this audit
         *   has been caught by more than once.
         */
        const src = classroom();
        const joined = src.split('addListener("videoConferenceJoined"')[1] ?? '';
        const handler = joined.split('addListener(')[0];

        expect(handler).toMatch(/toggleLobby/);

        //   and it appears EXACTLY ONCE in the whole file, so it cannot also
        //   still be sitting at construction time
        expect((src.match(/toggleLobby/g) ?? []).length).toBe(1);
    });

    it('AND EVERY CLASSROOM ON THE PLATFORM GETS BOTH FIXES', () => {
        /*
         *   The owner: "now all the fix above should be applied to the other
         *   modules if they behave same."
         *
         *   SWEPT, and the answer differs per defect:
         *
         *   (b) THE PREJOIN SCREEN and (c) THE LOBBY live inside
         *       VideoClassroom, which every classroom on the platform renders —
         *       the WAVE member page, the Academy learner page, and both admin
         *       consoles. Fixing the component fixed all four, and this test
         *       pins the set so a fifth cannot appear with its own copy.
         *
         *   (a) THE CLOCK-ONLY ENTRY RULE was WAVE's alone. Academy gates its
         *       classroom on `status === "live"`, a state the instructor writes
         *       by starting the session — see _ac_live.ts, which queries
         *       `.where("status", "==", "live")`. That is the same property
         *       `startedAt` now gives WAVE, arrived at differently, so academy
         *       needed no change and did not get a second mechanism bolted on.
         */
        const CLASSROOMS = [
            'src/app/wave/(member)/live-training/LiveTrainingClient.tsx',
            'src/app/academy/live/[courseId]/AcademyLiveClassClient.tsx',
            'src/app/admin/wave/training/live/[eventId]/page.tsx',
            'src/app/admin/academy/live/[courseId]/page.tsx',
        ];

        expect(CLASSROOMS.length).toBe(4);
        for (const p of CLASSROOMS) {
            const src = read(p);
            //   renders the shared component, so it inherits both fixes
            expect(src).toMatch(/<VideoClassroom/);
            /*
             *   AND SAYS WHO THE HOST IS. A classroom that omits isModerator
             *   defaults it to false, so NOBODY enables the lobby and nobody
             *   skips the prejoin screen — the original defect, restored by
             *   silence. Absence is what this catches.
             */
            expect(src).toMatch(/isModerator=\{/);
        }
    });

    it('and the academy learner still cannot enter before the instructor starts', () => {
        //   The property WAVE was missing, asserted where academy already has
        //   it — so the sweep's claim that academy needed no change is checked
        //   rather than asserted.
        const src = stripComments(read('src/app/actions/academy/_ac_live.ts'));

        expect(src).toMatch(/\.where\("status", "==", "live"\)/);
    });

    it('and enabling it can never take the classroom down', () => {
        //   A throw here would mean the host loses his own call. The defect it
        //   replaces — no lobby — is strictly less bad than that.
        const src = classroom();
        const joined = src.split('addListener("videoConferenceJoined"')[1] ?? '';
        const handler = joined.split('addListener(')[0];

        expect(handler).toMatch(/try\s*\{/);
        expect(handler).toMatch(/catch/);
    });
});
