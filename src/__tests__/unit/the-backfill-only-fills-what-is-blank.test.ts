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

/**
 * Ids this fake's Auth reports as a FAILED LOOKUP rather than a miss — #714.
 * The shim reports these in `errored`; the two must not be interchangeable.
 */
let authLookupFails: string[] = [];

jest.mock('@/lib/firebase-admin', () => ({
    adminAuth: {
        getUsers: async (identifiers: { uid: string }[]) => {
            if (duringAuthRead) { duringAuthRead(); duringAuthRead = null; }
            if (authThrows) throw new Error('Auth is unreachable');
            //   THE FAKE NOW ANSWERS THE WAY THE SHIM DOES.
            //
            //   It used to return `notFound: []` unconditionally, so an id Auth
            //   did not hold arrived as "simply absent from the map" — which is
            //   also what a failed lookup looked like. A double that cannot
            //   express the distinction cannot test it, and #714 is precisely
            //   that distinction. See the note at the foot of this file.
            const errored = identifiers
                .filter((i) => authLookupFails.includes(i.uid))
                .map((i) => ({ identifier: i, message: 'service key rejected' }));
            const remaining = identifiers.filter((i) => !authLookupFails.includes(i.uid));
            const users = remaining
                .filter((i) => authByUid[i.uid] !== undefined)
                .map((i) => ({ uid: i.uid, email: authByUid[i.uid] }));
            const notFound = remaining.filter((i) => authByUid[i.uid] === undefined);
            return { users, notFound, errored };
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
    authLookupFails = [];
    duringAuthRead = null;
});

// ─────────────────────────────────────────────────────────────────────────────
/**
 * Ids that look like what they stand for.
 *
 * Supabase Auth keys on UUIDs, so a profile id that is not one can never be
 * looked up — which is now its own outcome rather than a transient failure.
 * These tests therefore have to be explicit about which kind of id they mean.
 */
const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const U3 = '33333333-3333-4333-8333-333333333333';
/** The real one, from the production log: a Firebase-era uid, 28 chars of base62. */
const FIREBASE_UID = 'EHp5pfEwUqVBQve9s3fh3dfehrJ2';

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
        //   UUID ids, because a profile id that is NOT one is now its own
        //   outcome — Supabase Auth cannot hold it, so no run can ever answer
        //   for it and "run again" would be false advice. These two rows are
        //   about an Auth that could not be REACHED, which is the opposite
        //   case, so they carry ids Auth could perfectly well have answered for.
        profiles = { [U1]: { email: '' }, [U2]: { email: '' } };
        authByUid = { [U1]: 'a@example.com', [U2]: 'b@example.com' };
        authThrows = true;

        const report = await backfillMissingEmails();

        expect(writes).toEqual([]);
        expect(report.filled).toBe(0);
        //   #714 — AND IT SAYS SO. This assertion read
        //
        //       ['no-auth-account', 'no-auth-account']
        //
        //   which is the finding: an unreachable Auth was reported as proof
        //   that two people have no account. See the describe block below.
        expect(report.outcomes.map((o) => o.result)).toEqual(['auth-lookup-failed', 'auth-lookup-failed']);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#715 — it asks Auth about the id the profile POINTS AT, not the row id', () => {
    /*
     *   THE SEVENTH READER OF A RULE STATED ONCE TO STOP EXACTLY THIS.
     *
     *   A migrated profile keeps its Firebase-era document id and carries
     *   `_migratedTo`, then `supabaseAuthId`, pointing at the live Supabase
     *   account (#464/#466). lib/user-identity.ts exists because #449 found SIX
     *   readers answering "which row is the live one" and five of them
     *   differently — one cycled forever on a login, one refused a login over a
     *   dangling pointer, one split a session from its payment on a two-hop
     *   chain.
     *
     *   This module was written later and asked Auth about `profile.id`.
     *
     *   AND ITS TARGET POPULATION IS THE ONE THAT BREAKS ON. These rows have no
     *   email, so auth-profile-link.ts's fallback join — the one that rescues a
     *   migrated profile by the address both records share — has nothing to
     *   match on. The document id is the only key left, and for a legacy row it
     *   is the wrong one. Auth then answers 404 perfectly truthfully and the
     *   run concluded that the PERSON has no account.
     *
     *   One of the 48 in production is `EHp5pfEwUqVBQve9s3fh3dfehrJ2` — a
     *   Firebase-era uid, which cannot be a Supabase account id at all.
     */

    it('A MIGRATED PROFILE IS FILLED FROM THE ACCOUNT IT POINTS AT', async () => {
        //   The defect, directly: the address exists, Auth holds it, and the
        //   old code reported "no auth account" because it asked about the
        //   legacy id.
        profiles = {
            'EHp5pfEwUqVBQve9s3fh3dfehrJ2': { email: '', supabaseAuthId: 'live-uuid' },
            'live-uuid': { email: 'ada@example.com' },
        };
        authByUid = { 'live-uuid': 'ada@example.com' };

        const report = await backfillMissingEmails();

        expect(writes.map((w) => w.id)).toEqual(['EHp5pfEwUqVBQve9s3fh3dfehrJ2']);
        expect(writes[0].data.email).toBe('ada@example.com');
        expect(resultFor(report, 'EHp5pfEwUqVBQve9s3fh3dfehrJ2')).toBe('filled');
    });

    it('AND _migratedTo WINS OVER supabaseAuthId, AS IT DOES EVERYWHERE ELSE', async () => {
        //   pointerOf's order, not re-decided here. A module that picked its
        //   own order would be the eighth reader.
        profiles = {
            legacy: { email: '', _migratedTo: 'moved-to', supabaseAuthId: 'self' },
            'moved-to': { email: 'ada@example.com' },
        };
        authByUid = { 'moved-to': 'ada@example.com', self: 'wrong@example.com' };

        await backfillMissingEmails();

        expect(writes[0].data.email).toBe('ada@example.com');
    });

    it('AND IT FOLLOWS THE WHOLE CHAIN, NOT ONE HOP', async () => {
        //   #449's measured failure: A → B → C, where the one-hop readers
        //   stopped at B. Asking Auth about B here would get a 404 and report
        //   an absent account for somebody who has one.
        profiles = {
            a: { email: '', _migratedTo: 'b' },
            b: { email: '', _migratedTo: 'c' },
            c: { email: 'ada@example.com' },
        };
        authByUid = { c: 'ada@example.com' };

        const report = await backfillMissingEmails();

        expect(resultFor(report, 'a')).toBe('filled');
    });

    it('AND A DANGLING POINTER FALLS BACK TO THE LAST ROW THAT EXISTS', async () => {
        /*
         *   #449's second measured failure. The pointer names a row that is not
         *   there — a half-finished migration — and resolving to NOTHING is the
         *   worst reading of that state. The walk keeps the last good row, so
         *   this asks Auth about the profile's own id, which is what it did
         *   before this change and is still the right floor.
         */
        profiles = { orphan: { email: '', _migratedTo: 'nowhere' } };
        authByUid = { orphan: 'ada@example.com' };

        const report = await backfillMissingEmails();

        expect(resultFor(report, 'orphan')).toBe('filled');
    });

    it('AND A POINTER CYCLE DOES NOT HANG THE RUN', async () => {
        //   Two rows pointing at each other. Before user-identity.ts this walk
        //   never ended — the probe that found it had to be killed.
        profiles = {
            x: { email: '', _migratedTo: 'y' },
            y: { email: '', _migratedTo: 'x' },
        };
        authByUid = {};

        const report = await backfillMissingEmails();

        expect(report.scanned).toBe(2);
        expect(writes).toEqual([]);
    });

    it('AND THE REPORT SAYS WHICH ID THE ANSWER IS ABOUT', async () => {
        //   "no-auth-account" against a migrated row is unreadable on its own:
        //   the operator cannot tell which of two ids Auth was asked about.
        profiles = {
            legacy: { email: '', supabaseAuthId: 'elsewhere' },
            elsewhere: { email: 'x@example.com' },
        };
        authByUid = {};

        const report = await backfillMissingEmails();

        expect(resultFor(report, 'legacy')).toBe('no-auth-account');
        expect(report.outcomes.find((o) => o.profileId === 'legacy')?.detail)
            .toContain('resolved to elsewhere');
    });

    it('AND THE ROW IT REPAIRS IS STILL THE ONE THAT WAS BLANK', async () => {
        /*
         *   THE safety property this change must not cost. Resolving the
         *   identity changes which id AUTH is asked about; it must not change
         *   which ROW is written. Writing the live row instead would leave the
         *   blank profile blank and touch a record that never needed repairing.
         */
        profiles = {
            legacy: { email: '', supabaseAuthId: 'live' },
            live: { email: 'already@example.com' },
        };
        authByUid = { live: 'ada@example.com' };

        await backfillMissingEmails();

        expect(writes.map((w) => w.id)).toEqual(['legacy']);
        expect(profiles.live.email).toBe('already@example.com');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#714 — "Auth says no" and "I could not ask Auth" are different answers', () => {
    /*
     *   THIS IS NOT A HYPOTHETICAL, AND THAT IS WHY IT IS ITS OWN BLOCK.
     *
     *   The first production run of this repair — the cron's first firing,
     *   dispatched by hand because the daily schedule had not come round yet —
     *   returned, for all 48 profiles:
     *
     *       {"ok":true,"scanned":48,"filled":0,
     *        "outcomes":[{"profileId":"05c711c7-…","result":"no-auth-account"},
     *                    … forty-seven more, every one identical …]}
     *
     *   Read one way that is the most serious finding in the forensic report:
     *   48 people hold a profile with no account behind it, so they cannot log
     *   in and never could. Read the other way it is one broken lookup.
     *
     *   THE OLD CODE COULD NOT TELL, AND NEITHER COULD ANYONE READING IT. Both
     *   the batch failure and the genuine miss arrived as "this id is not in
     *   the map", and the map only held addresses. A unanimous result across 48
     *   independent rows is much more like a systemic failure than like 48
     *   coincidences, and the report gave no way to check.
     *
     *   So the distinction is now carried end to end — the shim reports
     *   `errored` apart from `notFound`, and the default for an id nothing
     *   answered for is "could not find out", not "does not exist".
     */

    it('AN ACCOUNT AUTH SAYS IS ABSENT IS REPORTED AS ABSENT', async () => {
        profiles = { gone: { email: '' } };
        authByUid = {};

        const report = await backfillMissingEmails();

        expect(resultFor(report, 'gone')).toBe('no-auth-account');
    });

    it('AND A LOOKUP THAT FAILED IS REPORTED AS A FAILED LOOKUP, NOT AS AN ABSENT ACCOUNT', async () => {
        //   A UUID, so the failure under test is the transient one this test
        //   is about rather than an id Auth could never have been asked about.
        profiles = { [U1]: { email: '' } };
        authLookupFails = [U1];

        const report = await backfillMissingEmails();

        expect(writes).toEqual([]);
        expect(resultFor(report, U1)).toBe('auth-lookup-failed');
    });

    it('AND ONE FAILED LOOKUP DOES NOT CHANGE THE ANSWER FOR THE ROWS BESIDE IT', async () => {
        //   The two states have to survive together in one report, because that
        //   is how a partial failure arrives. A run that downgraded everything
        //   to "could not tell" would be as useless as one that upgraded
        //   everything to "no account".
        profiles = { [U1]: { email: '' }, [U2]: { email: '' }, [U3]: { email: '' } };
        authByUid = { [U1]: 'ada@example.com' };
        authLookupFails = [U3];

        const report = await backfillMissingEmails();

        expect(resultFor(report, U1)).toBe('filled');
        expect(resultFor(report, U2)).toBe('no-auth-account');
        expect(resultFor(report, U3)).toBe('auth-lookup-failed');
        expect(report.filled).toBe(1);
    });

    it('AND THE FAILED LOOKUP CARRIES WHY, SO THE NEXT RUN IS NOT A GUESS', async () => {
        //   "could not tell" with no reason attached sends the operator back to
        //   the same unanswerable question. The shim's message is passed
        //   through rather than replaced with a generic one.
        profiles = { [U1]: { email: '' } };
        authLookupFails = [U1];

        const report = await backfillMissingEmails();

        expect(report.outcomes[0].detail).toBe('service key rejected');
    });

    /*
     *   AND THE ONE THE PRODUCTION LOG HAS BEEN REPORTING EVERY DAY.
     *
     *       could not reach Supabase Auth for 1 of 48 profile(s) … Run again.
     *       EHp5pfEwUqVBQve9s3fh3dfehrJ2: Expected parameter to be UUID but is not
     *
     *   The lookup did not fail. It was never answerable: that is a Firebase-era
     *   uid, and Supabase Auth keys on UUIDs. "Run again" is advice that can
     *   only ever be wrong, and the row sat in the bucket the cron counts to
     *   decide whether a run established anything — so every complete run has
     *   been reporting itself as partially broken.
     */
    it('AND AN ID AUTH CAN NEVER HOLD IS NOT A FAILURE OF THIS RUN', async () => {
        profiles = { [FIREBASE_UID]: { email: '' } };
        authLookupFails = [FIREBASE_UID];

        const report = await backfillMissingEmails();

        expect(resultFor(report, FIREBASE_UID)).toBe('auth-id-not-usable');
        expect(writes).toEqual([]);
        //   And it says so in words that stop the retry, rather than inviting it.
        expect(String(report.outcomes[0].detail)).toMatch(/retrying will not help/);
    });

    it('AND IT DOES NOT SWALLOW A REAL TRANSIENT FAILURE BESIDE IT', async () => {
        //   THE CONTROL. A rule that called every failed lookup permanent would
        //   pass the test above and lose the distinction #714 exists for.
        profiles = { [FIREBASE_UID]: { email: '' }, [U1]: { email: '' } };
        authLookupFails = [FIREBASE_UID, U1];

        const report = await backfillMissingEmails();

        expect(resultFor(report, FIREBASE_UID)).toBe('auth-id-not-usable');
        expect(resultFor(report, U1)).toBe('auth-lookup-failed');
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
 *     #715 — WHICH ID AUTH IS ASKED ABOUT
 *     THE DEFECT: Auth is asked about profile.id again                 KILLED
 *       — kills 5, which is the measure of how much of this file's
 *         new behaviour rests on it.
 *     one hop (activeIdFromRow) instead of the full walk               KILLED
 *     the RESOLVED row is written instead of the blank one             KILLED
 *       — the safety property this change must not cost: resolving
 *         changes which id AUTH is asked about, never which ROW is
 *         repaired.
 *     the resolved id is dropped from the outcome detail               KILLED
 *
 *     #718 — WHAT THE OPERATOR IS HANDED
 *     the raw phone number is returned instead of the mask           KILLED
 *     the mask keeps eight digits instead of four                    KILLED
 *     a number too short to mask is partly revealed                  KILLED
 *     "could not tell" collapses into "no account"                   KILLED
 *     the structured name fields are ignored                         KILLED
 *     a row with no phone reports "***" rather than null             KILLED
 *     the whole row is spread into the response                      KILLED
 *       — the one that matters most. NIN, BVN, residential address
 *         and bank details are all on the row that was read anyway,
 *         so a single careless spread turns a "who is this person"
 *         screen into an identity-document export.
 *
 *     #714 — THE LOOKUP STATE
 *     the default for an unanswered id goes back to "absent"          KILLED
 *     backfillDecision reports a failed lookup as no-auth-account     KILLED
 *     the `errored` entries are not read into the lookup map          KILLED
 *     the `notFound` entries are not read in, so every miss
 *       degrades to "could not tell"                                  KILLED
 *     the failure's detail is dropped from the outcome                KILLED
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

// ─────────────────────────────────────────────────────────────────────────────
describe('#718 — the operator gets something they can act on', () => {
    /*
     *   THE PREVIEW RETURNED FORTY-EIGHT UUIDs AND NOTHING ELSE, and its own
     *   comment gave the reason: "the whole point of these rows is that they
     *   have no address to return, and the rest of a profile is not this
     *   endpoint's business."
     *
     *   That held while #671's premise held — the address is in Auth against
     *   the same id, so the repair fills it unattended and ids are all anyone
     *   needs. The first believable run against production disproved it:
     *
     *       scanned 48, filled 0, needsAPerson 47, couldNotTell 1
     *
     *   There is no account to copy an address from, so a PERSON has to
     *   identify these people, and a column of UUIDs gives them nothing.
     */

    //   describeProfilesWithNoEmail is imported through the same require as the
    //   rest of this file, so it sees the same mocked database and Auth.
     
    const { describeProfilesWithNoEmail, maskPhone } =
        require('@/lib/missing-email-backfill') as typeof import('@/lib/missing-email-backfill');

    it('IT REPORTS THE NAME AND A MASKED PHONE, WHICH ARE THE KEYS LEFT', async () => {
        profiles = {
            u1: { email: '', fullName: 'Ada Okonkwo', phone: '+234 802 555 1234', roles: ['cooperative_member'] },
        };
        authByUid = {};

        const [row] = await describeProfilesWithNoEmail();

        expect(row.name).toBe('Ada Okonkwo');
        expect(row.phone).toBe('***1234');
        expect(row.roles).toEqual(['cooperative_member']);
    });

    it('AND IT NEVER RETURNS THE IDENTITY DOCUMENTS THOSE ROWS ALSO CARRY', async () => {
        /*
         *   #490's rule. This is a screen for working out who somebody is, not
         *   for exporting their NIN, BVN, address or bank details — every one
         *   of which is on the row that was read anyway, which is exactly why
         *   the assertion is worth having.
         */
        profiles = {
            u1: {
                email: '', fullName: 'Ada', phone: '08025551234',
                nin: '12345678901', bvn: '22334455667',
                residentialAddress: '14 Marina Road', bankDetails: { accountNumber: '0123456789' },
            },
        };

        const [row] = await describeProfilesWithNoEmail();
        const serialised = JSON.stringify(row);

        for (const secret of ['12345678901', '22334455667', '14 Marina Road', '0123456789']) {
            expect(serialised).not.toContain(secret);
        }
        //   And the raw phone is not in there either — only the masked form.
        expect(serialised).not.toContain('08025551234');
    });

    it('AND IT SAYS WHETHER THE PERSON CAN SIGN IN AT ALL', async () => {
        /*
         *   THE distinction the old list could not express, and the one that
         *   decides what an operator does next: "this row is missing a field
         *   and the cron will fill it" and "this person has no login and never
         *   had one" are not the same problem.
         */
        profiles = {
            canSignIn: { email: '' },
            cannot: { email: '' },
            unknown: { email: '' },
        };
        authByUid = { canSignIn: 'ada@example.com' };
        authLookupFails = ['unknown'];

        const rows = await describeProfilesWithNoEmail();
        const by = (id: string) => rows.find((r) => r.profileId === id);

        expect(by('canSignIn')?.authAccount).toBe('has-account');
        expect(by('cannot')?.authAccount).toBe('no-account');
        expect(by('unknown')?.authAccount).toBe('could-not-tell');
        expect(by('unknown')?.detail).toBe('service key rejected');
    });

    it('AND IT READS BOTH NAME SHAPES, BECAUSE ROWS EXIST WITH EITHER', async () => {
        //   fullName is what the old registration wrote; the structured fields
        //   are what every module written after April 2026 writes. Assuming one
        //   would blank the name for half the population.
        profiles = {
            old: { email: '', fullName: 'Ada Okonkwo' },
            structured: { email: '', firstName: 'Ada', otherName: 'Ngozi', lastName: 'Okonkwo' },
            neither: { email: '' },
        };

        const rows = await describeProfilesWithNoEmail();
        const by = (id: string) => rows.find((r) => r.profileId === id);

        expect(by('old')?.name).toBe('Ada Okonkwo');
        expect(by('structured')?.name).toBe('Ada Ngozi Okonkwo');
        //   Empty, not "undefined undefined" — a row with no name is a fact,
        //   and rendering it as placeholder words would be a worse one.
        expect(by('neither')?.name).toBe('');
    });

    it('AND A ROW WITH NO PHONE SAYS SO RATHER THAN MASKING NOTHING', async () => {
        //   "***" against a row that has no number would read as "there is a
        //   number and you may not see it".
        profiles = { u1: { email: '' } };

        const [row] = await describeProfilesWithNoEmail();

        expect(row.phone).toBeNull();
    });

    it('AND THE MASK KEEPS FOUR DIGITS, OR NOTHING AT ALL', () => {
        expect(maskPhone('+234 802 555 1234')).toBe('***1234');
        expect(maskPhone('08025551234')).toBe('***1234');
        //   Too short to identify anybody, so it reveals nothing rather than
        //   most of what is there.
        expect(maskPhone('123')).toBe('***');
        expect(maskPhone('')).toBe('***');
    });
});
