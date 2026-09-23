/**
 *   THE OWNER: "i need users to be sorted by state" — then "add the sort users
 *   by state filter to all modules".
 *
 *   Every one of these lists already SHOWS a state: /admin/users has a State
 *   column, and the academy, export, farm-nation and cooperative readers each
 *   map one onto the row. None of them could put the list into that order. An
 *   admin looking for everybody in Kano had to page through the whole list.
 *
 * ── "UNKNOWN" IS NOT A STATE BEGINNING WITH U ───────────────────────────────
 *
 *   The finding that makes this worth a test rather than a line. Four of the
 *   readers write `state: mergedData.stateOfOrigin || "Unknown"`, and
 *   /admin/users writes `""`. A sort that ranks those as values files them
 *   between Taraba and Yobe — the one place an admin looking for Yobe will not
 *   think to look — and the blank ones open the ascending list, which is the
 *   least useful page of a list somebody opened in order to find a state.
 *
 *   Both file LAST, in both directions. That is #786's rule for the name sort,
 *   applied to the placeholder word as well as to the empty string.
 *
 * ── AND GENDER IS DELIBERATELY UNTOUCHED ────────────────────────────────────
 *
 *   The same collapse would improve the gender sort too, and nobody asked for
 *   it. Changing a sort an admin already relies on, inside a change that adds a
 *   different one, is how a feature arrives as a regression report. Asserted
 *   below so the restraint is a decision rather than an oversight.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';

import { adminSortKey, sortResolvedRows, IN_MEMORY_SORTS } from '@/lib/admin-row-sort';

const row = (state: string | undefined, createdAt: string, gender = 'female') => ({
    user: { state, gender, name: 'x' },
    data: { createdAt },
});

const statesOf = (rows: any[]) => rows.map((r) => r.user.state);

describe('the state sort', () => {
    it('IS ONE OF THE IN-MEMORY SORTS, so both branches of a reader see it', () => {
        //   #786's own ratchet: a sort wired into one branch and forgotten in
        //   the other is exactly what happened to gender.
        expect([...IN_MEMORY_SORTS]).toContain('state');
    });

    it('orders by the state the admin actually reads, both ways', () => {
        const rows = [
            row('Yobe', '2026-01-03T00:00:00.000Z'),
            row('Kano', '2026-01-02T00:00:00.000Z'),
            row('Abia', '2026-01-01T00:00:00.000Z'),
        ];

        sortResolvedRows(rows, 'state', 'asc');
        expect(statesOf(rows)).toEqual(['Abia', 'Kano', 'Yobe']);

        sortResolvedRows(rows, 'state', 'desc');
        expect(statesOf(rows)).toEqual(['Yobe', 'Kano', 'Abia']);
    });

    it.each(['asc', 'desc'] as const)('FILES "Unknown" LAST going %s', (dir) => {
        const rows = [
            row('Unknown', '2026-01-04T00:00:00.000Z'),
            row('Kano', '2026-01-03T00:00:00.000Z'),
            row('', '2026-01-02T00:00:00.000Z'),
            row(undefined, '2026-01-01T00:00:00.000Z'),
        ];

        sortResolvedRows(rows, 'state', dir);

        //   The named state first whichever way the arrow points; the three
        //   non-answers after it, in date order among themselves.
        expect(statesOf(rows)[0]).toBe('Kano');
        expect(statesOf(rows).slice(1).sort()).toEqual(['', 'Unknown', undefined]);
    });

    it('breaks ties on NEWEST FIRST, so the order is total', () => {
        //   Two people in the same state would otherwise swap places between
        //   two loads of the same page, which an admin reads as the data
        //   changing underneath them.
        const rows = [
            row('Kano', '2026-01-01T00:00:00.000Z'),
            row('Kano', '2026-06-01T00:00:00.000Z'),
        ];

        sortResolvedRows(rows, 'state', 'asc');

        expect(rows.map((r) => r.data.createdAt))
            .toEqual(['2026-06-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z']);
    });

    it('COLLAPSES every way these lists say "we do not know"', () => {
        for (const nothing of ['', '  ', 'Unknown', 'UNKNOWN', 'n/a', 'None', 'null', '-', undefined]) {
            expect({ input: nothing, key: adminSortKey(nothing) })
                .toEqual({ input: nothing, key: '' });
        }
        //   And a real state is not collapsed, or the sort would be empty.
        expect(adminSortKey('Kano')).toBe('kano');
    });

    it('LEAVES THE GENDER SORT EXACTLY AS IT WAS', () => {
        //   "Unknown" stays a value there. Not an oversight — see the header.
        const rows = [
            row('Kano', '2026-01-02T00:00:00.000Z', 'Unknown'),
            row('Kano', '2026-01-01T00:00:00.000Z', 'female'),
        ];

        sortResolvedRows(rows, 'gender', 'asc');

        expect(rows.map((r) => r.user.gender)).toEqual(['female', 'Unknown']);
    });
});

describe('and every module offers it', () => {
    /**
     *   "ALL MODULES" IS THE REQUEST, so it is checked rather than claimed. A
     *   seventh list added later without a state sort fails here, which is the
     *   only moment anybody would notice.
     */
    const READERS = [
        'src/app/actions/admin/_users.ts',
        'src/app/actions/admin/_academy.ts',
        'src/app/actions/admin/_exports.ts',
        'src/app/actions/academy/_ac_admin_applications.ts',
        'src/app/actions/cooperative/_coop_admin_members.ts',
        'src/app/actions/farm-nation-admin/_fna_registrants.ts',
        'src/app/actions/wave/_wv_admin_applications.ts',
    ];

    const SCREENS = [
        'src/app/admin/users/page.tsx',
        'src/app/admin/wave/applications/page.tsx',
        'src/app/admin/export/applications/page.tsx',
        'src/app/admin/farm-nation/applications/page.tsx',
        'src/app/admin/academy/applications/page.tsx',
        'src/app/admin/cooperatives/members/page.tsx',
    ];

    const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

    it.each(READERS)('%s ACCEPTS a state sort', (rel) => {
        const source = read(rel);
        //   The union the action's own options type declares. A reader that
        //   still types `"createdAt" | "gender"` rejects the value the screen
        //   now sends, and the list silently falls back to date order.
        expect({ rel, declares: /sortBy\?: "createdAt" \| "gender"[^;]*\| "state"/.test(source) })
            .toEqual({ rel, declares: true });
    });

    it.each(SCREENS)('%s OFFERS it', (rel) => {
        const source = read(rel);
        expect({ rel, offers: /value="state(-asc|-desc)?"/.test(source) })
            .toEqual({ rel, offers: true });
    });
});
