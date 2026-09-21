/**
 * @jest-environment node
 */

/**
 *   AN APPROVED ACADEMY PLACE NOBODY PAID FOR OPENED THE MODULE — AND THEN
 *   MADE ITSELF PERMANENT.
 *
 *   THE OWNER: "Academy is gated but it is granting permission to users even
 *   before they make the payment, why?" — and, once told what the fix would
 *   cost: "gate academy behind payment with a legacy carve-out."
 *
 *   Layer 2.7 read the application and granted on status alone:
 *
 *       const status = appDocData.status;
 *       if (status === "active" || status === "approved") { …grant… }
 *
 *   No payment check of any kind. The Cooperatives layer a few hundred lines
 *   above has demanded `paymentStatus === "completed"` since #497.
 *
 * ── WHY GATING LAYER 2.7 ALONE WOULD HAVE FIXED ALMOST NOTHING ──────────────
 *
 *   The grant does not merely return true. It WRITES:
 *
 *       roles: arrayUnion("academy_participant")
 *       serviceRegistrations.academy.status: "approved"
 *
 *   Those two fields are exactly what Layer 2 and Layer 2.5 grant on, and both
 *   run BEFORE 2.7. So one visit by an unpaid applicant converted them into a
 *   permanently enrolled participant who would never reach Layer 2.7 again —
 *   and a gate placed only there would never see them.
 *
 *   All three grant points ask the same question now. The three tests named
 *   LAYER 2, LAYER 2.5 and LAYER 2.7 below are that, one apiece.
 *
 * ── THE CARVE-OUT, AND WHY IT IS SAFE WITHOUT A PRODUCTION COUNT ────────────
 *
 *   #497 measured before it moved the cooperative gate — 77 active-and-unpaid,
 *   74 of them legacy — and its comment is the warning: a payment requirement
 *   without the carve-out "would lock the entire pre-platform membership out of
 *   their own savings to catch two people".
 *
 *   THERE IS NO EQUIVALENT COUNT HERE, and that is worth stating rather than
 *   implying. I have no production access. What stands in for it is that every
 *   door which can settle an Academy payment already writes a marker the rule
 *   reads — admin/_legacy.ts writes `paymentStatus: "completed"` AND
 *   `_isLegacy: true`; payments/service.ts writes the same plus a
 *   processed_payments row; academy/_ac_admin_review writes it on both
 *   documents. So the only records carrying none of them are the ones the
 *   defect minted. Each of those doors has a test below.
 *
 *   "paid" COUNTS AS WELL AS "completed", because _ac_admin_review's signature
 *   is `paymentStatus: "pending" | "completed" | "paid"` and it stores whichever
 *   the admin chose. A gate reading only "completed" would have locked out
 *   every learner an admin recorded as paid — the carve-out failing in the one
 *   place a human had already confirmed the money.
 *
 *   ENROLMENT COUNTS AS WELL AS REGISTRATION. payment-router is explicit that
 *   `academy_enrollment` is "the purchase of a single course" and "Not a
 *   spelling of academy_registration". Both are money paid to Academy, and this
 *   decides only whether the MODULE opens; which plan a course belongs to is
 *   checkCourseAccess's question.
 *
 *   MUTATION-TESTED, WITH CONTROLS — table at the foot of this file.
 *
 *   NOT COVERED, and named rather than implied: the catch around the
 *   processed_payments lookup — "a failed read is not a refusal" — has no test,
 *   for the same reason #497 records for its own: the fake database offers no
 *   way to make that one query throw. A mutant flipping `settled = true` to
 *   `false` in that catch would SURVIVE this suite.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';
import type { UserRole } from '@/lib/types/roles';

let store: FakeDbHandle;

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
});

async function access(userId: string, roles: string[] = []): Promise<boolean> {
    const { checkModuleAccess } = await import('@/lib/module-access-check');
    return checkModuleAccess(userId, roles as UserRole[], 'academy' as never);
}

const UID = 'learner-1';
const APPS = COLLECTIONS.ACADEMY_APPLICATIONS;
const PAYMENTS = COLLECTIONS.PROCESSED_PAYMENTS;

/** A user document carrying nothing that grants access on its own. */
function bareUser(extra: Record<string, unknown> = {}): void {
    store.seed(COLLECTIONS.USERS, UID, { email: 'ada@example.com', ...extra });
}

/** The registration the defect's own heal writes: approved, and paid by nobody. */
function healedRegistration(extra: Record<string, unknown> = {}): void {
    bareUser({
        roles: ['academy_participant'],
        serviceRegistrations: { academy: { status: 'approved', ...extra } },
    });
}

