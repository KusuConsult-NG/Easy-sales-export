/**
 * @jest-environment node
 */

/**
 * Three more modules off the unreached list, all of them load-bearing.
 *
 *   lib/cooperative-member-identity decides what an admin is shown about a real
 *   member — the module exists because an active, PAID member was displayed
 *   with no name, no phone, no date of birth, no LGA and no address, over
 *   details that were one query away on their other membership row.
 *
 *   lib/postgrest-filters is the wire spelling for two database adapters. Its
 *   own header lists eight findings caused by one rule stated twice, and every
 *   form in it was verified against a real PostgREST — and then pinned by
 *   nothing, so a "simplification" could have undone all of it silently.
 *
 *   lib/server-seed turns a failed server read into a log line instead of a
 *   silence. It exists because #319's ratchet caught twenty-five pages checking
 *   `success` and never reading `error`.
 *
 *   None of the three was wrong. What none of them had was anything that would
 *   notice if they became wrong, which for the first two is a member's record
 *   and a query that returns the opposite of what was asked.
 */

import { describe, it, expect, jest } from '@jest/globals';
import {
    identityDetailScore, pickDetailRow, mergeMemberIdentity, fillFromSibling,
} from '@/lib/cooperative-member-identity';
import {
    quoteForInList, inList, quoteForLogicTree, jsonbArrayContainsAnyClause,
} from '@/lib/postgrest-filters';

const warn = jest.fn();
jest.mock('@/lib/logger', () => ({
    logger: {
        warn: (...a: unknown[]) => (globalThis as any).__warn(...a),
        error: jest.fn(), info: jest.fn(), debug: jest.fn(),
    },
}));
(globalThis as any).__warn = warn;
jest.mock('server-only', () => ({}));

