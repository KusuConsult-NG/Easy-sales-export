/**
 * @jest-environment node
 */

/**
 *   #759 NINE PEOPLE PAID FOR THE ACADEMY AND THE PLATFORM RECORDED NONE OF
 *        THEM AS ACADEMY MEMBERS.
 *
 *   Reported by the owner, of the Registrations by Module tile: "for academy the
 *   9 was payments that came from users who paid 50k, 100k and 25k." The tile
 *   read 0.
 *
 *   #756 had already fixed four defects in that tile's queries and left Academy
 *   explicitly unresolved, because its query is correct on both clauses — it
 *   accepts the statuses academy writes and it tests `academy_participant`. The
 *   owner's detail is what closed it: the nine are COURSE purchases.
 *
 *   MEASURED. `verifyEnrollmentPaymentAction` — the whole course-purchase path —
 *   touches the USERS collection ZERO times:
 *
 *       writes to COLLECTIONS.USERS:   (none)
 *       serviceRegistrations mentions: 0
 *       academy_participant mentions:  0
 *
 *   It writes a progress row, an enrolment row and an admin mirror, and the
 *   learner's own document goes on saying they have no connection to the
 *   academy at all.
 *
 *   The registration-FEE path next door DOES write it —
 *   `serviceRegistrations.academy.status`, the plan, the role. So the platform
 *   records an academy member when they pay to register and not when they pay
 *   for a course, and a course is the more expensive of the two.
 *
 * ── WHAT IT COSTS BEYOND THE TILE ───────────────────────────────────────────
 *
 *   Access itself is fine, and that is why nobody noticed: #378 made the
 *   progress row carry `purchased: true` and `checkCourseAccess` honours it, so
 *   the learner can open what they bought. The ROLE is what everything else
 *   keys on —
 *
 *     module broadcasts          target by role, so these learners are
 *                                unreachable by academy announcements
 *     the admin member list      shows no academy registration against them
 *     #752's messaging scope     a member holding no module role can reach only
 *                                the unscoped admins — so a paying learner
 *                                cannot message the academy admin they just paid
 *
 * ── AND THE NINE ALREADY AFFECTED ───────────────────────────────────────────
 *
 *   The fix stops it happening again; it does nothing for the people it already
 *   happened to. So this also adds a forensic CHECK — paid, not recorded — and
 *   a REPAIR, on #757's framework, driven from ACADEMY_ENROLLMENTS and running
 *   the SAME function the purchase path now calls, so the repair and the write
 *   cannot drift apart.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { repairFor, isRepairKind } from '@/lib/forensic-repairs';

const ROOT = process.cwd();
const code = (rel: string) => stripComments(readFileSync(join(ROOT, rel), 'utf-8'), { label: rel });

const FULFIL = 'src/lib/academy-course-fulfilment.ts';
const PAYMENT = 'src/app/actions/academy/_payment.ts';
const FORENSICS = 'src/app/actions/forensics.ts';

const LEARNER = 'learner-1';

/** The user document the recorder reads, and the patch it wrote. */
let doc: Record<string, any> | null;
let patch: Record<string, any> | null;

jest.mock('@/lib/supabase-db', () => ({
    supabaseDb: {
        collection: () => ({
            doc: () => ({
                get: async () => ({ exists: doc !== null, data: () => doc }),
                update: async (p: Record<string, any>) => { patch = p; },
            }),
        }),
        doc: () => ({}),
        runTransaction: async () => undefined,
    },
}));
jest.mock('@/lib/firestore-compat', () => ({
    FieldValue: {
        serverTimestamp: () => '__ts__',
        arrayUnion: (...v: unknown[]) => ({ __arrayUnion: v }),
        increment: (n: number) => ({ __inc: n }),
    },
}));
jest.mock('@/lib/academy-course-progress', () => ({
    ensureCourseAccessRecords: async () => ({ failed: false }),
}));
//   Both exports, because audit-log-mock-is-complete pins that a local override
//   covers what its own suite's code path can reach — a partial mock is how a
//   test passes for a reason it did not intend.
jest.mock('@/lib/audit-log', () => ({
    createAdminAuditLog: async () => ({}),
    recordAdminAction: async () => ({}),
}));

