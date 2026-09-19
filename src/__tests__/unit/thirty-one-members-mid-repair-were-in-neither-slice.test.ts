/**
 * @jest-environment node
 */

/**
 *   #847 THIRTY-ONE COOPERATIVE MEMBERS SENT BACK TO REPAIR THEIR OWN RECORD
 *   WERE IN NEITHER SLICE OF THE DASHBOARD.
 *
 *   #846 AND THE TWO COOPERATIVE LISTS THAT WERE EXHAUSTIVE BY COINCIDENCE.
 *
 *   Measured in production, every `serviceRegistrations.cooperative(s).status`:
 *
 *       not_started                 33,576
 *       pending                      1,639
 *       active                       1,255
 *       approved                       169
 *       pending_repair                  31   <-- in no list at all
 *       legacy_pending_onboarding        8
 *       (none)                          27
 *                                   ------
 *                                   36,705
 *
 *   36,678 of those carry a status; 3,102 of them are not `not_started`. That
 *   3,102 is what the applicant register reports after #841. The dashboard pie,
 *   filtering on ACTIVE_REGISTRATION_STATUSES, reported 3,071 — because
 *   `pending_repair` was in no list, so it was excluded there and kept by
 *   module-applicant-count's `total`, which excludes only `not_started`.
 *
 *   A difference of exactly 31, about exactly those 31 people. That is the
 *   disagreement A3.1 of docs/module-audit-checklist.md was written to look for,
 *   and it is the first one this audit has caught while the two surfaces were
 *   still on screen together.
 *
 * ── WHERE IT COMES FROM, AND WHY IT IS A LIVE APPLICATION ───────────────────
 *
 *   cooperatives/(member)/layout.tsx flags a membership record whose stored name
 *   is the literal string "undefined" and writes `pending_repair` to BOTH
 *   spellings, with a comment that is emphatic about what it is NOT doing:
 *
 *       // 1. DO NOT DELETE THE DOCUMENT (preserves user details like BVN, NOK,
 *       //    address, valid ID documents)
 *
 *   The record is intact and the member is asked to correct her name.
 *   _coop_registration.ts:722 then lets her re-submit from it:
 *
 *       const allowedStatuses = ['pending', 'revision_required', 'pending_repair'];
 *
 *   So the application exists, the platform is holding her documents, and the
 *   code already files the status beside `revision_required` — in that one line.
 *
 * ── AND THE KNOWLEDGE WAS ALREADY WRITTEN DOWN, IN THE WRONG FILE ───────────
 *
 *       lib/registration-progress.ts:51
 *       const PROVISIONAL_STATUSES = ['pending_repair', 'legacy_pending_onboarding'];
 *
 *   The same pair, in that order. #840 had already had to move the second one
 *   into the canonical list, for this reason, four findings ago — and left its
 *   neighbour behind. A rule known correctly in one file and unavailable in the
 *   file that exists to hold it is #756's finding, #840's finding and #841's
 *   finding; this is its fourth appearance, so both halves of that pair are
 *   pinned here by name.
 *
 * ── A NOTE ON HOW THIS WAS FOUND, BECAUSE THE INSTRUMENT WAS ALSO WRONG ─────
 *
 *   The breakdown script that produced the numbers above read membership rows
 *   from `document_collections WHERE collection_name = 'cooperative_members'`.
 *   That collection is in DEDICATED_TABLE_MAP and has a table of its own, so the
 *   query returned 0 BY CONSTRUCTION and its LEFT JOIN filed all 36,678
 *   registered accounts under "no membership row". Corrected in
 *   scripts/cooperative-population-breakdown.sql. The status rows — sections 1
 *   and 3, reading only `users` — were unaffected, and are what this suite pins.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

/*
 *   THIS SUITE TESTS THE PER-BUCKET FALLBACK, AND NOW SAYS SO.
 *
 *   It predates #850, which put `module_registration_counts` in front of the
 *   per-bucket counts. It kept passing because the rollup call failed in the
 *   test environment and EVERY failure fell through to the fallback — so the
 *   path under test was reached by accident rather than by choice.
 *
 *   That blanket fall-through is the defect fixed in
 *   the-fallback-was-the-thing-that-timed-out: a rollup that TIMED OUT sent
 *   five to fifteen more sequential scans at the table that was already too
 *   slow. The fallback now fires only for PGRST202 / 42883 — the function not
 *   being there — which is the condition #850 wrote it for and the one this
 *   suite means.
 *
 *   Declared rather than inferred. Nothing else here changes.
 */
jest.mock('@/lib/supabase', () => ({
    supabaseAdmin: {
        rpc: async () => ({
            data: null,
            error: { code: 'PGRST202', message: 'Could not find the function in the schema cache' },
        }),
    },
}));


