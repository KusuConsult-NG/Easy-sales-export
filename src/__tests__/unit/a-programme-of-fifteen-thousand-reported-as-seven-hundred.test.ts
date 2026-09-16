/**
 * @jest-environment node
 */

/**
 *   #835 THE COMPLIANCE SCREEN UNDER-REPORTED WAVE BY 95%.
 *
 *   The owner, reading /admin/wave/compliance, quoting the cards back:
 *
 *       716   Total Applications
 *       475   Approved (66%)
 *       241   Pending Review
 *
 *   "the number are more than this and the application is far more than 15k".
 *
 *   716 was a TRUE COUNT of rows in WAVE_APPLICATIONS. It was not the number of
 *   people who had applied, because that collection holds the DETAILED FORM and
 *   only for the enrolment route that writes one. ~15,130 people have applied.
 *   So a page headed "WAVE Program Compliance" described under 5% of the
 *   programme, on the screen whose figures get quoted outward.
 *
 * ── AND THE FIRST FIX PUT A FALSE STATEMENT ON THAT SCREEN ──────────────────
 *
 *   Recorded because it is the more instructive half of this finding.
 *
 *   The first pass counted `wave_participant` role-holders, subtracted the
 *   approved applications, and printed the difference as
 *
 *       "14,655 without an approved application"
 *
 *   That sentence was never measured. It was lifted from a comment in
 *   _wv_admin_applications.ts — "the 14,654 without an application may well be
 *   real members" — and hardened into a claim about fourteen thousand real
 *   women.
 *
 *   The owner: "14k+ without application is a false statement … all the users
 *   had applications submitted."
 *
 *   Which is the same class as the invented ₦80,500,000 funding ledger #829
 *   removed — an inference presented as a measurement — committed while fixing
 *   an instance of it. A count that cannot see a record is evidence about THE
 *   QUERY, never about the person. That is what these cases pin.
 *
 * ── WHAT IS COUNTED NOW ─────────────────────────────────────────────────────
 *
 *   `serviceRegistrations.<module>.status` on the USER, which every enrolment
 *   path maintains — the module's own apply action writes it on submit, the
 *   admin actions move it, and _legacy.ts writes it on import. One definition
 *   for all six modules, in lib/module-applicant-count.
 *
 * ── MUTATION LOG ────────────────────────────────────────────────────────────
 *
 *     the applicant count reverted to the applications table    KILLED
 *     applicant counts falling back to 0 instead of null        KILLED
 *     the dual-spelling aliases reduced to one key              KILLED
 *     the pending vocabulary narrowed to "pending"              KILLED
 *     the date filter dropped from the applicant count          KILLED
 *     demographics reverted from .all() to .get()               KILLED
 *     the demographics basis note dropped                       KILLED
 *     reword this header                            SURVIVED, as intended
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

let store: FakeDbHandle;

function actAs(roles: string[] = ['super_admin']): void {
    (globalThis as {
        mockRequireSession: { mockImplementation: (f: () => unknown) => void };
    }).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id: 'admin-1', roles, email: 'admin-1@example.com' } },
        error: null,
    }));
}

/**
 * The production shape: a large applicant register, of which only a fraction
 * have a row in the detailed-form collection.
 */
function seedProgramme({ approved, pending, detailedForms }: {
    approved: number; pending: number; detailedForms: number;
}): void {
    const apps: Record<string, Record<string, unknown>> = {};
    const users: Record<string, Record<string, unknown>> = {};
    const total = approved + pending;

    for (let i = 1; i <= total; i += 1) {
        const status = i <= approved ? 'approved' : 'pending';
        users[`member-${i}`] = {
            email: `member${i}@example.test`,
            roles: ['user', 'wave_participant'],
            serviceRegistrations: { wave: { status } },
            createdAt: new Date('2026-01-01T00:00:00Z'),
        };
        //   Only the first `detailedForms` applicants have the long form.
        if (i <= detailedForms) {
            apps[`app-${i}`] = {
                userId: `member-${i}`,
                status,
                age: 30,
                stateOfResidence: 'Kano',
                currentOccupation: 'Farmer',
                createdAt: new Date('2026-01-01T00:00:00Z'),
            };
        }
    }

    store = installFakeDb({
        [COLLECTIONS.WAVE_APPLICATIONS]: apps,
        [COLLECTIONS.USERS]: users,
    });
}

async function callCompliance(timeframe = 'all') {
    const { GET } = await import('@/app/api/admin/wave/compliance/route');
    const { NextRequest } = await import('next/server');
    const res = await GET(new NextRequest(
        `http://localhost/api/admin/wave/compliance?timeframe=${timeframe}`,
    ));
    return { status: res.status, body: await res.json() };
}

beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    actAs();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#835 — the programme is counted, not the form table', () => {
    it('THE REPORTED CASE: 15,130 applicants, 716 of them with a long form', async () => {
        seedProgramme({ approved: 1489, pending: 24, detailedForms: 72 });

        const { status, body } = await callCompliance();

        expect(status).toBe(200);
        expect(body.stats.applicantsTotal).toBe(1513);
        expect(body.stats.applicantsPending).toBe(24);

        //   The old headline, kept but demoted and renamed for what it counts.
        expect(body.stats.detailedApplicationRecords).toBe(72);
    });

    it('AND THE HEADLINE IS NOT THE DETAIL-TABLE ROW COUNT', async () => {
        //   The defect itself, pinned: 716 must not be what "Total" reports.
        seedProgramme({ approved: 1489, pending: 24, detailedForms: 72 });

        const { body } = await callCompliance();

        expect(body.stats.applicantsTotal).not.toBe(body.stats.detailedApplicationRecords);
        expect(body.stats.applicantsTotal).toBeGreaterThan(72);
    });

    it('AND NOTHING CLAIMS ANY APPLICANT IS MISSING AN APPLICATION', async () => {
        /*
         *   The false statement, pinned so it cannot come back in any wording.
         *   The owner's correction was explicit: every one of these people
         *   applied. The response may describe RECORDS; it may not describe
         *   people as lacking one.
         */
        seedProgramme({ approved: 1489, pending: 24, detailedForms: 72 });

        const { body } = await callCompliance();
        const json = JSON.stringify(body).toLowerCase();

        expect(json).not.toContain('without an approved application');
        expect(json).not.toContain('without an application');
        expect(json).not.toContain('no application record');
        expect(body.stats.membersWithoutApprovedApplication).toBeUndefined();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#835 — one definition, shared by every module', () => {
    it('AN ACCOUNT CARRYING BOTH SPELLINGS IS COUNTED ONCE', async () => {
        /*
         *   _legacy.ts assigns ONE `coopState` object to BOTH `cooperative` and
         *   `cooperatives` on the SAME user. The first version of this helper
         *   summed the aliases, which would have reported every legacy-imported
         *   cooperative member TWICE — roughly double the truth, on exactly the
         *   class of screen this finding exists to correct.
         *
         *   Caught by writing the fixture the way the importer writes the data
         *   rather than the way the helper assumed it.
         */
        const { countModuleApplicants } = await import('@/lib/module-applicant-count');
        const both = { status: 'approved' };
        store = installFakeDb({
            [COLLECTIONS.USERS]: {
                //   Exactly what the importer produces.
                'imported': { serviceRegistrations: { cooperative: both, cooperatives: both } },
                //   And one written under a single spelling by the live flow.
                'live': { serviceRegistrations: { cooperatives: { status: 'active' } } },
            },
        });

        const counts = await countModuleApplicants('cooperative');

        expect(counts.total).toBe(2);
        expect(counts.approved).toBe(2);
    });

    it('THE BUCKETS ACCOUNT FOR EVERY APPLICANT, including unknown statuses', async () => {
        /*
         *   #824's lesson: an enumerated list cannot catch a value nobody has
         *   invented yet. So a status none of the lists anticipates must land in
         *   `other` and stay visible, rather than making the person vanish from
         *   the funnel.
         */
        const { countModuleApplicants } = await import('@/lib/module-applicant-count');
        store = installFakeDb({
            [COLLECTIONS.USERS]: {
                'a': { serviceRegistrations: { wave: { status: 'approved' } } },
                'b': { serviceRegistrations: { wave: { status: 'pending' } } },
                'c': { serviceRegistrations: { wave: { status: 'rejected' } } },
                'd': { serviceRegistrations: { wave: { status: 'revision_required' } } },
                //   A status this codebase does not currently write anywhere.
                'e': { serviceRegistrations: { wave: { status: 'escalated_to_committee' } } },
            },
        });

        const c = await countModuleApplicants('wave');

        expect(c.other).toBe(1);
        expect((c.approved! + c.pending! + c.rejected! + c.revisionRequired! + c.other!))
            .toBe(c.total);
    });

    it('AND REVISION_REQUIRED IS NOT COUNTED AS A REVIEW BACKLOG', async () => {
        //   It is waiting on the APPLICANT. Counting it as pending inflates the
        //   queue with work nobody at the programme can action.
        const { countModuleApplicants } = await import('@/lib/module-applicant-count');
        store = installFakeDb({
            [COLLECTIONS.USERS]: {
                'a': { serviceRegistrations: { export: { status: 'revision_required' } } },
                'b': { serviceRegistrations: { export: { status: 'pending_approval' } } },
            },
        });

        const c = await countModuleApplicants('export');

        expect(c.pending).toBe(1);
        expect(c.revisionRequired).toBe(1);
    });

    it('BOTH SPELLINGS OF A DUAL-WRITTEN KEY ARE COUNTED', async () => {
        /*
         *   _legacy.ts writes `cooperative` AND `cooperatives`, `farmNation` AND
         *   `farm_nation` — "so that broadcast-logic and the admin actions both
         *   resolve". Live data therefore holds both, and a count that reads one
         *   spelling silently omits whoever was written under the other.
         */
        const { countModuleApplicants } = await import('@/lib/module-applicant-count');
        store = installFakeDb({
            [COLLECTIONS.USERS]: {
                'a': { serviceRegistrations: { farmNation: { status: 'approved' } } },
                'b': { serviceRegistrations: { farm_nation: { status: 'approved' } } },
                'c': { serviceRegistrations: { farmNation: { status: 'pending' } } },
            },
        });

        const counts = await countModuleApplicants('farmNation');

        expect(counts.total).toBe(3);
        expect(counts.approved).toBe(2);
        expect(counts.pending).toBe(1);
    });

    it('AND THE PENDING VOCABULARY COMES FROM THE CANONICAL LIST', async () => {
        /*
         *   #837 THIS CASE ORIGINALLY PINNED A HAND-WRITTEN LIST OF MY OWN.
         *
         *   It asserted that `pending_review` and `legacy_pending_onboarding`
         *   counted as pending — two values invented here that
         *   ACTIVE_REGISTRATION_STATUSES does not contain and no writer in src/
         *   produces. Meanwhile `suspended` and `completed`, which ARE canonical,
         *   were in no bucket at all.
         *
         *   #756 created that canonical list precisely to stop two hand-kept
         *   vocabularies drifting, and this module was written without finding
         *   it. The buckets derive from it now, so this case checks the real
         *   vocabulary rather than the one I made up.
         */
        const { countModuleApplicants } = await import('@/lib/module-applicant-count');
        const { ACTIVE_REGISTRATION_STATUSES } = await import('@/lib/module-registration-status');

        //   One user per canonical status, so nothing can be missed by omission.
        const users: Record<string, Record<string, unknown>> = {};
        ACTIVE_REGISTRATION_STATUSES.forEach((status, i) => {
            users[`u${i}`] = { serviceRegistrations: { wave: { status } } };
        });
        store = installFakeDb({ [COLLECTIONS.USERS]: users });

        const c = await countModuleApplicants('wave');

        //   Every canonical status is counted somewhere, and nobody vanishes.
        expect(c.total).toBe(ACTIVE_REGISTRATION_STATUSES.length);
        expect(c.approved! + c.pending! + c.revisionRequired! + c.rejected! + c.other!)
            .toBe(c.total);
        //   And `other` is empty: the canonical list is fully partitioned.
        expect(c.other).toBe(0);
    });

});