const record = async () => {
    const m = await import('@/lib/academy-course-fulfilment');
    return m.recordAcademyParticipation(LEARNER);
};

beforeEach(() => {
    jest.clearAllMocks();
    doc = { roles: ['general_user'], serviceRegistrations: {} };
    patch = null;
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#759 — a learner who paid is recorded as being in the academy', () => {
    it('THEY GET THE academy_participant ROLE', async () => {
        /*
         *   THE finding. Without this the learner holds no module role, so the
         *   tile counts them as nobody and #752's scope will not let them
         *   message the admin of the module they just paid for.
         */
        await record();

        expect(patch?.roles).toEqual({ __arrayUnion: ['academy_participant'] });
    });

    it('AND THEIR REGISTRATION SAYS active', async () => {
        await record();

        expect(patch?.['serviceRegistrations.academy.status']).toBe('active');
    });

    it('AND THE PURCHASE IS RECORDED AS A PURCHASE', async () => {
        //   So a later reader can tell "bought a course" from "paid the
        //   registration fee" — they are different facts about the money.
        await record();

        expect(patch?.['serviceRegistrations.academy.hasPurchasedCourses']).toBe(true);
        expect(patch?.['serviceRegistrations.academy.firstCoursePurchaseAt']).toBe('__ts__');
    });

    it('AND IT NEVER CLAIMS A PLAN OR A REGISTRATION FEE', async () => {
        /*
         *   The half that keeps this honest. A course purchase is not a plan,
         *   and stamping `paymentStatus: "completed"` would assert a fee that
         *   was never paid — inventing exactly the kind of fact this audit
         *   keeps removing.
         */
        await record();

        expect(Object.keys(patch ?? {})).not.toContain('serviceRegistrations.academy.plan');
        expect(Object.keys(patch ?? {})).not.toContain('serviceRegistrations.academy.paymentStatus');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#759 — and it never overrides somebody\'s decision', () => {
    it('A REJECTED APPLICATION IS NOT QUIETLY REOPENED BY BUYING A COURSE', async () => {
        /*
         *   The sibling path in _payment.ts spells out why this matters: when an
         *   application has been decided against it omits the status key
         *   entirely, because writing one "would clear the rejection from the
         *   user document while leaving it on the application".
         *
         *   Buying a course is not a review. The same reasoning, on the path
         *   that did not have it.
         */
        doc = { roles: [], serviceRegistrations: { academy: { status: 'rejected' } } };

        await record();

        expect(Object.keys(patch ?? {})).not.toContain('serviceRegistrations.academy.status');
    });

    it('AND NOR IS AN APPROVED ONE DOWNGRADED TO active', async () => {
        doc = { roles: ['academy_participant'], serviceRegistrations: { academy: { status: 'approved' } } };

        await record();

        expect(Object.keys(patch ?? {})).not.toContain('serviceRegistrations.academy.status');
    });

    it('and a learner already fully recorded is not written to at all', async () => {
        /*
         *   Idempotence, which a webhook retry depends on. An unconditional
         *   write would touch `updatedAt` on every delivery — and #735
         *   established what a stray `updatedAt` costs: it moves the
         *   recently-active figure.
         */
        doc = {
            roles: ['academy_participant'],
            serviceRegistrations: { academy: { status: 'approved', hasPurchasedCourses: true } },
        };

        await record();

        expect(patch).toBeNull();
    });

    it('and a user who no longer exists is skipped rather than created', async () => {
        doc = null;

        await expect(record()).resolves.toBeUndefined();
        expect(patch).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#759 — and the purchase path actually calls it', () => {
    it('THE SHARED FULFILLER RECORDS PARTICIPATION', () => {
        /*
         *   Placed in `fulfilAcademyCoursePurchase` rather than at the call
         *   sites, because BOTH the webhook and the action route through it —
         *   the file's own header says so. Fixing one caller would have left
         *   the other writing nothing, which is this audit's most repeated
         *   shape.
         */
        expect(code(FULFIL)).toContain('await recordAcademyParticipation(userId);');
    });

    it('AND BOTH PAYMENT ROUTES GO THROUGH THAT FULFILLER', () => {
        const callers = [
            'src/infrastructure/payments/service.ts',
            'src/app/actions/academy/_ac_course_payment.ts',
        ];

        for (const f of callers) {
            expect({ f, uses: code(f).includes('fulfilAcademyCoursePurchase') })
                .toEqual({ f, uses: true });
        }
    });

    it('and the registration-FEE path still writes what it always did', () => {
        //   Untouched. It records a plan and a fee because one was paid, which
        //   is precisely what the course path must not claim.
        const src = code(PAYMENT);

        expect(src).toContain('"serviceRegistrations.academy.plan": resolvedPlan');
        expect(src).toContain('"serviceRegistrations.academy.paymentStatus": "completed"');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#759 — and the ones it already happened to can be repaired', () => {
    it('THE SCAN LOOKS FOR PAID LEARNERS WHO ARE NOT RECORDED', () => {
        const src = code(FORENSICS);

        expect(src).toContain('"Academy Participation (Paid, Not Recorded)"');

        /*
         *   Driven from who PAID, not from who is already recorded — the
         *   opposite direction would find nobody by construction.
         *
         *   Scoped to the SCAN's own block. A first draft asserted
         *   `toContain('COLLECTIONS.ACADEMY_ENROLLMENTS')` over the whole file
         *   and the mutant that repointed the scan at COLLECTIONS.USERS
         *   SURVIVED — because the REPAIR mentions the same collection a few
         *   hundred lines away. Two things in one file reading the same table,
         *   and the assertion could not say which it had found.
         */
        const scan = src.slice(src.indexOf('const paidSnap'));
        expect(scan.slice(0, 200)).toContain('COLLECTIONS.ACADEMY_ENROLLMENTS');
    });

    it('AND THE FINDING OFFERS A REPAIR', () => {
        const offer = repairFor('Academy Participation (Paid, Not Recorded)');

        expect(offer.safe).toBe(true);
        expect(isRepairKind(offer.kind)).toBe(true);
    });

    it('AND THE REPAIR RUNS THE SAME FUNCTION THE PURCHASE PATH DOES', () => {
        /*
         *   The point of importing it rather than restating it. A repair with
         *   its own copy of "what a recorded academy member looks like" is two
         *   definitions of one fact, which is the class this audit has spent
         *   more findings on than any other.
         */
        const src = code(FORENSICS);

        expect(src).toContain('recordAcademyParticipation');
        expect(src).toContain('academy_participation_drift');
    });

    it('and the repair is counted by learner, not by enrolment', () => {
        //   One learner with three courses is one repair. A per-enrolment count
        //   would report three and write once.
        const src = code(FORENSICS);
        const body = src.slice(src.indexOf('academy_participation_drift'));

        expect(body).toContain('const userIds = new Set<string>()');
        expect(body).toContain('repaired: userIds.size');
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored from a snapshot copy
 *   keyed by FULL PATH, each mutant proving its edit landed by a unique string
 *   on disk.
 *
 *     MUTANT                                                        RESULT
 *     the role grant is dropped                                      KILLED
 *     the status is written unconditionally, over a rejection        KILLED
 *     the purchase claims a completed registration fee               KILLED
 *     the recorder is not called from the fulfiller                  KILLED
 *     the recorder writes even when nothing changed                  KILLED
 *     the repair counts enrolments instead of learners               KILLED
 *     the scan drives from users instead of from payments            KILLED †
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                             SURVIVED
 *
 *   † SURVIVED ON THE FIRST PASS. The assertion matched
 *     `COLLECTIONS.ACADEMY_ENROLLMENTS` over the whole file, and the REPAIR
 *     mentions the same table a few hundred lines from the SCAN — so
 *     repointing the scan at COLLECTIONS.USERS changed nothing the test could
 *     see. Two readers of one table in one file, and the matcher could not say
 *     which it had found. Scoped to the scan's own block; killed.
 */