// ─────────────────────────────────────────────────────────────────────────────
describe('which row carries the member', () => {
    it('A COMPLETED ONBOARDING OUTRANKS ANY NUMBER OF FIELDS', () => {
        //   It is the row the member themself filled in. A payment row can
        //   accumulate fields and must not overtake it.
        const onboarded = { onboardingCompleted: true, phone: '08030000000' };
        const stuffed = {
            firstName: 'A', lastName: 'B', phone: 'c', dateOfBirth: 'd', occupation: 'e',
            stateOfOrigin: 'f', lga: 'g', ward: 'h', residentialAddress: 'i', email: 'j',
        };

        expect(identityDetailScore(onboarded)).toBeGreaterThan(identityDetailScore(stuffed));
    });

    it('AND A BLANK STRING IS NOT A DETAIL', () => {
        expect(identityDetailScore({ phone: '   ', lga: '' })).toBe(0);
        expect(identityDetailScore({ nextOfKin: {} })).toBe(0);
        expect(identityDetailScore({ nextOfKin: { name: 'Ada' } })).toBe(1);
        expect(identityDetailScore(null)).toBe(0);
    });

    it('A SIBLING ONLY WINS WHERE IT IS STRICTLY BETTER', () => {
        //   THE property. This can never replace details with fewer details.
        const own: Record<string, any> = { phone: '0803', lga: 'Lokoja' };
        expect(pickDetailRow(own, [{ phone: '0701' }])).toBeNull();
        expect(pickDetailRow(own, [])).toBeNull();
        expect(pickDetailRow(own, [{ phone: '0701', lga: 'Lokoja', ward: 'W' }]))
            .toEqual({ phone: '0701', lga: 'Lokoja', ward: 'W' });
    });

    it('THE ROW IN HAND WINS EVERY FIELD IT HAS', () => {
        //   The sibling is inserted BETWEEN the row and the user document, so a
        //   member whose row is complete is unaffected by any of this.
        const merged = mergeMemberIdentity(
            { phone: '0803OWN', lga: 'OWN' },
            { phone: '0701USER', lga: 'USER' },
            { phone: '0805SIB', lga: 'SIB' },
        );

        expect(merged).toMatchObject({ phone: '0803OWN', lga: 'OWN' });
    });

    it('AND A BLANK FIELD CAN ONLY GO FROM BLANK TO FILLED', () => {
        const merged = mergeMemberIdentity(
            { phone: '' },
            { email: 'from-user@example.com' },
            { phone: '0805SIB', occupation: 'Farmer' },
        );

        expect(merged.phone).toBe('0805SIB');
        expect(merged.occupation).toBe('Farmer');
        expect(merged.email).toBe('from-user@example.com');
    });

    it('AND THE SCREEN IS TOLD WHICH ROW THE DETAILS CAME FROM', () => {
        //   So an admin is not left guessing why a member's profile is fuller
        //   than the record they opened.
        expect(mergeMemberIdentity({}, {}, { id: 'row-2', phone: '0805' }))
            .toMatchObject({ _detailsFromMemberRow: 'row-2' });
        expect(mergeMemberIdentity({}, {}, null)).not.toHaveProperty('_detailsFromMemberRow');
    });

    it('AND A ZERO FEE IS A FEE, which `||` would have swallowed', () => {
        //   registrationFee uses ?? rather than || precisely because 0 is a
        //   real answer. The row holding the money reported "Fee: N0" before
        //   this module; reporting it as *absent* would be the other defect.
        expect(mergeMemberIdentity({ registrationFee: 0 }, {}, { registrationFee: 5000 }).registrationFee)
            .toBe(0);
        expect(mergeMemberIdentity({}, {}, { registrationFee: 5000 }).registrationFee).toBe(5000);
    });

    it('fillFromSibling NEVER REPLACES A FIELD THE ROW HAS', () => {
        expect(fillFromSibling({ phone: '0803', lga: '' }, { phone: '0701', lga: 'Lokoja' }))
            .toEqual({ phone: '0803', lga: 'Lokoja' });
        expect(fillFromSibling({ phone: '0803' }, null)).toEqual({ phone: '0803' });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('how a filter is spelled on the wire', () => {
    it('A QUOTE INSIDE AN IN-LIST MEMBER IS ESCAPED', () => {
        //   Unescaped, the quote closes the member and everything after it
        //   becomes new entries — so `not.in` excluded the wrong rows.
        expect(quoteForInList('say "no"')).toBe('"say \\"no\\""');
        expect(quoteForInList('a\\b')).toBe('"a\\\\b"');
    });

    it('AND A COMMA INSIDE ONE DOES NOT SPLIT IT', () => {
        expect(inList(['a,b'])).toBe('("a,b")');
        expect(inList(['pending', 'in progress'])).toBe('("pending","in progress")');
        //   A bare value is a one-member list, not a character sequence.
        expect(inList('pending')).toBe('("pending")');
    });

    it('A LOGIC-TREE PAYLOAD IS QUOTED WHOLE', () => {
        //   `or=(raw_data->tags.cs.["a,b"])` is a PGRST100 parse error, because
        //   the tree parser splits on commas and parentheses.
        expect(quoteForLogicTree('["a,b"]')).toBe('"[\\"a,b\\"]"');
    });

    it('array-contains-any IS A DISJUNCTION OF CONTAINMENTS, not `ov`', () => {
        //   Postgres has no && for jsonb: `raw_data->"tags"=ov.["red"]` is
        //   42883, operator does not exist. Both adapters emitted it.
        const clause = jsonbArrayContainsAnyClause('raw_data->tags', ['red', 'green']);

        expect(clause).toBe('raw_data->tags.cs."[\\"red\\"]",raw_data->tags.cs."[\\"green\\"]"');
        expect(clause).not.toContain('ov.');
    });

    it('AND AN EMPTY LIST MATCHES NOTHING, spelled rather than left implicit', () => {
        /*
         *   The NATIVE branch already answers nothing for `roles=ov.{}`,
         *   measured. Matching it matters more than matching Firestore: a
         *   caller passing a computed list that came back empty must get the
         *   same answer whichever column shape the field happens to have.
         *   `or=()` is a parse error, so the contradiction is written out.
         */
        expect(jsonbArrayContainsAnyClause('raw_data->tags', []))
            .toBe('raw_data->tags.not.cs."[]"');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('a server seed that failed', () => {
    beforeEach(() => warn.mockClear());

    it('AN ACTION THAT THREW IS LOGGED, and the client fetches', async () => {
        const { seedOrNull } = await import('@/lib/server-seed');

        expect(seedOrNull('a screen', null)).toBeNull();
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0][0])).toContain('a screen');
    });

    it('AND A REFUSAL IS LOGGED WITH ITS REASON', () => {
        //   The whole finding: twenty-five pages read `success` and never
        //   `error`, so a failed server read left nothing anywhere.
        const { seedOrNull } = require('@/lib/server-seed');

        expect(seedOrNull('a screen', { success: false, error: 'Unauthorized' })).toBeNull();
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][1]).toEqual({ error: 'Unauthorized' });
    });

    it('AND A SUCCESS IS SILENT and hands back the data', () => {
        const { seedOrNull } = require('@/lib/server-seed');

        expect(seedOrNull('a screen', { success: true, data: { rows: 3 } })).toEqual({ rows: 3 });
        expect(warn).not.toHaveBeenCalled();
    });

    it('rawSeed HANDS THE WHOLE RESULT BACK, refusal and all', () => {
        //   The pages that derive from the envelope keep deciding what a
        //   refusal means; the server just stops being silent about it.
        const { rawSeed } = require('@/lib/server-seed');
        const refusal = { success: false, error: 'nope' };

        expect(rawSeed('a raw screen', refusal)).toBe(refusal);
        expect(warn).toHaveBeenCalledTimes(1);
    });

    it('AND IT NEVER THROWS — a seed failure must not break a working screen', () => {
        const { seedOrNull, rawSeed } = require('@/lib/server-seed');

        expect(() => seedOrNull('x', undefined)).not.toThrow();
        expect(() => rawSeed('x', undefined)).not.toThrow();
        expect(rawSeed('x', undefined)).toBeNull();
    });
});
