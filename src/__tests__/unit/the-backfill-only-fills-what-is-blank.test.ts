/**
 * @jest-environment node
 */

/**
 *   #671 THE REPAIR FOR THE 48 EMAIL-LESS PROFILES, EXERCISED RATHER THAN
 *   DESCRIBED.
 *
 *   `backfillDecision` — the rule — is unit-tested beside the finding it came
 *   from. THIS file tests the thing the owner actually presses: the loop that
 *   reads Supabase Auth in batches and writes profiles.
 *
 *   That distinction is the point. A pure decision function with a wrapper
 *   nobody exercised is how "the fix reached one of N doors" happens — the rule
 *   is right and the caller applies it to the wrong rows, or to none, or
 *   ignores it on the error path. This one WRITES TO USER PROFILES, so the
 *   properties worth proving are the ones about what it does NOT touch.
 *
 *   FOUR PROMISES ARE MADE IN THE MODULE HEADER AND ALL FOUR ARE CHECKED HERE:
 *
 *     · it never overwrites an address
 *     · it never writes anything but the email (and updatedAt)
 *     · it is idempotent — a second run writes nothing
 *     · a failure anywhere does not strand the rest, and says which
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

/** Every write the repair performs, in order. The assertions are about this. */
const writes: { id: string; data: Record<string, any> }[] = [];

/** The profiles the database holds, keyed by id. */
let profiles: Record<string, Record<string, any>> = {};

/** What Supabase Auth answers for a uid. `undefined` = no such account. */
let authByUid: Record<string, string | undefined> = {};

/** Set to fail the Auth batch read, to exercise the error path. */
let authThrows = false;

/**
 * Runs DURING the Auth batch read — i.e. after the rows are selected and before
 * any write. That is where a real login lands, and it lets a test change the
 * database mid-run without the production code growing a seam for it.
 */
let duringAuthRead: (() => void) | null = null;

jest.mock('@/lib/firebase-admin', () => ({
    adminAuth: {
        getUsers: async (identifiers: { uid: string }[]) => {
            if (duringAuthRead) { duringAuthRead(); duringAuthRead = null; }
            if (authThrows) throw new Error('Auth is unreachable');
            const users = identifiers
                .filter((i) => authByUid[i.uid] !== undefined)
                .map((i) => ({ uid: i.uid, email: authByUid[i.uid] }));
            return { users, notFound: [] };
        },
    },
}));

jest.mock('@/lib/supabase-db', () => ({
    supabaseDb: {
        collection: () => ({
            where: (_f: string, _op: string, value: any) => ({
                limit: () => ({
                    get: async () => {
                        //   "" and null are separate rows to a database, and the
                        //   selector queries them separately — modelled here so a
                        //   backfill that only handled one shape is visible.
                        const docs = Object.entries(profiles)
                            .filter(([, d]) => (value === null ? d.email === null : d.email === value))
                            //   A SNAPSHOT IS A COPY, TAKEN NOW.
                            //
                            //   The first version of this fake returned the live
                            //   row object, so `doc.data()` kept seeing later
                            //   edits. A mutant that deleted the repair's
                            //   re-read and trusted the selection SURVIVED —
                            //   because in this fake the two were the same
                            //   object, and no test could tell them apart.
                            //
                            //   A test double that is more forgiving than the
                            //   thing it stands in for silently voids every
                            //   assertion that depends on the difference.
                            .map(([id, d]) => { const snap = { ...d }; return { id, data: () => snap }; });
                        return { empty: docs.length === 0, docs };
                    },
                }),
            }),
            doc: (id: string) => ({
                //   The re-read the repair performs immediately before writing.
                //   Reads `profiles` LIVE, so a test can change a row between
                //   the selection and the write and the repair sees it — which
                //   is the race being modelled, not a simulation of it.
                get: async () => ({
                    exists: id in profiles,
                    data: () => profiles[id],
                }),
                set: async (data: Record<string, any>) => {
                    if (profiles[id]?.__failWrite) throw new Error('row is locked');
                    writes.push({ id, data });
                    profiles[id] = { ...profiles[id], ...data };
                },
            }),
        }),
    },
}));

jest.mock('@/lib/firestore-compat', () => ({
    FieldValue: { serverTimestamp: () => '<<server-timestamp>>' },
}));

 
const { backfillMissingEmails } = require('@/lib/missing-email-backfill') as
    typeof import('@/lib/missing-email-backfill');

const resultFor = (report: { outcomes: { profileId: string; result: string }[] }, id: string) =>
    report.outcomes.find((o) => o.profileId === id)?.result;

