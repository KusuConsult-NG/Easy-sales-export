/**
 * @jest-environment node
 */

/**
 *   #802 THE DUPLICATE WORKLIST REPORTED SETTLED MIGRATIONS AS CYCLES, AND ON
 *        SOME GROUPS IT NAMED THE WRONG RECORD AS THE PERSON.
 *
 *   Counted on production, from the screen itself:
 *
 *        3   need a decision
 *      153   "Look at this one"
 *      340   already settled
 *
 *   The 153 is the finding. How many of them this rule moves is NOT knowable
 *   from that page — it lists groups, not a tally by shape, and the reader
 *   here has no production access to count with. What IS established is the
 *   shape, which recurs down the whole listing, and what the rule does to it;
 *   both are pinned below. Read one:
 *
 *      abu***@gmail.com — "Every record here points at another one, so none of
 *                          them is the live row. That is a cycle and needs a
 *                          person to break it."
 *
 *        Abubakar Idris Sada   superseded → 056fb90f-…-cbe4ec515335
 *          id: 056fb90f-…-cbe4ec515335          ← ITS OWN ID
 *        Abubakar Idris Sada   superseded → 056fb90f-…-cbe4ec515335
 *          id: Pesx64ovcHT5TLEtxIbEGE8gC2D2
 *
 *   That is not a cycle. It is the most ordinary thing in this table: a legacy
 *   row tombstoned onto a live row, where the live row's `_migratedTo` happens
 *   to name itself. The screen printed the live record as "superseded → its own
 *   id" and asked a person to break a loop that was never there.
 *
 * ── THE RULE ALREADY EXISTED EVERYWHERE ELSE ────────────────────────────────
 *
 *   resolveActiveUser, which every session and every money path walks:
 *
 *       const next = pointerOf(row);
 *       if (!next || next === id) { ... stoppedBecause: "no-pointer" }
 *
 *   _wallet_consolidation, looking for superseded rows:
 *
 *       // A row pointing at ITSELF is not superseded — that is what
 *       // `supabaseAuthId` looks like on an ordinary linked account.
 *       if (typeof pointer === "string" && pointer !== "" && pointer !== d.id)
 *
 *   checkResolution, in the very file under test, allows a self-pointing row to
 *   be kept: `keeper.migratedTo && keeper.migratedTo !== keepId`.
 *
 *   classifyGroup was the one reader that put every `_migratedTo` into its
 *   pointer map, so a self-pointing row was never among the live ones.
 *
 * ── WHY IT IS WORSE THAN NOISE ──────────────────────────────────────────────
 *
 *   On a group with SOME self-pointers, the wrong row survives as "live". The
 *   five-record address nan***@gmail.com on production:
 *
 *       7yjpDVz0…  → d3ef4bc4        3 registrations
 *       d3ef4bc4…  → d3ef4bc4        3 registrations   ← self, and the real one
 *       3b271e8c…  → 3b271e8c        2 registrations   ← self
 *       Au7tPudF…  → 3b271e8c        2 registrations
 *       e06bda6b…  (no pointer)      1 registration
 *
 *   Only e06bda6b had no pointer at all, so the screen said "One live record,
 *   but the superseded ones do not all point at it. Re-pointing them at the
 *   same row will settle it" — advice that would have superseded the two rows
 *   the login actually prefers, in favour of the thinnest record at the
 *   address.
 *
 *   The forensic scan classifies through this same function on purpose (#736,
 *   "a second definition in this file is how the two would come to disagree"),
 *   so whatever this miscounts on the worklist it also miscounts there. One
 *   rule, one fix, both reports.
 *
 *   AND THE RECLASSIFICATION IS NOT ALL ONE WAY, which is why no blanket claim
 *   is made above. `{A → A, B → A}` becomes `resolved` and leaves the list.
 *   `{A → A, B → B}` becomes `needs-a-decision` and is work that was never
 *   shown as work. The five-record case below stays on the list and changes
 *   its advice. Each is asserted separately.
 *
 *   MUTATION-TESTED, WITH CONTROLS — table at the foot of this file.
 */

