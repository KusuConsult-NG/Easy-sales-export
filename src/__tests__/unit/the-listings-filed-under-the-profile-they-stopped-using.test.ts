/**
 * @jest-environment node
 */

/**
 *   #904 (SECOND CAUSE) — THE SAME EMPTY SCREEN, REACHED A DIFFERENT WAY.
 *
 *   The owner, twice, across two sessions:
 *
 *       "when they click on my properties nothing is shown"
 *       "My properties are not listed under my property tab"
 *
 *   Migration 040 answered one cause: the seller was written onto the listing
 *   under the wrong KEY NAME, `userId` where every reader asks `ownerId`.
 *
 *   This is the other. The key is right and the VALUE is superseded. A seller
 *   with two profiles lists a parcel, an admin later settles the duplicate with
 *   the #724 tool, and the row keeps `ownerId: <the id that lost>` while the
 *   seller signs in as the one that won — profile-choice ranks a superseded row
 *   last (#490). My Properties asks for the live id and finds nothing.
 *
 *   No backfill can repair it without taking away the one promise the duplicate
 *   tool makes: settling a duplicate MOVES NO DATA, which is why clearing one
 *   field undoes it. So the pointer is followed on the READ.
 *
 * ── WHAT THIS SUITE IS ACTUALLY FOR ─────────────────────────────────────────
 *
 *   Two things, and the second matters more than the first.
 *
 *   THE CONTROL. A backward search finds candidates by querying either pointer
 *   field, so it also turns up a row carrying `supabaseAuthId: <us>` AND
 *   `_migratedTo: <somebody else>`. That row resolves to somebody else.
 *   Claiming it would put a stranger's listings on our screen and — because the
 *   ownership gates share this rule — hand us the right to edit and delete
 *   them. That is 040's disagreeing-keys case in a subtler form, and it is the
 *   one failure here that is worse than the bug.
 *
 *   AND THE AGREEMENT. #449 exists because six readers answered "who is this
 *   person" and five disagreed with the sixth. A backward rule is a seventh
 *   answer to the same question, and the way it fails is by disagreeing with
 *   the forward one. So this suite does not merely test the backward walk
 *   against a fixture: it takes every id the backward walk CLAIMS and runs the
 *   real forward walk from it, and requires it to land back on us.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import {
    MAX_MIGRATION_HOPS,
    MAX_OWNED_PROFILES,
    resolveActiveUser,
    resolveOwnedIdentities,
    resolveOwnedUserIds,
    type UserRow,
} from '@/lib/user-identity';
import { filterByOwner } from '@/lib/owned-profile-ids';

const ROOT = process.cwd();
const code = (rel: string) => stripComments(readFileSync(join(ROOT, rel), 'utf-8'), { label: rel });

// ─────────────────────────────────────────────────────────────────────────────
//   A world of rows, and the two readers a walk needs over it.
// ─────────────────────────────────────────────────────────────────────────────

type World = Record<string, UserRow>;

/** Forward: the row under this id. */
const readRow = (world: World) => async (id: string): Promise<UserRow | null> => world[id] ?? null;

/**
 * Backward: every row matching EITHER pointer field — deliberately as loose as
 * the real query, so `resolveOwnedIdentities` is the only thing filtering. A
 * fixture that pre-filtered would hide the defect this suite exists to catch.
 */
const readPointingAt = (world: World) => async (id: string) =>
    Object.entries(world)
        .filter(([, row]) => row._migratedTo === id || row.supabaseAuthId === id)
        .map(([rowId, row]) => ({ id: rowId, row }));

/** The seller in the report: one live row, and history behind it. */
const SELLER: World = {
    //   An active row carries its OWN id in supabaseAuthId — see `pointerOf`.
    live: { supabaseAuthId: 'live', email: 'seller@example.com' },
    //   Superseded straight onto the live row by the #724 tool.
    'old-1': { _migratedTo: 'live', email: 'seller@example.com' },
    //   A chain: 'old-2' → 'old-1' → 'live'. Two migrations, years apart.
    'old-2': { _migratedTo: 'old-1', email: 'seller@example.com' },
    //   Linked to the auth account and never tombstoned — user-migration.ts
    //   writes `supabaseAuthId` without always writing `_migratedTo`.
    linked: { supabaseAuthId: 'live', email: 'seller@example.com' },
    //   THE CONTROL. Shares our auth id and points somewhere else. Forward, it
    //   resolves to 'someone-else'. It is not ours.
    stranger: { supabaseAuthId: 'live', _migratedTo: 'someone-else' },
    'someone-else': { supabaseAuthId: 'someone-else' },
    //   Nothing to do with us at all.
    unrelated: { supabaseAuthId: 'another-live' },
    'another-live': { supabaseAuthId: 'another-live' },
};