const code = (rel: string) =>
    stripComments(readFileSync(join(process.cwd(), rel), 'utf-8'), { label: rel });

beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#847 — a member mid-repair is an applicant', () => {
    it('pending_repair IS IN THE CANONICAL ACTIVE LIST', async () => {
        const { ACTIVE_REGISTRATION_STATUSES } = await import('@/lib/module-registration-status');
        expect([...ACTIVE_REGISTRATION_STATUSES]).toContain('pending_repair');
    });

    it('AND SO IS ITS NEIGHBOUR, so registration-progress and this file agree', async () => {
        /*
         *   The pair that PROVISIONAL_STATUSES holds. Asserted together because
         *   the defect was not "one value was missing" — it was that the two
         *   were known as a pair somewhere else and imported one at a time.
         */
        const { ACTIVE_REGISTRATION_STATUSES } = await import('@/lib/module-registration-status');
        const canonical = [...ACTIVE_REGISTRATION_STATUSES] as string[];

        const provisional = code('src/lib/registration-progress.ts')
            .match(/PROVISIONAL_STATUSES\s*=\s*\[([^\]]*)\]/)?.[1] ?? '';
        const named = [...provisional.matchAll(/'([^']+)'/g)].map((m) => m[1]);

        expect(named.length).toBeGreaterThan(0);
        expect(named.filter((s) => !canonical.includes(s))).toEqual([]);
    });

    it('THE REPORTED CASE: the register and the pie now agree about the same 31', async () => {
        /*
         *   Executed on the production status mix, scaled to itself. Before the
         *   fix, `total` kept the pending_repair rows (it excludes only
         *   not_started) and the named buckets did not, so the difference landed
         *   in `other` — 31 people the dashboard could not place. The invariant
         *   module-applicant-count publishes is
         *
         *       approved + pending + rejected + revisionRequired + other === total
         *
         *   and the point of the fix is that `other` goes to zero, not that the
         *   sum balances — it balanced before, with 31 people in a bucket that
         *   has no name on any screen.
         */
        const { countModuleApplicants } = await import('@/lib/module-applicant-count');

        const users: Record<string, Record<string, unknown>> = {};
        const add = (status: string, n: number) => {
            for (let i = 0; i < n; i += 1) {
                //   BOTH spellings on one account, which is how the importer
                //   writes it and why the count is inclusion-exclusion.
                users[`${status}-${i}`] = {
                    serviceRegistrations: {
                        cooperative: { status },
                        cooperatives: { status },
                    },
                };
            }
        };

        add('not_started', 33);
        add('pending', 16);
        add('active', 12);
        add('approved', 2);
        add('pending_repair', 31);
        add('legacy_pending_onboarding', 8);

        installFakeDb({ [COLLECTIONS.USERS]: users });

        const c = await countModuleApplicants('cooperative');

        expect({
            total: c.total,
            revisionRequired: c.revisionRequired,
            other: c.other,
        }).toEqual({
            //   16 + 12 + 2 + 31 + 8. The 33 not_started are #841's exclusion.
            total: 69,
            revisionRequired: 31,
            //   The whole finding: nobody is unplaceable any more.
            other: 0,
        });
    });

    it('AND IT IS FILED AS WAITING ON THE APPLICANT, not on a reviewer', async () => {
        /*
         *   Not folded into `pending`. The admin review queue is what "pending"
         *   means on these screens, and nobody at the programme can action a
         *   record only the member can correct — counting it there inflates the
         *   backlog with work that does not exist, which is the defect
         *   REVISION_STATUSES was separated out to avoid.
         */
        const { REVISION_STATUSES, PENDING_STATUSES, APPROVED_STATUSES } =
            await import('@/lib/module-applicant-count');

        expect([...REVISION_STATUSES]).toContain('pending_repair');
        expect([...PENDING_STATUSES]).not.toContain('pending_repair');
        expect([...APPROVED_STATUSES]).not.toContain('pending_repair');
    });

    it('AND A REPAIRING MEMBER IS NOT COUNTED AS APPROVED, which would be worse', async () => {
        /*
         *   The half that must not regress. Her record is the one the platform
         *   flagged as corrupt; reporting her as an approved member would put a
         *   broken record behind a settled figure.
         */
        const { countModuleApplicants } = await import('@/lib/module-applicant-count');

        installFakeDb({
            [COLLECTIONS.USERS]: {
                repairing: {
                    serviceRegistrations: {
                        cooperative: { status: 'pending_repair' },
                        cooperatives: { status: 'pending_repair' },
                    },
                },
            },
        });

        const c = await countModuleApplicants('cooperative');
        expect({ approved: c.approved, revisionRequired: c.revisionRequired })
            .toEqual({ approved: 0, revisionRequired: 1 });
    });

    it('AND THE WRITER IS STILL THERE, so this is not a status nobody produces', () => {
        /*
         *   #756 admitted three values to the ACTIVE list that no writer
         *   produces, and noted that the length of the list was what made it look
         *   thorough. This one is admitted because a live path writes it, so the
         *   path is named and checked rather than trusted.
         */
        const layout = code('src/app/cooperatives/(member)/layout.tsx');

        expect(layout).toContain('status: "pending_repair"');
        //   Both spellings, or half the accounts keep the old status.
        const at = layout.indexOf('status: "pending_repair"');
        expect(layout.slice(at, at + 260)).toMatch(/cooperatives:\s*\{\s*status:\s*"pending_repair"/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#846 — the two cooperative slices partition the active list by construction', () => {
    /**
     *   analytics.service draws cooperatives as TWO slices, "Cooperatives" and
     *   "Co-op Onboarding", and spelled the statuses of each out inline. Their
     *   union happened to cover what the cooperative flow writes; it did not
     *   cover `under_review`, which is in the canonical list.
     *
     *   Nothing was lost by that, because nothing writes `under_review` for
     *   cooperative — _coop_admin_members.ts:703 says so in as many words. The
     *   defect is the coincidence, not a missing member, and it is stated that
     *   way rather than inflated: #844's suite records the last time this audit
     *   called a harmless omission "a separate, worse bug" and had to withdraw it
     *   when the data showed zero accounts.
     *
     *   #847, four commits after #840, is the event those lists were exhaustive
     *   against: a status added to the canonical list while two hand-written
     *   lists sat beside it. Derived by subtraction, `pending_repair` reached the
     *   Co-op Onboarding slice with nobody editing that query.
     */
    it('THEIR UNION IS THE ACTIVE LIST — every status, not merely today\'s', async () => {
        const {
            ACTIVE_REGISTRATION_STATUSES,
            SETTLED_REGISTRATION_STATUSES,
            IN_REVIEW_REGISTRATION_STATUSES,
        } = await import('@/lib/module-registration-status');

        expect([...SETTLED_REGISTRATION_STATUSES, ...IN_REVIEW_REGISTRATION_STATUSES].sort())
            .toEqual([...ACTIVE_REGISTRATION_STATUSES].sort());
    });

    it('AND THEY ARE DISJOINT, so no member is drawn in both slices', async () => {
        const { SETTLED_REGISTRATION_STATUSES, IN_REVIEW_REGISTRATION_STATUSES } =
            await import('@/lib/module-registration-status');

        const both = SETTLED_REGISTRATION_STATUSES.filter(
            (s) => (IN_REVIEW_REGISTRATION_STATUSES as readonly string[]).includes(s),
        );
        expect(both).toEqual([]);
    });

    it('AND A NEW STATUS LANDS IN THE VISIBLE HALF — proved on pending_repair', async () => {
        /*
         *   The property that makes the derivation worth the change. #824's
         *   lesson is that an enumerated list cannot catch a value nobody has
         *   invented yet, so the default must be the half that is still drawn.
         */
        const { IN_REVIEW_REGISTRATION_STATUSES, SETTLED_REGISTRATION_STATUSES } =
            await import('@/lib/module-registration-status');

        expect([...IN_REVIEW_REGISTRATION_STATUSES]).toContain('pending_repair');
        expect([...SETTLED_REGISTRATION_STATUSES]).not.toContain('pending_repair');
    });

    it('AND THE QUERIES USE THE DERIVED FILTERS, not their own lists', () => {
        /*
         *   The mechanism. Asserted on the file because the defect was never
         *   that the values were wrong — they were right — but that they were
         *   written out a second time in a place that would not be revisited.
         */
        const src = code('src/services/analytics.service.ts');

        expect(src).toContain('settledStatusFilter()');
        expect(src).toContain('inReviewStatusFilter()');

        //   The two inline lists that were there. Their reappearance in any
        //   query is the regression this case exists to catch.
        expect(src).not.toContain('approved,active,paid,completed,suspended');
        expect(src).not.toContain('pending,pending_approval,revision_required,legacy_pending_onboarding');
    });

    it('AND BOTH SLICES ARE STILL DRAWN, which is the point of splitting at all', () => {
        //   A derivation that collapsed the two into one would satisfy every
        //   case above and remove the distinction the owner reads.
        const src = code('src/services/analytics.service.ts');

        expect(src).toContain('"Co-op Onboarding"');
        expect(src).toContain('cooperativeOnboarding');
    });
});