import { describe, it, expect } from '@jest/globals';
import {
    classifyGroup,
    describeGroup,
    checkResolution,
} from '@/lib/duplicate-profile-resolution';
import { resolveActiveUser } from '@/lib/user-identity';

const row = (id: string, migratedTo?: string, extra: Record<string, unknown> = {}) => ({
    id,
    data: { ...(migratedTo ? { _migratedTo: migratedTo } : {}), ...extra },
});

/** The group as `describeGroup` renders it, without the I/O. */
const describe_ = (rows: { id: string; data: Record<string, unknown> }[]) =>
    describeGroup('a@b.c', 'a***@b.c', rows);

// ─────────────────────────────────────────────────────────────────────────────
describe('#802 — a self-pointer is not a supersession', () => {
    /**
     * The exact production shape, reduced to its two rows. This is the single
     * assertion that would have kept 153 groups off the worklist.
     */
    it('THE PAIR THE SCREEN CALLED A CYCLE IS AN ORDINARY SETTLED MIGRATION', () => {
        const verdict = classifyGroup([
            row('056fb90f', '056fb90f'),
            row('Pesx64ov', '056fb90f'),
        ]);

        expect(verdict.state).toBe('resolved');
        expect(verdict.explanation).toContain('nothing to do');
    });

    it('and the live record is no longer printed as superseded to itself', () => {
        const group = describe_([
            row('056fb90f', '056fb90f'),
            row('Pesx64ov', '056fb90f'),
        ]);

        const live = group.candidates.find((c) => c.id === '056fb90f')!;
        expect(live.migratedTo).toBeNull();

        // The genuinely superseded row still says where it went.
        expect(group.candidates.find((c) => c.id === 'Pesx64ov')!.migratedTo).toBe('056fb90f');
    });

    it('TWO SELF-POINTING ROWS ARE TWO RIVAL RECORDS, NOT A CYCLE', () => {
        // Nothing points at anything, so this is the ordinary "pick one".
        const verdict = classifyGroup([row('a', 'a'), row('b', 'b')]);

        expect(verdict.state).toBe('needs-a-decision');
        expect(verdict.explanation).toContain('none points at another');
    });

    it('and a self-pointer at the END of a chain still settles the group', () => {
        // c → b → a → a. One live row, everything downstream of it.
        expect(classifyGroup([
            row('a', 'a'),
            row('b', 'a'),
            row('c', 'a'),
        ]).state).toBe('resolved');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#802 — the five-record address, as production holds it', () => {
    const NANCHIN = [
        row('7yjpDVz0', 'd3ef4bc4', { serviceRegistrations: { academy: { status: 'approved' } } }),
        row('d3ef4bc4', 'd3ef4bc4', { serviceRegistrations: { academy: { status: 'approved' } } }),
        row('3b271e8c', '3b271e8c'),
        row('Au7tPudF', '3b271e8c'),
        row('e06bda6b'),
    ];

    it('IS REPORTED AS THREE RIVAL LIVE RECORDS, NOT ONE', () => {
        const verdict = classifyGroup(NANCHIN);

        expect(verdict.state).toBe('inconsistent');
        // The sentence an operator acts on. "3 records are live and 2 are
        // superseded" is a different instruction from "re-point them all".
        expect(verdict.explanation).toContain('3 records are live');
        expect(verdict.explanation).toContain('Choose which of the live ones is the person');
    });

    it('and it no longer tells the operator to re-point everything at the thinnest row', () => {
        const verdict = classifyGroup(NANCHIN);
        expect(verdict.explanation).not.toContain('Re-pointing them at the same row');
    });

    it('the two self-pointing rows read as live, the two real tombstones as superseded', () => {
        const group = describe_(NANCHIN);
        const pointerOf = (id: string) => group.candidates.find((c) => c.id === id)!.migratedTo;

        expect({
            d3ef4bc4: pointerOf('d3ef4bc4'),
            '3b271e8c': pointerOf('3b271e8c'),
            '7yjpDVz0': pointerOf('7yjpDVz0'),
            Au7tPudF: pointerOf('Au7tPudF'),
            e06bda6b: pointerOf('e06bda6b'),
        }).toEqual({
            d3ef4bc4: null,
            '3b271e8c': null,
            '7yjpDVz0': 'd3ef4bc4',
            Au7tPudF: '3b271e8c',
            e06bda6b: null,
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#802 — THE INVARIANT: this file and the resolver agree on who is live', () => {
    /**
     *   The property, not a restatement of the fix.
     *
     *   resolveActiveUser is what a session, a checkout and a wallet lookup all
     *   walk. If it lands on a row this classifier counts as superseded, the
     *   screen is recommending against the platform — which is the one thing
     *   the module header forbids ("the recommendation cannot disagree with the
     *   row the platform would actually hand somebody").
     *
     *   Asserted by RUNNING the resolver over the same rows rather than by
     *   re-deriving its rule here, because a second copy of the rule is exactly
     *   how the two drifted apart in the first place.
     */
    const GROUPS: Record<string, { id: string; data: Record<string, unknown> }[]> = {
        'settled pair with a self-pointing live row': [row('a', 'a'), row('b', 'a')],
        'settled pair with a bare live row': [row('a'), row('b', 'a')],
        'two self-pointing rivals': [row('a', 'a'), row('b', 'b')],
        'a chain ending on a self-pointer': [row('a', 'a'), row('b', 'a'), row('c', 'b')],
        'the five-record address': [
            row('7yjpDVz0', 'd3ef4bc4'), row('d3ef4bc4', 'd3ef4bc4'),
            row('3b271e8c', '3b271e8c'), row('Au7tPudF', '3b271e8c'), row('e06bda6b'),
        ],
    };

    it.each(Object.keys(GROUPS))(
        'every id in "%s" resolves to a row this file calls live',
        async (name) => {
            const rows = GROUPS[name];
            const byId = new Map(rows.map((r) => [r.id, r.data]));
            const readRow = async (id: string) => byId.get(id) ?? null;

            // Who the platform lands on, from each starting point.
            const landedOn = new Set<string>();
            for (const r of rows) {
                landedOn.add((await resolveActiveUser(r.id, readRow)).id);
            }

            // Who this file calls live: a row with no pointer of its own.
            const liveHere = new Set(
                describe_(rows).candidates.filter((c) => c.migratedTo === null).map((c) => c.id),
            );

            const disagreements = [...landedOn].filter((id) => !liveHere.has(id));
            expect({ name, disagreements }).toEqual({ name, disagreements: [] });
        },
    );

    it('POSITIVE CONTROL: the resolver really does stop on a self-pointer', async () => {
        // Without this, "they agree" could mean the resolver was never
        // exercised and the loop above compared an empty set against anything.
        const resolved = await resolveActiveUser('a', async (id) =>
            ({ a: { _migratedTo: 'a' } } as Record<string, any>)[id] ?? null);

        expect(resolved.id).toBe('a');
        expect(resolved.stoppedBecause).toBe('no-pointer');
        expect(resolved.hops).toBe(0);
    });

    it('POSITIVE CONTROL: and it does NOT stop on a pointer at somebody else', async () => {
        const rows: Record<string, any> = { a: { _migratedTo: 'b' }, b: {} };
        const resolved = await resolveActiveUser('a', async (id) => rows[id] ?? null);

        expect(resolved.id).toBe('b');
        expect(resolved.hops).toBe(1);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#802 — and the states that were already right stay right', () => {
    /**
     * The fix removes one class of row from the pointer map and nothing else.
     * These are the branches it must not have taken with it — a "cycle" arm
     * that can no longer fire would be the obvious way to make the tests above
     * pass while losing a real finding.
     */
    it('A GENUINE CYCLE IS STILL A CYCLE', () => {
        const verdict = classifyGroup([row('a', 'b'), row('b', 'a')]);

        expect(verdict.state).toBe('inconsistent');
        expect(verdict.explanation).toContain('cycle');
    });

    it('a three-way cycle too', () => {
        expect(classifyGroup([row('a', 'b'), row('b', 'c'), row('c', 'a')]).explanation)
            .toContain('cycle');
    });

    it('a chain leaving the address is still followed, not settled here', () => {
        const verdict = classifyGroup([row('a', 'elsewhere'), row('b', 'a')]);

        expect(verdict.state).toBe('inconsistent');
        expect(verdict.explanation).toContain('elsewhere');
    });

    it('two rival records with no pointers at all still need a decision', () => {
        expect(classifyGroup([row('a'), row('b')]).state).toBe('needs-a-decision');
    });

    it('an ordinary tombstoned pair is still resolved', () => {
        expect(classifyGroup([row('a'), row('b', 'a')]).state).toBe('resolved');
    });

    it('and superseded rows pointing at different places are still inconsistent', () => {
        const verdict = classifyGroup([row('a'), row('b', 'a'), row('c', 'somewhere')]);
        expect(verdict.state).toBe('inconsistent');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#802 — applying a decision is unchanged', () => {
    /**
     * checkResolution already tolerated a self-pointing keeper, so the fix must
     * not have altered what may be applied — only what is SHOWN. Both
     * directions are pinned: the permission that existed, and the refusal that
     * must survive.
     */
    it('a self-pointing record may still be kept', () => {
        const group = describe_([row('a', 'a'), row('b', 'a')]);

        expect(checkResolution({ group, keepId: 'a', supersedeIds: ['b'] })).toEqual({ ok: true });
    });

    it('AND A GENUINELY SUPERSEDED RECORD STILL CANNOT BE, NAMING WHERE IT POINTS', () => {
        const group = describe_([row('a', 'b'), row('b')]);
        const verdict = checkResolution({ group, keepId: 'a', supersedeIds: ['b'] });

        expect(verdict.ok).toBe(false);
        expect((verdict as { reason: string }).reason).toContain('b');
    });

    it('and a record still cannot supersede itself', () => {
        const group = describe_([row('a', 'a'), row('b', 'a')]);

        expect(checkResolution({ group, keepId: 'a', supersedeIds: ['a'] }))
            .toEqual({ ok: false, reason: 'A record cannot supersede itself.' });
    });
});

/*
 * ── MUTATION TABLE ──────────────────────────────────────────────────────────
 *
 *   Each mutant applied to src/lib/duplicate-profile-resolution.ts alone, then
 *   this suite AND a-decision-only-a-person-can-make.test.ts re-run together
 *   (40 tests). Recorded: how many died, and the first to go.
 *
 *   MUTANT                                    DEAD  FIRST TO FAIL
 *   ───────────────────────────────────────── ────  ──────────────────────────
 *   pointerFrom: drop the `to !== id` guard    11   "THE PAIR THE SCREEN
 *   — the defect restored verbatim                  CALLED A CYCLE…"
 *
 *   describeGroup left on str(d._migratedTo),   6   "…no longer printed as
 *   classifyGroup fixed                             superseded to itself"
 *
 *   classifyGroup left on str(...),             5   "THE PAIR THE SCREEN
 *   describeGroup fixed                             CALLED A CYCLE…"
 *
 *   pointerFrom: return null unconditionally   16   "THE PAIR THE SCREEN
 *   — every row live, every finding lost            CALLED A CYCLE…"
 *
 *   classifyGroup: pointerFrom(rows[0].id, …)   9   "THE PAIR THE SCREEN
 *   instead of the row's own id                     CALLED A CYCLE…"
 *
 *   classifyGroup: delete the live.length===0   3   "A GENUINE CYCLE IS STILL
 *   cycle arm                                       A CYCLE"
 *
 *   THE CONTROL IS THE FIRST ROW, AND IT SAYS WHY THIS LIVED SO LONG. With the
 *   fix reverted, all 11 deaths are in THIS file and not one is in
 *   a-decision-only-a-person-can-make, which tests the same two functions
 *   across seventeen cases. That suite never wrote a self-pointer, so the
 *   branch was covered by nothing at all — the defect was not a regression
 *   past a test, it was a case no test had named.
 *
 *   Also under that mutant: the invariant fails on four of its five groups —
 *   every one holding a self-pointer — and passes on "settled pair with a bare
 *   live row", which is the shape the old rule already got right. Both positive
 *   controls still pass with the fix reverted, so they measure resolveActiveUser
 *   rather than this file.
 */
