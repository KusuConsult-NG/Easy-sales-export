/**
 * @jest-environment node
 */

/**
 *   #477 A PERSON WITH SIX PROFILES GOT A DIFFERENT ONE DEPENDING ON WHICH ROW
 *   WAS EDITED LAST.
 *
 *   auth.ts ended its profile resolution with `?? userSnap.docs[0]`. The query
 *   carries no ORDER BY — measured, it is `select=id&email=eq.…` and nothing
 *   else — and Postgres promises no order without one. In MVCC an UPDATE writes
 *   the new row version at the END of the heap, so editing any row reorders the
 *   result. Demonstrated on a real cluster with six rows sharing an email:
 *
 *       initial                 order-1 order-2 order-3 order-4 order-5 order-6
 *       after editing order-1   order-2 order-3 order-4 order-5 order-6 order-1
 *       after editing order-3   order-2 order-4 order-5 order-6 order-1 order-3
 *
 *   A duplicated user was therefore signed in to a DIFFERENT profile whenever
 *   any of their rows was touched — sometimes the one carrying their
 *   registrations, sometimes a blank one. That is the owner's report, and it is
 *   why it came and went instead of staying broken.
 *
 *   NOT HYPOTHETICAL. Production, one query:
 *
 *       lubashehu369@gmail.com     6 profiles
 *       walidazayyanu74@gmail.com  5
 *       nancindaniel@gmail.com     5
 *       … many more on 3 and 4
 *
 *   PICKING AMONG THEM IS SAFE. Every candidate shares the email Supabase Auth
 *   has already proven the caller owns, so all of them are that person's rows.
 *   What the choice can get wrong is picking a WORSE one, which is why evidence
 *   orders them — and why the last comparison is the id, making it a TOTAL
 *   order. Totality is the point: even an imperfect choice must be the SAME
 *   choice every time, because data that appears and disappears is far harder to
 *   report and to trust than data that is consistently wrong.
 *
 *   NOTHING IS MERGED OR DELETED. Which row is canonical, and what becomes of
 *   the others, is an owner's decision about real people's data. This only stops
 *   the answer moving while that decision is made.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     back to docs[0]                          KILLED
 *     the id tiebreak dropped (order no longer total)  KILLED
 *     registration weight ignored              KILLED
 *     an identity link overridden by evidence  KILLED
 *     ambiguous never reported                 KILLED
 *     reword this header                       SURVIVED, as intended
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { stripComments } from '@/lib/testing/strip-comments';
import {
    chooseProfileForAuthAccount,
    registrationWeight,
    type ProfileCandidate,
} from '@/lib/profile-choice';

const AUTH_ID = 'auth-uuid-0001';

const row = (id: string, data: any = {}): ProfileCandidate => ({ id, data: () => data });

/** A blank auto-provisioned profile, as #476's branch writes them. */
const blank = (id: string) => row(id, { roles: ['general_user'], profileComplete: false });

/** The row carrying what the person actually did. */
const real = (id: string, extra: any = {}) =>
    row(id, {
        roles: ['wave_participant', 'academy_participant'],
        profileComplete: true,
        serviceRegistrations: { academy: { status: 'approved' }, wave: { status: 'pending' } },
        ...extra,
    });