// ─────────────────────────────────────────────────────────────────────────────
describe('#904 — which ids a seller\'s rows may be filed under', () => {
    it('THE REPORTED CASE: the superseded profile is found from the live one', async () => {
        const { ids } = await resolveOwnedIdentities('live', readPointingAt(SELLER));

        expect(ids).toContain('old-1');
    });

    it('AND THE CHAIN BEHIND IT, the whole way', async () => {
        //   'old-2' points at 'old-1', not at 'live'. A search that only asked
        //   "who points at me" and stopped would miss it — which is the
        //   two-hop split #449 measured, arriving from the other end.
        const { ids } = await resolveOwnedIdentities('live', readPointingAt(SELLER));

        expect(ids).toContain('old-2');
    });

    it('AND A ROW LINKED BY supabaseAuthId ALONE, never tombstoned', async () => {
        const { ids } = await resolveOwnedIdentities('live', readPointingAt(SELLER));

        expect(ids).toContain('linked');
    });

    it('THE CONTROL — A ROW POINTING SOMEWHERE ELSE IS NOT OURS, however it is linked', async () => {
        /*
         *   The half that would make this a theft rather than a repair, and the
         *   exact shape 040 refused: two keys that disagree. `stranger` carries
         *   our auth id, so the QUERY returns it; `pointerOf` reads
         *   `_migratedTo` first, so it resolves to somebody else.
         *
         *   Claiming it would list their land on our screen and let us delete
         *   it, because the ownership gates read this same rule.
         */
        const { ids } = await resolveOwnedIdentities('live', readPointingAt(SELLER));

        expect(ids).not.toContain('stranger');
        expect(ids).not.toContain('someone-else');
    });

    it('AND NOTHING UNRELATED, which is the vacuity guard', async () => {
        //   A resolver that returned every row would pass every test above.
        const { ids } = await resolveOwnedIdentities('live', readPointingAt(SELLER));

        expect(ids).not.toContain('unrelated');
        expect(ids).not.toContain('another-live');
        expect([...ids].sort()).toEqual(['linked', 'live', 'old-1', 'old-2']);
    });

    it('AND THE LIVE ID IS FIRST, AND APPEARS ONCE', async () => {
        //   The live row is returned by its own `supabaseAuthId`, so a walk
        //   without a seed in `seen` would list the caller twice and send a
        //   two-element IN list for an account with no duplicates at all.
        const { ids } = await resolveOwnedIdentities('live', readPointingAt(SELLER));

        expect(ids[0]).toBe('live');
        expect(ids.filter((id) => id === 'live')).toHaveLength(1);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#904 — and it agrees with the forward walk, which is the point', () => {
    it('EVERY ID CLAIMED RESOLVES FORWARD BACK TO US — run, not asserted', async () => {
        /*
         *   #449's defect was two rules disagreeing about one person. This is a
         *   seventh reader of that question, so the claim is proved by running
         *   the SIXTH against every answer this one gives.
         */
        const { ids } = await resolveOwnedIdentities('live', readPointingAt(SELLER));

        for (const id of ids) {
            const forward = await resolveActiveUser(id, readRow(SELLER));
            expect({ id, lands: forward.id }).toEqual({ id, lands: 'live' });
        }
    });

    it('AND EVERY ID IT REFUSED RESOLVES FORWARD SOMEWHERE ELSE', async () => {
        //   The other half of the same claim: refusing rows that DO resolve to
        //   us would leave the screen empty and pass the test above vacuously.
        const { ids } = await resolveOwnedIdentities('live', readPointingAt(SELLER));

        for (const id of Object.keys(SELLER).filter((k) => !ids.includes(k))) {
            const forward = await resolveActiveUser(id, readRow(SELLER));
            expect({ id, lands: forward.id }).not.toEqual({ id, lands: 'live' });
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#904 — the walk is bounded, in both directions equally', () => {
    /** live ← h1 ← h2 ← … ← h12. Longer than the forward walk will follow. */
    const CHAIN: World = {
        live: { supabaseAuthId: 'live' },
        h1: { _migratedTo: 'live' },
        ...Object.fromEntries(
            Array.from({ length: 11 }, (_, i) => [`h${i + 2}`, { _migratedTo: `h${i + 1}` }]),
        ),
    };

    it('IT STOPS WHERE THE FORWARD WALK STOPS — the same limit, not a similar one', async () => {
        const { ids, truncated } = await resolveOwnedIdentities('live', readPointingAt(CHAIN));

        //   The live id plus one row per hop the forward walk would follow.
        expect(ids).toHaveLength(MAX_MIGRATION_HOPS + 1);
        expect(truncated).toBe(true);
    });

    it('AND THE ROW JUST BEYOND IT DOES NOT RESOLVE TO US EITHER — measured', async () => {
        /*
         *   The reason the limits must be the SAME rather than merely both
         *   present. A backward search reaching further than the forward walk
         *   would claim rows that, asked the other way, belong to somebody the
         *   platform would never route to us.
         */
        const { ids } = await resolveOwnedIdentities('live', readPointingAt(CHAIN));
        const justBeyond = `h${MAX_MIGRATION_HOPS + 1}`;

        expect(ids).not.toContain(justBeyond);

        const forward = await resolveActiveUser(justBeyond, readRow(CHAIN));
        expect(forward.id).not.toBe('live');
        expect(forward.stoppedBecause).toBe('hop-limit');
    });

    it('AND A CYCLE TERMINATES', async () => {
        //   Two rows pointing at each other is what hung a login before #449.
        //   Here it is a search that would never stop expanding its frontier.
        const cycle: World = {
            live: { supabaseAuthId: 'live' },
            a: { _migratedTo: 'live' },
            b: { _migratedTo: 'a' },
            // …and back into the group, which BFS must not re-enter.
            c: { _migratedTo: 'b', supabaseAuthId: 'live' },
        };

        const { ids } = await resolveOwnedIdentities('live', readPointingAt(cycle));

        expect([...ids].sort()).toEqual(['a', 'b', 'c', 'live']);
    });

    it('AND A FAN-OUT IS CAPPED, AND SAYS SO', async () => {
        const many: World = { live: { supabaseAuthId: 'live' } };
        for (let i = 0; i < MAX_OWNED_PROFILES * 2; i += 1) many[`dup${i}`] = { _migratedTo: 'live' };

        const { ids, truncated } = await resolveOwnedIdentities('live', readPointingAt(many));

        expect(ids).toHaveLength(MAX_OWNED_PROFILES);
        expect(truncated).toBe(true);
    });

    it('AND AN ORDINARY ACCOUNT COSTS NOTHING AND GAINS NOTHING', async () => {
        //   Nearly every account. `truncated` false, one id, no fan-out — the
        //   claim that this change cannot alter the common case.
        const alone: World = { live: { supabaseAuthId: 'live' } };

        expect(await resolveOwnedIdentities('live', readPointingAt(alone)))
            .toEqual({ ids: ['live'], truncated: false, depth: 1 });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#904 — the collection form asks both pointer fields', () => {
    /** Records what was queried, and answers from a world. */
    function collectionOver(world: World) {
        const asked: { field: string; value: unknown }[] = [];
        return {
            asked,
            where(field: string, _op: string, value: unknown) {
                asked.push({ field, value });
                return {
                    limit: () => ({
                        get: async () => ({
                            docs: Object.entries(world)
                                .filter(([, row]) => (row as any)[field] === value)
                                .map(([id, row]) => ({ id, data: () => row })),
                        }),
                    }),
                };
            },
        };
    }

    it('BOTH, NOT JUST `_migratedTo` — a row can be linked by either', async () => {
        const collection = collectionOver(SELLER);

        await resolveOwnedUserIds('live', collection as any);

        expect(collection.asked.map((a) => a.field)).toContain('_migratedTo');
        expect(collection.asked.map((a) => a.field)).toContain('supabaseAuthId');
    });

    it('AND FINDS THE SAME ROWS THE RULE DOES, THROUGH A QUERY', async () => {
        const { ids } = await resolveOwnedUserIds('live', collectionOver(SELLER) as any);

        expect([...ids].sort()).toEqual(['linked', 'live', 'old-1', 'old-2']);
    });

    it('AND EVERY QUERY IS BOUNDED', async () => {
        //   Without a limit, one pathological id reads the user table into
        //   memory before the cap in the rule ever gets to refuse it.
        expect(code('src/lib/user-identity.ts')).toContain('.limit(MAX_OWNED_PROFILES)');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#904 — the filter keeps the common case byte-identical', () => {
    /** The smallest thing that records how it was narrowed. */
    const spy = () => {
        const calls: { field: string; op: string; value: unknown }[] = [];
        const q: any = {
            calls,
            where(field: string, op: string, value: unknown) {
                calls.push({ field, op, value });
                return q;
            },
        };
        return q;
    };

    it('ONE ID IS STILL `==`, with the same value', () => {
        /*
         *   The claim that an account with no duplicates runs exactly the query
         *   it ran before this existed — same operator, same value, same plan.
         *   A change that cannot alter the common case cannot regress it.
         */
        const q = spy();
        filterByOwner(q, 'ownerId', ['live']);

        expect(q.calls).toEqual([{ field: 'ownerId', op: '==', value: 'live' }]);
    });

    it('AND SEVERAL BECOME ONE `in`, not several ANDed equalities', () => {
        //   Chaining `.where(f,'==',a).where(f,'==',b)` would ask for a row
        //   owned by two people at once and return nothing at all.
        const q = spy();
        filterByOwner(q, 'ownerId', ['live', 'old-1']);

        expect(q.calls).toEqual([{ field: 'ownerId', op: 'in', value: ['live', 'old-1'] }]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#904 — the screens that were empty now ask the widened question', () => {
    const MY_LISTINGS = 'src/app/actions/land-actions.ts';
    const MY_PROPERTIES = 'src/app/actions/farm-nation/_fn_listings.ts';
    const DASHBOARD = 'src/app/actions/farm-nation/_fn_dashboard.ts';

    it.each([
        ['My Properties', MY_LISTINGS],
        ['the other door onto it', MY_PROPERTIES],
        ['the count above it', DASHBOARD],
    ])('%s resolves the owner ids before it queries', (_name, file) => {
        expect(code(file)).toContain('ownedProfileIds(');
    });

    it.each([
        ['My Properties', MY_LISTINGS],
        ['the other door onto it', MY_PROPERTIES],
        ['the count above it', DASHBOARD],
    ])('%s no longer filters on the session id alone — the defect, as its absence', (_name, file) => {
        /*
         *   Stated against the STRIPPED source: #651 recorded a claim met by a
         *   comment describing the very thing it forbade.
         */
        const src = code(file);

        expect(src).not.toMatch(/\.where\(\s*['"]ownerId['"]\s*,\s*['"]==['"]\s*,\s*(session\.)?user(Id|\.id)/);
    });

    it('AND THE COUNT AND THE LIST CANNOT DISAGREE', () => {
        //   Widening one and not the other trades an empty screen for a
        //   contradictory one — "3 properties" over a list of one.
        const dash = code(DASHBOARD);

        expect(dash.match(/filterByOwner\(/g) ?? []).toHaveLength(2);   // query + fallback
    });

    it('AND THE FALLBACK PATHS WIDENED TOO', () => {
        //   A fallback answering a narrower question than the query it replaces
        //   is how a screen silently loses rows exactly when already degraded.
        expect(code(MY_PROPERTIES).match(/filterByOwner\(/g) ?? []).toHaveLength(2);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#904 — and a listing that appears can be opened, edited and deleted', () => {
    const LAND = 'src/app/actions/land-actions.ts';

    it('THE GATES USE THE SAME RULE, walked forwards', () => {
        /*
         *   #884: "a seller could not see, or edit, anything they had listed".
         *   A screen that lists a row and then refuses every action on it is
         *   that complaint returned in a politer form.
         */
        expect(code(LAND).match(/isOwnedBySession\(/g) ?? []).toHaveLength(4);
    });

    it('AND NO GATE STILL COMPARES THE OWNER BY `!==`', () => {
        //   The defect, stated as its absence: `!==` refuses the one person
        //   these gates exist to admit.
        const src = code(LAND);

        expect(src).not.toMatch(/ownerId\s*!==\s*(session\.)?user(Id|\.id)/);
        expect(src).not.toMatch(/viewer(Id)?!?\.?id\s*!==\s*data\.ownerId/);
    });
});
