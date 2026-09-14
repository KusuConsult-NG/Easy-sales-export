/**
 * @jest-environment node
 */

/**
 *   #734 SEVEN PATHS IN broadcast-logic ADD AN EMAIL TO A BROADCAST. ONE OF
 *        THEM ASKED WHETHER IT SHOULD.
 *
 *   #733 found this on the SMS door and fixed it in that file's funnel. This is
 *   the email door, and it is worse: `isContactableAccount` is imported into
 *   broadcast-logic and used correctly by the reader #697 repaired — and by no
 *   other reader in the same file.
 *
 *     THREE USER-DOCUMENT READERS had the row in hand and never asked.
 *     `getCollectionBroadcastList` is one of them, and six audiences route
 *     through it: cooperative_members, wave_applicants,
 *     wave_briefing_registrants, farm_nation_users, export_users and
 *     academy_users.
 *
 *     FOUR SUPABASE AUTH FALLBACKS resurrect an address for a user whose row
 *     carries none. There is no document there to ask about, so none of them
 *     could have used isContactableAccount — and none recognised the tombstone
 *     from the address either.
 *
 * ── AND THE COST, AGAIN, IS NOT THE ERASED MEMBER ───────────────────────────
 *
 *   An erased row carries `deleted_<uid>@redacted.local`, and revokeAuthAccess
 *   rewrites the Auth email to the same thing — so the worst an erased account
 *   costs is a send to a domain that does not resolve. That is not a privacy
 *   breach; it is a guaranteed HARD BOUNCE, which is precisely what
 *   BOUNCED_EMAILS and #694 exist to keep off this platform's sending
 *   reputation.
 *
 *   The live cost is the SUPERSEDED row. #724's duplicate-profile tool marks
 *   `_migratedTo` and keeps every field, deliberately, so an admin's decision
 *   stays reversible — which means the row holds the person's REAL address. The
 *   member an admin de-duplicated received every email broadcast twice.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file. Run
 *   before the table was written.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { stripComments } from '@/lib/testing/strip-comments';
import { isErasedAddress, isContactableAccount } from '@/lib/contactable-account';

const LOGIC = 'src/lib/broadcast-logic.ts';
const code = () => stripComments(readFileSync(LOGIC, 'utf-8'), { label: LOGIC });

// ─────────────────────────────────────────────────────────────────────────────
describe('#734 — the tombstone is recognisable from the address alone', () => {
    it('THE ERASURE DOMAIN IS REFUSED', () => {
        expect(isErasedAddress('deleted_abc123@redacted.local')).toBe(true);
        //   Case and surrounding space are not a way past it.
        expect(isErasedAddress('  DELETED_ABC@Redacted.Local  ')).toBe(true);
    });

    it('AND A REAL ADDRESS IS NOT', () => {
        //   Vacuity guard: a predicate that refused everything would empty
        //   every audience, which is worse than the defect.
        for (const real of ['ada@example.com', 'chidi@gmail.com', '']) {
            expect(isErasedAddress(real)).toBe(false);
        }
        expect(isErasedAddress(null)).toBe(false);
        expect(isErasedAddress(undefined)).toBe(false);
    });

    it('AND AN ADDRESS THAT MERELY CONTAINS THE DOMAIN IS NOT THE TOMBSTONE', () => {
        /*
         *   `endsWith`, not `includes` — and my first version of this test did
         *   not tell them apart. `redacted.local@example.com` does not contain
         *   "@redacted.local" at all, so both operators answer false and a
         *   mutant swapping one for the other SURVIVED.
         *
         *   The case that separates them is an address that CONTAINS the domain
         *   without ending in it, which is also the one that matters: under
         *   `includes`, anybody registering a subdomain of it would be silently
         *   dropped from every broadcast — a real member, never contacted, with
         *   nothing to show why.
         */
        expect(isErasedAddress('deleted_u1@redacted.local.example.com')).toBe(false);
        expect(isErasedAddress('redacted.local@example.com')).toBe(false);

        //   And the genuine tombstone still is one, so the line above has not
        //   simply turned the check off.
        expect(isErasedAddress('deleted_u1@redacted.local')).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#734 — every email path in broadcast-logic asks first', () => {
    it('EVERY USER-DOCUMENT READER CALLS isContactableAccount', () => {
        /*
         *   Counted from the source rather than listed, so a fourth reader
         *   added later fails here instead of shipping unguarded — #727's
         *   lesson, and the reason this finding exists at all.
         */
        const lines = code().split('\n');

        const readers = lines.filter((l) =>
            l.trim() === 'const d = userDoc.data() as any;'
            || l.trim() === 'const d = doc.data() as any;');
        const guards = lines.filter((l) => /if \(!isContactableAccount\(d, (userDoc|doc)\.id\)\) return;/.test(l));

        expect(readers.length).toBeGreaterThanOrEqual(3);
        expect(guards.length).toBe(readers.length);
    });

    it('AND EVERY AUTH FALLBACK REFUSES THE TOMBSTONE ADDRESS', () => {
        const lines = code().split('\n');

        const fallbacks = lines.filter((l) => l.includes('result.users.forEach(authUser'));
        const guards = lines.filter((l) => l.includes('isErasedAddress(authUser.email)'));

        expect(fallbacks.length).toBeGreaterThanOrEqual(4);
        expect(guards.length).toBe(fallbacks.length);
    });

    it('AND THE GUARD COMES BEFORE THE ADDRESS IS USED, NOT AFTER', () => {
        /*
         *   A check below the `emailMap.set` would run and change nothing. The
         *   first reader is checked positionally; the counts above hold the
         *   rest.
         */
        const src = code();
        const readAt = src.indexOf('const d = userDoc.data() as any;');
        const guardAt = src.indexOf('if (!isContactableAccount(d, userDoc.id)) return;');
        const useAt = src.indexOf('emailMap.set(', guardAt);

        expect(readAt).toBeGreaterThan(-1);
        expect(guardAt).toBeGreaterThan(readAt);
        expect(useAt).toBeGreaterThan(guardAt);
    });

    it('AND THE RULE IS ONE FUNCTION, NOT SEVEN SPELLINGS OF endsWith', () => {
        //   Four copies of a rule is the defect this finding is an instance of.
        //   The file must not carry its own inline version.
        const src = code();
        const inline = src.split('\n').filter((l) =>
            l.includes('@redacted.local') && !l.includes('isErasedAddress'));

        expect(inline).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#734 — what the guard actually refuses', () => {
    it('A SUPERSEDED ROW — the live case', () => {
        //   Keeps its real address, because #724 destroys nothing on purpose.
        const superseded = { _migratedTo: 'live-uid', email: 'ada@example.com' };
        expect(isContactableAccount(superseded, 'old-uid')).toBe(false);
    });

    it('AND AN ERASED ROW', () => {
        expect(isContactableAccount({ deleted: true, email: 'x@y.com' }, 'u1')).toBe(false);
        expect(isContactableAccount({ email: 'deleted_u1@redacted.local' }, 'u1')).toBe(false);
    });

    it('AND NOTHING ELSE — a live member is still reachable', () => {
        //   The direction that must not move: this change must not shrink a
        //   legitimate audience.
        expect(isContactableAccount({ email: 'ada@example.com' }, 'u1')).toBe(true);
        expect(isContactableAccount({ email: 'ada@example.com', _migratedTo: 'u1' }, 'u1')).toBe(true);
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored from a snapshot copy,
 *   each mutant proving its edit landed by a unique string on disk. RUN BEFORE
 *   THIS TABLE WAS WRITTEN.
 *
 *     MUTANT                                                        RESULT
 *     one user-document reader loses its guard                       KILLED
 *     one Auth fallback loses its guard                              KILLED
 *     the guard moves below emailMap.set                             KILLED
 *     isErasedAddress uses includes instead of endsWith    SURVIVED → KILLED
 *     isErasedAddress stops lowercasing                              KILLED
 *     isErasedAddress refuses everything                             KILLED
 *     the file goes back to an inline @redacted.local check          KILLED
 *     supersession stops being refused                               KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                             SURVIVED ✓
 *
 *   THE ONE THAT SURVIVED, AND WHY IT IS WORTH RECORDING. Swapping `endsWith`
 *   for `includes` changed no answer my tests asked about:
 *   `redacted.local@example.com` does not contain "@redacted.local" at all, so
 *   both operators return false and the assertion held against a weaker rule.
 *
 *   The case that separates them is an address CONTAINING the domain without
 *   ending in it — `deleted_u1@redacted.local.example.com` — and it is also the
 *   case that matters: under `includes`, a real member on any subdomain of it
 *   would be dropped from every broadcast silently, with nothing to show why.
 *   Added, and the mutant now dies.
 */
