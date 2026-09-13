/**
 * @jest-environment node
 */

/**
 *   #714 THE AUTH SHIM REPORTED "THIS ACCOUNT DOES NOT EXIST" WHENEVER IT
 *   COULD NOT FIND OUT.
 *
 *   `getUsers` was:
 *
 *       const { data, error } = await supabaseAdmin.auth.admin.getUserById(uid);
 *       if (error || !data?.user) { notFound.push(identifier); continue; }
 *
 *   Supabase reports a missing account as an ERROR, not as `{ user: null }` —
 *   so `if (error)` is the ordinary path, not the exceptional one. It is also
 *   the path taken by a service key Supabase will not accept, by an id that is
 *   not a UUID, by a 5xx, and by a network that is down. All five arrived in
 *   `notFound`, which callers read as a statement about the PERSON.
 *
 *   HOW IT SURFACED. The missing-email backfill (#671/#702) ran against
 *   production for the first time and answered, for every one of the 48
 *   profiles it examined:
 *
 *       {"result":"no-auth-account"}   × 48, unanimous
 *
 *   That is simultaneously the most serious finding in the forensic report —
 *   48 people holding a profile with no account behind it, unable to log in —
 *   and the signature of one broken lookup. A result that unanimous across 48
 *   independent rows is far more like the second than the first, and nothing
 *   anywhere could distinguish them. A measurement that returns the same
 *   answer for "no" and for "I don't know" has not measured anything.
 *
 *   THE SHIM IS WHERE THIS HAS TO BE FIXED, not the caller. The caller cannot
 *   recover a distinction the adapter has already thrown away, and the four
 *   broadcast call sites read `users` only — so `errored` is added beside
 *   `notFound` rather than changing what either already means.
 *
 *   Firebase's contract is unchanged: getUsers still does not throw.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

/**
 * What the fake Supabase admin answers for one id.
 *
 * `throws` is the case the fake originally could not produce, and a mutant
 * survived because of it — see the table at the foot of this file. Supabase
 * returns an `error` object for an HTTP-level failure but THROWS for a
 * transport one, and those reach different code in the shim.
 */
type Answer = { user?: any; error?: { message: string; status?: number }; throws?: string };

let answers: Record<string, Answer> = {};

jest.mock('@supabase/supabase-js', () => ({
    createClient: () => ({
        auth: {
            admin: {
                getUserById: async (uid: string) => {
                    const answer = answers[uid];
                    if (!answer) {
                        //   Supabase's own shape for a missing account: a 404
                        //   error, NOT `{ user: null }`. Modelled exactly,
                        //   because the whole finding is that the code read
                        //   every error as this one.
                        return { data: { user: null }, error: { message: 'User not found', status: 404 } };
                    }
                    if (answer.throws) throw new Error(answer.throws);
                    if (answer.error) return { data: { user: null }, error: answer.error };
                    return { data: { user: answer.user }, error: null };
                },
                listUsers: async () => ({ data: { users: [] }, error: null }),
            },
        },
    }),
}));


const { getAuth } = require('firebase-admin/auth') as { getAuth: () => any };
const auth = getAuth();

const supabaseUser = (id: string, email: string) => ({
    id,
    email,
    email_confirmed_at: '2026-01-01T00:00:00Z',
    created_at: '2026-01-01T00:00:00Z',
    app_metadata: {},
    user_metadata: {},
});

const uidsIn = (list: { uid: string }[]) => list.map((i) => i.uid).sort();

beforeEach(() => { answers = {}; });