// ─────────────────────────────────────────────────────────────────────────────
describe('#835 — the breakdowns declare what they are computed over', () => {
    it('THE BASIS NAMES BOTH THE NUMERATOR AND THE DENOMINATOR', async () => {
        /*
         *   Age, state and occupation live only on the long form, so the charts
         *   can only be drawn from the 716. Saying so is the fix; padding them
         *   with 14,000 rows of "Unknown" would not be.
         */
        seedProgramme({ approved: 1489, pending: 24, detailedForms: 72 });

        const { body } = await callCompliance();
        const basis = body.dataAvailability.demographicsBasis;

        expect(basis.rowsCounted).toBe(72);
        expect(basis.ofApplicants).toBe(1513);
        expect(basis.note).toContain('72');
        expect(basis.note).toContain('1,513');
    });

    it('AND SAYS NOTHING WHEN THE CHARTS COVER EVERYONE', async () => {
        //   A note that always appears is a note nobody reads.
        seedProgramme({ approved: 8, pending: 2, detailedForms: 10 });

        const { body } = await callCompliance();

        expect(body.dataAvailability.demographicsBasis.note).toBeNull();
    });

    it('AND THE DEMOGRAPHIC SWEEP IS UNBOUNDED, not capped at the default limit', async () => {
        /*
         *   `.get()` without a `.limit()` stops at DEFAULT_QUERY_LIMIT — 5,000.
         *   At 716 rows that is invisible; it would begin describing the first
         *   5,000 as the whole programme the day the 5,001st arrived. The
         *   sibling export route already used `.all()`.
         *
         *   Proved by COUNTING what the breakdown covered, not by reading the
         *   source for the string ".all()".
         */
        const over = 5200;
        seedProgramme({ approved: over, pending: 0, detailedForms: over });

        const { body } = await callCompliance();
        const counted = Object.values(body.demographics.states as Record<string, number>)
            .reduce((a, b) => a + b, 0);

        expect(counted).toBe(over);
        expect(body.dataAvailability.demographicsBasis.rowsCounted).toBe(over);
    }, 120000);
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#835 — a timeframe narrows both populations together', () => {
    it('THE APPLICANT COUNT HONOURS THE DATE FILTER', async () => {
        /*
         *   Without it, "This Month" shows every applicant the programme ever
         *   had beside one month of applications — a fresh inconsistency
         *   introduced by the fix for the old one.
         */
        store = installFakeDb({
            [COLLECTIONS.WAVE_APPLICATIONS]: {
                'app-old': {
                    userId: 'member-old', status: 'approved', age: 30,
                    stateOfResidence: 'Kano', currentOccupation: 'Farmer',
                    createdAt: new Date('2000-01-01T00:00:00Z'),
                },
                'app-new': {
                    userId: 'member-new', status: 'approved', age: 30,
                    stateOfResidence: 'Kano', currentOccupation: 'Farmer',
                    createdAt: new Date(),
                },
            },
            [COLLECTIONS.USERS]: {
                'member-old': {
                    serviceRegistrations: { wave: { status: 'approved' } },
                    createdAt: new Date('2000-01-01T00:00:00Z'),
                },
                'member-new': {
                    serviceRegistrations: { wave: { status: 'approved' } },
                    createdAt: new Date(),
                },
            },
        });

        const all = await callCompliance('all');
        expect(all.body.stats.applicantsTotal).toBe(2);

        jest.resetModules();
        const year = await callCompliance('year');
        expect(year.body.stats.applicantsTotal).toBe(1);
        expect(year.body.stats.detailedApplicationRecords).toBe(1);
    }, 60000);
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#835 — every module counts its applicants the same way', () => {
    it('EACH MODULE STATS SURFACE USES THE SHARED DEFINITION', async () => {
        /*
         *   The owner: "ensure that this is fix also in all the modules."
         *
         *   Six modules had six separately written totals, every one of them
         *   counting its `*_APPLICATIONS` collection. Enumerated here by the
         *   SURFACE rather than by the string, and each is required to import the
         *   shared counter — so a seventh module, or a rewrite of one of these,
         *   cannot quietly go back to counting the detail collection.
         *
         *   Cooperative is included and is the interesting one: it uses the
         *   shared counter only for the UNSCOPED view, because the registration
         *   object on a user says which module, not which cooperative.
         */
        const { readFileSync } = require('fs') as typeof import('fs');
        const { join } = require('path') as typeof import('path');
        const { stripComments } = require('@/lib/testing/strip-comments') as
            typeof import('@/lib/testing/strip-comments');

        const SURFACES = [
            'src/app/api/admin/wave/compliance/route.ts',
            'src/app/actions/academy/_ac_admin_applications.ts',
            'src/app/actions/admin/_exports.ts',
            'src/app/actions/farm-nation-admin/_fna_finance.ts',
            'src/app/actions/cooperative/_coop_admin_reports.ts',
        ];

        const missing = SURFACES.filter((rel) => {
            const src = stripComments(
                readFileSync(join(process.cwd(), rel), 'utf-8'), { label: rel },
            );
            return !src.includes('countModuleApplicants');
        });

        expect(missing).toEqual([]);
    });

    it('CONTROL: THE CHECK WOULD NOTICE A SURFACE THAT DID NOT', () => {
        //   Vacuity guard — the assertion above passes trivially if stripComments
        //   started returning empty, or the substring stopped matching.
        const { stripComments } = require('@/lib/testing/strip-comments') as
            typeof import('@/lib/testing/strip-comments');

        const withIt = stripComments('const n = await countModuleApplicants("wave");', { label: 'x' });
        const without = stripComments('const n = await db.collection(X).count().get();', { label: 'y' });

        expect(withIt.includes('countModuleApplicants')).toBe(true);
        expect(without.includes('countModuleApplicants')).toBe(false);
    });

    it('AND THE COUNTER ANSWERS FOR ALL SIX MODULE KEYS', async () => {
        //   A key missing from REGISTRATION_KEYS returns the empty shape, which
        //   would render as "—" forever on that module's card without ever
        //   failing anything. Executed, not read.
        const { countModuleApplicants } = await import('@/lib/module-applicant-count');
        store = installFakeDb({
            [COLLECTIONS.USERS]: {
                'u': {
                    serviceRegistrations: {
                        wave: { status: 'approved' },
                        academy: { status: 'approved' },
                        export: { status: 'approved' },
                        cooperative: { status: 'approved' },
                        farmNation: { status: 'approved' },
                        marketplace: { status: 'approved' },
                    },
                },
            },
        });

        for (const key of ['wave', 'academy', 'export', 'cooperative', 'farmNation', 'marketplace'] as const) {
            const c = await countModuleApplicants(key);
            expect({ key, total: c.total, counted: c.counted })
                .toEqual({ key, total: 1, counted: true });
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#837 — the compliance count and the dashboard pie agree on who exists', () => {
    it('AN ACCOUNT WITH THE ROLE BUT NO REGISTRATION OBJECT IS COUNTED', async () => {
        /*
         *   The owner asked for stats that will not confuse the QA team
         *   certifying this platform — and two admin screens were counting the
         *   same programme differently:
         *
         *     analytics.service (the pie)  status IN (active…) OR roles ∋ role
         *     this module (compliance)     status IS NOT NULL
         *
         *   So an account holding `wave_participant` with no
         *   `serviceRegistrations.wave` object showed on one screen and not the
         *   other. That population is the whole reason #835 exists: ~15,128
         *   accounts hold that role.
         */
        const { countModuleApplicants } = await import('@/lib/module-applicant-count');
        store = installFakeDb({
            [COLLECTIONS.USERS]: {
                'with-status': {
                    roles: ['wave_participant'],
                    serviceRegistrations: { wave: { status: 'approved' } },
                },
                //   The account that used to be invisible here.
                'role-only': { roles: ['wave_participant'] },
                //   And somebody in no module at all, who must not be counted.
                'unrelated': { roles: ['user'] },
            },
        });

        const c = await countModuleApplicants('wave');

        expect(c.total).toBe(2);
    });

    it('AND AN ACCOUNT IS NOT COUNTED TWICE BY BOTH ARMS', async () => {
        /*
         *   The union is built as two ANDed queries rather than an OR the
         *   adapter cannot express, so the role arm is filtered to `status ==
         *   null`. If that filter were dropped, every ordinary applicant would
         *   be counted once for her status and again for her role.
         */
        const { countModuleApplicants } = await import('@/lib/module-applicant-count');
        store = installFakeDb({
            [COLLECTIONS.USERS]: {
                'both': {
                    roles: ['wave_participant'],
                    serviceRegistrations: { wave: { status: 'approved' } },
                },
            },
        });

        const c = await countModuleApplicants('wave');

        expect(c.total).toBe(1);
        expect(c.approved).toBe(1);
    });

    it('AND A MULTI-ROLE MODULE COUNTS A PERSON ONCE', async () => {
        //   A marketplace user is routinely both buyer and seller. Counted once
        //   per role, she would be two people on an admin card.
        const { countModuleApplicants } = await import('@/lib/module-applicant-count');
        store = installFakeDb({
            [COLLECTIONS.USERS]: {
                'trader': { roles: ['buyer', 'seller'] },
            },
        });

        const c = await countModuleApplicants('marketplace');

        expect(c.total).toBeLessThanOrEqual(1);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
//   LAST IN THE FILE, DELIBERATELY. `jest.doMock` registers for every later
//   require, so a throwing supabase-db declared mid-file leaked into the suites
//   after it — four failures that had nothing to do with what they tested, and
//   exactly the kind of instrument fault this audit keeps finding in its own
//   tooling.
describe('#835 — a failed count is null, never zero', () => {
    it('BECAUSE ZERO APPLICANTS IS A PLAUSIBLE AND CATASTROPHIC READING', async () => {
        //   It says the programme is empty. This is the distinction
        //   lib/admin-stat-display exists for, applied at the source.
        jest.resetModules();
        jest.doMock('@/lib/supabase-db', () => ({
            supabaseDb: { collection: () => { throw new Error('db down'); } },
        }));

        try {
            const { countModuleApplicants } = await import('@/lib/module-applicant-count');
            const counts = await countModuleApplicants('wave');

            expect(counts.total).toBeNull();
            expect(counts.approved).toBeNull();
            expect(counts.pending).toBeNull();
            expect(counts.counted).toBe(false);
        } finally {
            jest.dontMock('@/lib/supabase-db');
            jest.resetModules();
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