// ─────────────────────────────────────────────────────────────────────────────
describe('#477 — the same person gets the same profile every time', () => {
    it('THE ANSWER DOES NOT DEPEND ON THE ORDER THE ROWS ARRIVE IN', () => {
        //   The assertion the whole finding is about. Row order changes on every
        //   edit; the chosen profile must not.
        const rows = [blank('b'), real('a'), blank('c'), real('d'), blank('e'), blank('f')];

        const answers = new Set<string>();
        for (const perm of [
            rows,
            [...rows].reverse(),
            [rows[3], rows[0], rows[5], rows[1], rows[4], rows[2]],
            [rows[2], rows[4], rows[1], rows[3], rows[0], rows[5]],
        ]) {
            answers.add(chooseProfileForAuthAccount(perm, AUTH_ID).chosen!.id);
        }

        expect([...answers]).toEqual(['a']);
    });

    it('AND IT IS THE ROW CARRYING THEIR REGISTRATIONS, not a blank one', () => {
        //   "Stable" alone is not enough — consistently returning the empty
        //   profile would satisfy the test above and still lose their enrolments.
        const chosen = chooseProfileForAuthAccount([blank('aaa'), real('zzz')], AUTH_ID);

        expect(chosen.chosen!.id).toBe('zzz');
        expect(chosen.reason).toBe('best-evidence');
    });

    it('AND IT SAYS SO — an evidence choice means these rows need reconciling', () => {
        const chosen = chooseProfileForAuthAccount([blank('a'), real('b')], AUTH_ID);

        expect({ ambiguous: chosen.ambiguous, candidates: chosen.candidates })
            .toEqual({ ambiguous: true, candidates: 2 });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#477 — an identity link always beats evidence', () => {
    /**
     * The three links are FACTS about which row belongs to this account.
     * Evidence is inference. A fix that let a richer row override a real link
     * would sign somebody into the wrong one of their own profiles, and worse,
     * would do it in the case where the answer was actually known.
     */
    it('THE DOCUMENT ID WINS, even against a much richer row', () => {
        const chosen = chooseProfileForAuthAccount([real('other'), blank(AUTH_ID)], AUTH_ID);

        expect({ id: chosen.chosen!.id, reason: chosen.reason, ambiguous: chosen.ambiguous })
            .toEqual({ id: AUTH_ID, reason: 'document-id', ambiguous: false });
    });

    it('THEN _migratedTo', () => {
        const chosen = chooseProfileForAuthAccount(
            [real('rich'), row('legacy', { _migratedTo: AUTH_ID })],
            AUTH_ID,
        );

        expect({ id: chosen.chosen!.id, reason: chosen.reason }).toEqual({ id: 'legacy', reason: 'migrated-pointer' });
    });

    it('THEN supabaseAuthId', () => {
        const chosen = chooseProfileForAuthAccount(
            [real('rich'), row('legacy', { supabaseAuthId: AUTH_ID })],
            AUTH_ID,
        );

        expect({ id: chosen.chosen!.id, reason: chosen.reason }).toEqual({ id: 'legacy', reason: 'supabase-auth-id' });
    });

    it('and a linked row is never reported as ambiguous', () => {
        for (const linked of [
            blank(AUTH_ID),
            row('x', { _migratedTo: AUTH_ID }),
            row('y', { supabaseAuthId: AUTH_ID }),
        ]) {
            expect(chooseProfileForAuthAccount([real('rich'), linked], AUTH_ID).ambiguous).toBe(false);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#477 — the order is total, so nothing is left to chance', () => {
    it('TWO IDENTICAL ROWS STILL RESOLVE THE SAME WAY EVERY TIME', () => {
        //   The case that makes it a TOTAL order. Without the id tiebreak these
        //   two compare equal and the result depends on sort stability, which
        //   depends on input order — the defect, reintroduced.
        const same = { roles: ['user'], profileComplete: true };
        const a = row('id-a', same);
        const b = row('id-b', same);

        expect(chooseProfileForAuthAccount([a, b], AUTH_ID).chosen!.id).toBe('id-a');
        expect(chooseProfileForAuthAccount([b, a], AUTH_ID).chosen!.id).toBe('id-a');
    });

    it('AND THE ORIGINAL ACCOUNT BEATS A LATER DUPLICATE when all else is equal', () => {
        const older = row('newer-id', { roles: ['user'], createdAt: '2024-01-01T00:00:00Z' });
        const newer = row('aaa-id', { roles: ['user'], createdAt: '2026-01-01T00:00:00Z' });

        expect(chooseProfileForAuthAccount([newer, older], AUTH_ID).chosen!.id).toBe('newer-id');
    });

    it('AND A ROW WITH NO READABLE DATE SORTS AFTER ONE THAT HAS ONE', () => {
        //   Not treated as infinitely old, which would let an undated stub beat
        //   the real account.
        const dated = row('zzz', { roles: ['user'], createdAt: '2025-01-01T00:00:00Z' });
        const undated = row('aaa', { roles: ['user'] });

        expect(chooseProfileForAuthAccount([undated, dated], AUTH_ID).chosen!.id).toBe('zzz');
    });

    it('and no candidates is answered, not thrown', () => {
        expect(chooseProfileForAuthAccount([], AUTH_ID))
            .toEqual({ chosen: null, reason: 'none', ambiguous: false, candidates: 0 });
    });

    it('and a malformed document does not break the comparison', () => {
        // Production data is not uniform; a row whose raw_data is null or a
        // string must not throw inside a login.
        const odd = [row('a', null), row('b', 'nonsense'), row('c', { roles: ['user'] })];

        expect(chooseProfileForAuthAccount(odd, AUTH_ID).chosen!.id).toBe('c');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#477 — registration weight is what "missing details" means', () => {
    it('COUNTS ONLY REGISTRATIONS THAT MEAN SOMETHING', () => {
        expect(registrationWeight({ serviceRegistrations: { a: { status: 'approved' }, b: { status: 'pending' } } })).toBe(2);
        expect(registrationWeight({ serviceRegistrations: { a: { status: 'not_started' } } })).toBe(0);
        expect(registrationWeight({ serviceRegistrations: { a: { status: '' } } })).toBe(0);
        expect(registrationWeight({ serviceRegistrations: {} })).toBe(0);
        expect(registrationWeight({})).toBe(0);
        expect(registrationWeight(null)).toBe(0);
    });

    it('AND MORE REGISTRATIONS BEATS MORE ROLES', () => {
        //   A blank profile can be given many roles by an admin; only the row
        //   they actually enrolled through carries registrations.
        const manyRoles = row('roles', { roles: ['a', 'b', 'c', 'd', 'e'], profileComplete: true });
        const oneReg = row('regs', { roles: ['user'], profileComplete: true, serviceRegistrations: { academy: { status: 'approved' } } });

        expect(chooseProfileForAuthAccount([manyRoles, oneReg], AUTH_ID).chosen!.id).toBe('regs');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#477 — the login uses it', () => {
    //   Comments stripped: this file DESCRIBES `?? userSnap.docs[0]` in its
    //   header, on purpose, so the next reader knows what was there. A raw scan
    //   reads the explanation as the defect — which it did, on the first run.
    const auth = () => stripComments(readFileSync('src/lib/auth.ts', 'utf-8'));

    it('docs[0] IS GONE FROM THE RESOLUTION', () => {
        expect(auth()).not.toContain('?? userSnap.docs[0]');
        expect(auth()).toContain('chooseProfileForAuthAccount(userSnap.docs, authedId)');
    });

    it('AND AN EVIDENCE CHOICE IS STILL LOGGED AS AN ERROR', () => {
        //   #477 makes the answer stable; it does not make it right. Somebody
        //   has to reconcile these rows, and they cannot if it is silent.
        const code = auth();

        expect(code).toContain('No profile identifies itself with the authenticated account');
        expect(code).toContain('need reconciling');
    });
});