beforeEach(() => {
    writes.length = 0;
    profiles = {};
    authByUid = {};
    authThrows = false;
    duringAuthRead = null;
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#671 — the backfill fills a blank profile from the verified address', () => {
    it('IT WRITES THE ADDRESS AUTH HOLDS, NORMALISED', async () => {
        profiles = { u1: { email: '', roles: ['general_user'] } };
        authByUid = { u1: '  Ada@Example.COM ' };

        const report = await backfillMissingEmails();

        expect(writes).toEqual([
            { id: 'u1', data: { email: 'ada@example.com', updatedAt: '<<server-timestamp>>' } },
        ]);
        expect(report.filled).toBe(1);
        expect(resultFor(report, 'u1')).toBe('filled');
    });

    it('AND WRITES NOTHING ELSE — NOT THE ROLES, NOT THE PROFILE', async () => {
        /*
         *   The security directive this whole audit runs under: nothing is
         *   destroyed, and a repair touches only what it came to repair. A
         *   `set` without merge, or one carrying a rebuilt profile, would pass
         *   the assertion above and quietly flatten every other field.
         */
        profiles = { u1: { email: null, roles: ['cooperative_member'], fullName: 'Ada' } };
        authByUid = { u1: 'ada@example.com' };

        await backfillMissingEmails();

        expect(Object.keys(writes[0].data).sort()).toEqual(['email', 'updatedAt']);
    });

    it('AND FINDS BOTH SHAPES OF BLANK, BECAUSE A DATABASE TREATS THEM AS DIFFERENT ROWS', async () => {
        profiles = {
            empty: { email: '' },
            nul: { email: null },
        };
        authByUid = { empty: 'a@example.com', nul: 'b@example.com' };

        const report = await backfillMissingEmails();

        expect(report.scanned).toBe(2);
        expect(writes.map((w) => w.id).sort()).toEqual(['empty', 'nul']);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#671 — and it is safe to run, and to run twice', () => {
    it('IT NEVER OVERWRITES AN ADDRESS THAT IS ALREADY THERE', async () => {
        /*
         *   THE control the module exists under. A profile whose address
         *   DIFFERS from the authenticated one is a finding, not something to
         *   reconcile unattended — overwriting it destroys the evidence (#479).
         *
         *   THE RACE IS MODELLED, NOT DESCRIBED. The row is blank when the
         *   selection runs and filled by the time the write is attempted —
         *   #479 has the LOGIN repair this same field, so a person signing in
         *   between the two steps is exactly what happens here.
         *
         *   THIS TEST FOUND A REAL DEFECT ON ITS FIRST RUN. The module header
         *   promised the blank was "re-read immediately before the write rather
         *   than trusted from the scan that selected it", and the loop was
         *   passing the value captured by the selection query — several round
         *   trips and a batched Auth read earlier. A DECLARED RULE NOTHING
         *   CONSULTED, in the module whose entire safety claim rests on it.
         */
        profiles = { u1: { email: '' } };
        authByUid = { u1: 'fromauth@example.com' };

        //   The login lands between the selection and the write — hung on the
        //   Auth read, which is genuinely where that time goes, rather than on
        //   a hook invented in the production code for this test's benefit.
        duringAuthRead = () => { profiles.u1.email = 'theylogged@in.com'; };

        const report = await backfillMissingEmails();

        expect(writes).toEqual([]);
        expect(resultFor(report, 'u1')).toBe('already-had-one');
        expect(profiles.u1.email).toBe('theylogged@in.com');
    });

    it('AND A SECOND RUN WRITES NOTHING', async () => {
        //   Idempotence, measured rather than asserted. The owner may press
        //   this twice, or press it after a partial run.
        profiles = { u1: { email: '' } };
        authByUid = { u1: 'ada@example.com' };

        await backfillMissingEmails();
        const afterFirst = writes.length;
        await backfillMissingEmails();

        expect(afterFirst).toBe(1);
        expect(writes.length).toBe(1);
    });

    it('AND DOES NOT RESURRECT A PROFILE THAT WAS DELETED MID-RUN', async () => {
        /*
         *   `set(..., { merge: true })` CREATES a document that does not exist.
         *   So a profile deleted between the selection and the write — an
         *   erasure request, an admin removing a duplicate — would be brought
         *   back by this repair, carrying an address, as a side effect of a job
         *   that is supposed to fill in one field.
         *
         *   Nothing in this audit is allowed to undo a deletion. The row is
         *   skipped and reported, so the operator sees it happened.
         *
         *   No test covered this and a mutant that wrote anyway SURVIVED.
         */
        profiles = { doomed: { email: '' } };
        authByUid = { doomed: 'a@example.com' };
        duringAuthRead = () => { delete profiles.doomed; };

        const report = await backfillMissingEmails();

        expect(writes).toEqual([]);
        expect(profiles.doomed).toBeUndefined();
        expect(resultFor(report, 'doomed')).toBe('profile-vanished');
    });

    it('AND WRITES NOTHING FOR AN ACCOUNT AUTH DOES NOT HAVE', async () => {
        profiles = { gone: { email: '' } };
        authByUid = {};

        const report = await backfillMissingEmails();

        expect(writes).toEqual([]);
        expect(resultFor(report, 'gone')).toBe('no-auth-account');
    });

    it('AND NOTHING FOR A PHONE-ONLY ACCOUNT WITH NO ADDRESS TO COPY', async () => {
        //   Inventing one would be worse than the gap.
        profiles = { phone: { email: '' } };
        authByUid = { phone: '' };

        const report = await backfillMissingEmails();

        expect(writes).toEqual([]);
        expect(resultFor(report, 'phone')).toBe('auth-has-no-email');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#671 — and one bad row does not strand the other forty-seven', () => {
    it('A FAILED WRITE IS REPORTED AND THE REST STILL RUN', async () => {
        /*
         *   The shape that matters on a bulk repair: throwing on the first
         *   difficult row leaves the operator with a half-finished job and no
         *   record of where it stopped. Every outcome is per profile.
         */
        profiles = {
            ok1: { email: '' },
            bad: { email: '', __failWrite: true },
            ok2: { email: '' },
        };
        authByUid = { ok1: 'a@example.com', bad: 'b@example.com', ok2: 'c@example.com' };

        const report = await backfillMissingEmails();

        expect(writes.map((w) => w.id).sort()).toEqual(['ok1', 'ok2']);
        expect(report.filled).toBe(2);
        expect(resultFor(report, 'bad')).toBe('write-failed');
    });

    it('AND AN UNREACHABLE AUTH WRITES NOTHING AT ALL, RATHER THAN GUESSING', async () => {
        /*
         *   THE direction a failure must fall in. With the Auth read failed,
         *   the addresses are unknown — and the only safe response to "I do not
         *   know this person's address" is to write nothing and say so. The run
         *   under-repairs, reports it, and can simply be run again.
         */
        profiles = { u1: { email: '' }, u2: { email: '' } };
        authByUid = { u1: 'a@example.com', u2: 'b@example.com' };
        authThrows = true;

        const report = await backfillMissingEmails();

        expect(writes).toEqual([]);
        expect(report.filled).toBe(0);
        expect(report.outcomes.map((o) => o.result)).toEqual(['no-auth-account', 'no-auth-account']);
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored and diffed after each.
 *
 *     MUTANT                                                        RESULT
 *     THE DEFECT THIS FILE FOUND: the re-read before the write
 *       is removed and the selection's snapshot trusted              KILLED
 *       — SURVIVED the first run, and the FAKE was at fault: its
 *         query returned the live row object, so `doc.data()` kept
 *         seeing later edits and a snapshot was indistinguishable
 *         from a re-read. A real snapshot is a copy taken at query
 *         time; the fake now copies. A test double more forgiving
 *         than the thing it stands in for voids every assertion
 *         that rests on the difference.
 *     a vanished profile is recreated instead of skipped              KILLED
 *       — also SURVIVED first: nothing covered it. `set(…,{merge})`
 *         CREATES, so a profile deleted mid-run would have been
 *         brought back by a job that only meant to fill one field.
 *     the write stops merging and replaces the row                    KILLED
 *     it overwrites an address that is already there                  KILLED
 *     it writes when Auth has no address for the account              KILLED
 *     it writes when Auth has no account at all                       KILLED
 *     a failed write throws instead of being reported                 KILLED
 *     an unreachable Auth is treated as "write anyway"                KILLED
 *     only the "" shape is selected                                   KILLED
 *     the address stops being normalised                              KILLED
 *     filled is counted for rows that were skipped                    KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                              SURVIVED ✓
 *
 * ── WHAT THIS FILE COST AND RETURNED ────────────────────────────────────────
 *
 *   Two defects in the repair (a promised re-read that was not performed, a
 *   deletion that would have been undone) and one in the test double, none of
 *   which the source-level tests beside the finding could have seen. The rule
 *   was right in all three cases; the caller was not. That is the difference
 *   between testing a decision and testing the thing somebody presses.
 */