// ─────────────────────────────────────────────────────────────────────────────
describe('#714 — getUsers separates an absent account from a failed lookup', () => {
    it('AN ACCOUNT THAT EXISTS COMES BACK IN users', async () => {
        answers = { a: { user: supabaseUser('a', 'ada@example.com') } };

        const result = await auth.getUsers([{ uid: 'a' }]);

        expect(result.users.map((u: any) => u.email)).toEqual(['ada@example.com']);
        expect(result.notFound).toEqual([]);
        expect(result.errored).toEqual([]);
    });

    it('AND A 404 IS AN ABSENCE — notFound, WHICH IS WHAT IT ALWAYS MEANT', async () => {
        //   Supabase says 404 for an id it does not hold. That IS "no such
        //   account", and it must keep landing where callers expect it.
        const result = await auth.getUsers([{ uid: 'nobody' }]);

        expect(result.users).toEqual([]);
        expect(uidsIn(result.notFound)).toEqual(['nobody']);
        expect(result.errored).toEqual([]);
    });

    it('AND A REJECTED SERVICE KEY IS NOT AN ABSENCE — THE DEFECT, DIRECTLY', async () => {
        /*
         *   THE finding. A 401 says nothing whatever about whether this account
         *   exists, and it used to be reported identically to a 404.
         */
        answers = { real: { error: { message: 'Invalid API key', status: 401 } } };

        const result = await auth.getUsers([{ uid: 'real' }]);

        expect(result.notFound).toEqual([]);
        expect(uidsIn(result.errored.map((e: any) => e.identifier))).toEqual(['real']);
        expect(result.errored[0].message).toBe('Invalid API key');
    });

    it('AND NEITHER IS A MALFORMED ID, A 5xx, OR A DEAD NETWORK', async () => {
        //   The other three doors onto the same `if (error)`. Listed
        //   individually because "handles errors" is the claim that was made
        //   and the claim that was wrong — it handled one error as all of them.
        answers = {
            'not-a-uuid': { error: { message: 'invalid input syntax for type uuid', status: 400 } },
            upstream: { error: { message: 'Internal Server Error', status: 500 } },
            offline: { error: { message: 'fetch failed' } },
        };

        const result = await auth.getUsers(
            [{ uid: 'not-a-uuid' }, { uid: 'upstream' }, { uid: 'offline' }],
        );

        expect(result.notFound).toEqual([]);
        expect(uidsIn(result.errored.map((e: any) => e.identifier)))
            .toEqual(['not-a-uuid', 'offline', 'upstream']);
    });

    it('AND A LOOKUP THAT THREW IS NOT AN ABSENCE EITHER', async () => {
        /*
         *   THE SECOND CASE THIS FILE'S DOUBLE COULD NOT PRODUCE, AND A SECOND
         *   MUTANT SURVIVED ON IT. The fake returned `error` objects only, so
         *   the shim's `catch` — which is a different branch, reached when the
         *   Supabase client throws rather than reporting — was never entered,
         *   and a mutant restoring `notFound.push(identifier)` there passed
         *   every test in this file.
         *
         *   A transport failure (DNS, TLS, a socket closed mid-request) throws.
         *   It is the least informative failure there is about whether an
         *   account exists, and it was the one the catch quietly called "this
         *   account does not exist".
         */
        answers = { dropped: { throws: 'socket hang up' } };

        const result = await auth.getUsers([{ uid: 'dropped' }]);

        expect(result.notFound).toEqual([]);
        expect(uidsIn(result.errored.map((e: any) => e.identifier))).toEqual(['dropped']);
        expect(result.errored[0].message).toBe('socket hang up');
    });

    it('AND THE STATUS DECIDES, NOT THE WORDING', async () => {
        /*
         *   THIS CASE WAS MISSING AND A MUTANT SURVIVED BECAUSE OF IT. The
         *   table below claimed "isAbsence checks the message only" would be
         *   killed; it was not, because every failing case here also had a
         *   message that did not match. The claim was right and the test did
         *   not earn it.
         *
         *   Why it matters: the message is GoTrue's and can be reworded at any
         *   release, while the status code is the part that means something. A
         *   401 is an absence only if this code decides to read it as one.
         */
        answers = { locked: { error: { message: 'no user not found here, key rejected', status: 401 } } };

        const result = await auth.getUsers([{ uid: 'locked' }]);

        expect(result.notFound).toEqual([]);
        expect(uidsIn(result.errored.map((e: any) => e.identifier))).toEqual(['locked']);
    });

    it('AND ALL THREE OUTCOMES SURVIVE IN ONE BATCH', async () => {
        /*
         *   How a partial failure actually arrives, and the property the
         *   backfill depends on: a batch of 100 where one lookup fails must
         *   still report the other 99 truthfully — neither downgrading them to
         *   "could not tell" nor promoting the failure to "absent".
         */
        answers = {
            here: { user: supabaseUser('here', 'ada@example.com') },
            broken: { error: { message: 'Invalid API key', status: 401 } },
        };

        const result = await auth.getUsers([{ uid: 'here' }, { uid: 'gone' }, { uid: 'broken' }]);

        expect(result.users.map((u: any) => u.uid)).toEqual(['here']);
        expect(uidsIn(result.notFound)).toEqual(['gone']);
        expect(uidsIn(result.errored.map((e: any) => e.identifier))).toEqual(['broken']);
    });

    it('AND IT STILL DOES NOT THROW, WHICH IS FIREBASE\'S CONTRACT AND FOUR CALLERS DEPEND ON IT', async () => {
        //   broadcast-logic.ts calls this at four places with chunks of 100.
        //   One member without an auth record must not fail the batch — that
        //   property is what `notFound` exists for, and #714 must not cost it.
        answers = { boom: { error: { message: 'Invalid API key', status: 401 } } };

        await expect(auth.getUsers([{ uid: 'boom' }])).resolves.toBeDefined();
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored from a snapshot copy
 *   and diffed after each. Each mutant proved it landed with a unique string.
 *
 *     MUTANT                                                        RESULT
 *     isAbsence always returns true — the defect, restored           KILLED
 *     isAbsence always returns false (a 404 becomes an error)        KILLED
 *     isAbsence checks the message only, ignoring status             KILLED
 *       — SURVIVED first. Every failing case in this file also had
 *         a message that did not match, so nothing distinguished the
 *         two readings. "AND THE STATUS DECIDES, NOT THE WORDING"
 *         was added: a 401 whose text happens to contain "user not
 *         found". The claim was right; the test had not earned it.
 *     the catch pushes to notFound again                             KILLED
 *       — SURVIVED first, and THE DOUBLE WAS AT FAULT. It returned
 *         `error` objects only, so the shim's catch — a different
 *         branch, entered when the client THROWS — was never run,
 *         and restoring the defect there passed every test. Supabase
 *         reports an HTTP failure and throws a transport one; a fake
 *         that models one of those cannot test code that handles
 *         both. Same shape as this repository's recurring finding:
 *         the rule was right and only some of its doors were covered.
 *     errored is returned but always empty                           KILLED
 *     the per-identifier message is replaced with a constant         KILLED
 *     getUsers throws on the first failure instead of continuing     KILLED
 *
 *     SURVIVED, AND RECORDED RATHER THAN CHASED
 *     `!data?.user` with no error is routed to errored               SURVIVED
 *       — that branch is unreachable against a truthful double.
 *         Supabase answers a missing id with a 404 ERROR, never with
 *         `{ user: null, error: null }`, so no honest fake can enter
 *         it. It stays as defence against a client-library change.
 *         Reaching it would mean making the double lie, which costs
 *         more than the branch is worth.
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                             SURVIVED ✓
 */