// ─────────────────────────────────────────────────────────────────────────────
describe('an approved place with no payment behind it does not open Academy', () => {
    it('LAYER 2.7 — THE APPLICATION IS APPROVED AND UNPAID, AND IS REFUSED', async () => {
        //   THE test for the reported defect, at its original site.
        bareUser();
        store.seed(APPS, 'app-1', {
            userId: UID,
            status: 'approved',
            paymentStatus: 'pending',
        });

        expect(await access(UID)).toBe(false);
    });

    it('AND NO APPLICATION PAYMENT FIELD AT ALL IS STILL REFUSED', async () => {
        //   Absent is not paid. The heal wrote no payment field whatsoever.
        bareUser();
        store.seed(APPS, 'app-1', { userId: UID, status: 'active' });

        expect(await access(UID)).toBe(false);
    });

    it('LAYER 2 — AND THE REGISTRATION THE DEFECT ALREADY WROTE IS REFUSED TOO', async () => {
        //   The half that makes the fix worth anything. Layer 2.7 PERSISTS its
        //   grant as `serviceRegistrations.academy.status: "approved"`, which
        //   Layer 2 grants on — so everybody the defect enrolled would have
        //   kept the module for ever behind a gate placed only at 2.7.
        healedRegistration();

        expect(await access(UID)).toBe(false);
    });

    it('LAYER 2.5 — AND SO IS THE ROLE IT GRANTED', async () => {
        //   The other field the heal writes. A role alone must not re-open it.
        bareUser({ roles: ['academy_participant'] });

        expect(await access(UID, ['academy_participant'])).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('and every door that really settles a payment still opens it', () => {
    it('POSITIVE CONTROL: THE WEBHOOK — paymentStatus completed on the registration', async () => {
        //   payments/service.ts processAcademyRegistration. Without this the
        //   gate refuses every paying learner, which is the defect inverted.
        healedRegistration({ paymentStatus: 'completed' });

        expect(await access(UID)).toBe(true);
    });

    it('POSITIVE CONTROL: THE WEBHOOK — paymentStatus completed on the application', async () => {
        bareUser();
        store.seed(APPS, 'app-1', {
            userId: UID,
            status: 'approved',
            paymentStatus: 'completed',
        });

        expect(await access(UID)).toBe(true);
    });

    it('POSITIVE CONTROL: THE ADMIN — "paid" counts, not only "completed"', async () => {
        //   _ac_admin_review's signature is "pending" | "completed" | "paid"
        //   and it stores whichever was chosen. Reading only "completed" would
        //   lock out every learner a human had already confirmed.
        healedRegistration({ paymentStatus: 'paid' });

        expect(await access(UID)).toBe(true);
    });

    it('POSITIVE CONTROL: THE LEGACY IMPORT — the carve-out the owner asked for', async () => {
        //   admin/_legacy.ts writes BOTH of these. Either alone is enough, so
        //   an import that set one and not the other still admits.
        healedRegistration({ paymentStatus: 'completed', _isLegacy: true });
        expect(await access(UID)).toBe(true);

        store = installFakeDb();
        bareUser({
            legacyOnboardedBy: 'admin-7',
            roles: ['academy_participant'],
            serviceRegistrations: { academy: { status: 'approved' } },
        });
        expect(await access(UID)).toBe(true);
    });

    it('POSITIVE CONTROL: A LEGACY APPLICATION WITH NO PAYMENT FIELD', async () => {
        //   The _isLegacy marker on the application document itself.
        bareUser();
        store.seed(APPS, 'app-1', { userId: UID, status: 'approved', _isLegacy: true });

        expect(await access(UID)).toBe(true);
    });

    it('POSITIVE CONTROL: THE AUTHORITATIVE FALLBACK — a real registration payment', async () => {
        //   A stale paymentStatus beside a real payment must not cost somebody
        //   their course. This is the backstop, and it runs only after every
        //   free check has failed.
        healedRegistration({ paymentStatus: 'pending' });
        store.seed(PAYMENTS, 'ref-1', {
            userId: UID,
            type: 'academy_registration',
            status: 'completed',
        });

        expect(await access(UID)).toBe(true);
    });

    it('POSITIVE CONTROL: AND A COURSE PURCHASE IS MONEY PAID TO ACADEMY TOO', async () => {
        //   payment-router: `academy_enrollment` is "the purchase of a single
        //   course". Refusing the module to somebody who has bought a course
        //   inside it would be a worse defect than the one being closed.
        healedRegistration();
        store.seed(PAYMENTS, 'ref-1', {
            userId: UID,
            type: 'academy_enrollment',
            status: 'completed',
        });

        expect(await access(UID)).toBe(true);
    });

    it('and a payment that never completed is not a payment', async () => {
        healedRegistration();
        store.seed(PAYMENTS, 'ref-1', {
            userId: UID,
            type: 'academy_registration',
            status: 'pending',
        });

        expect(await access(UID)).toBe(false);
    });

    it('and a payment belonging to somebody else is not theirs', async () => {
        healedRegistration();
        store.seed(PAYMENTS, 'ref-1', {
            userId: 'someone-else',
            type: 'academy_registration',
            status: 'completed',
        });

        expect(await access(UID)).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('and the modules beside it are untouched', () => {
    it('POSITIVE CONTROL: AN UNPAID *COOPERATIVE* IS STILL JUDGED BY ITS OWN RULE', async () => {
        //   Vacuity guard of a different kind: a gate written into the shared
        //   layers rather than the academy branch would change cooperatives,
        //   export, wave and farm nation at the same time. #497's measurement
        //   is what licences the cooperative rule, not mine.
        const { checkModuleAccess } = await import('@/lib/module-access-check');

        bareUser({
            roles: ['wave_participant'],
            serviceRegistrations: { wave: { status: 'approved' } },
        });

        //   No payment anywhere, and WAVE has no payment gate — it must still
        //   open, or this change has quietly re-gated another module.
        expect(await checkModuleAccess(UID, ['wave_participant'] as UserRole[], 'wave' as never))
            .toBe(true);
    });

    it('POSITIVE CONTROL: AN ADMIN IS NOT A LEARNER AND IS NOT CHARGED', async () => {
        /*
         *   ADDED AFTER A SURVIVING MUTANT. Removing the admin carve-out from
         *   Layer 1 left this suite green, because it had no admin case at all
         *   — the regression was caught only by module-access-check-behaviour's
         *   'an admin role reaches every module'. A carve-out this change
         *   introduced should be held by the suite that introduced it.
         *
         *   ROLE_APP_ACCESS grants academy to `admin`, `super_admin` AND
         *   `academy_admin`; none of them has a registration or a programme
         *   fee, and academy_admin is the role that REVIEWS the applications.
         */
        const { checkModuleAccess } = await import('@/lib/module-access-check');

        for (const role of ['admin', 'super_admin', 'academy_admin']) {
            store = installFakeDb();
            //   Deliberately no user document, no registration, no payment:
            //   an admin must not need any of them.
            expect(
                { role, allowed: await checkModuleAccess(UID, [role] as UserRole[], 'academy' as never) },
            ).toEqual({ role, allowed: true });
        }
    });

    it('and a learner role is NOT a way round the gate', async () => {
        //   The other half: `academy_participant` is the role the defect
        //   granted, so it must not behave like an admin one.
        expect(await access(UID, ['academy_participant'])).toBe(false);
    });

    it('POSITIVE CONTROL: and a rejected Academy application is still refused', async () => {
        //   #763's rule, which must survive this change: a decision is not
        //   overridden by a leftover role. Paying does not undo a rejection.
        bareUser({
            roles: ['academy_participant'],
            serviceRegistrations: { academy: { status: 'rejected', paymentStatus: 'completed' } },
        });

        expect(await access(UID, ['academy_participant'])).toBe(false);
    });
});

/*
 * ── MUTATION TABLE ──────────────────────────────────────────────────────────
 *
 *   Applied to src/lib/module-access-check.ts, this suite re-run against each.
 *   COUNTS ARE MEASURED.
 *
 *   MUTANT                                    DEAD  FIRST TO FAIL
 *   ───────────────────────────────────────── ────  ──────────────────────────
 *   Layer 2.7 gate removed — the reported        2  'LAYER 2.7 — THE
 *   defect, at its original site                    APPLICATION IS APPROVED
 *                                                   AND UNPAID'
 *
 *   Layer 2 gate removed — the grant the         3  'LAYER 2 — AND THE
 *   defect's own heal fed                           REGISTRATION THE DEFECT
 *                                                   ALREADY WROTE'
 *
 *   Layer 2.5 gate removed                       1  'LAYER 2.5 — AND SO IS THE
 *                                                   ROLE IT GRANTED'
 *
 *   Layer 1's fast path restored for             2  'LAYER 2.5 — AND SO IS THE
 *   academy — the bypass that would have             ROLE IT GRANTED'
 *   made all three gates unreachable
 *
 *   legacy carve-out removed (user document)     1  'POSITIVE CONTROL: THE
 *                                                   LEGACY IMPORT'
 *
 *   legacy carve-out removed (application)       1  'POSITIVE CONTROL: A LEGACY
 *                                                   APPLICATION WITH NO
 *                                                   PAYMENT FIELD'
 *
 *   "paid" no longer counts, only "completed"    1  'POSITIVE CONTROL: THE
 *                                                   ADMIN — "paid" counts'
 *
 *   processed_payments fallback removed          2  'POSITIVE CONTROL: THE
 *                                                   AUTHORITATIVE FALLBACK'
 *
 *   course purchases no longer count             1  'POSITIVE CONTROL: AND A
 *   (enrollment dropped from the query)             COURSE PURCHASE IS MONEY'
 *
 *   any payment counts, settled or not           1  'and a payment that never
 *   (status filter dropped)                         completed is not a payment'
 *
 *   admin carve-out removed                      1  'POSITIVE CONTROL: AN ADMIN
 *                                                   IS NOT A LEARNER'
 *
 *   ── ONE THAT SURVIVED FIRST ────────────────────────────────────────────────
 *
 *   The admin carve-out mutant SURVIVED the first run: this suite had no admin
 *   case, so removing the carve-out was caught only by
 *   module-access-check-behaviour's 'an admin role reaches every module' — a
 *   suite that knows nothing about payment. A carve-out introduced by this
 *   change should be held by the suite that introduced it, so the control was
 *   added and the mutant re-run.
 *
 *   CONTROL — SHOULD SURVIVE
 *   reword a comment in the gate                 0  SURVIVED ✓
 */
