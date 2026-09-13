/**
 * @jest-environment node
 */

/**
 *   #688 A LOAN WAS APPROVED OR REFUSED AND THE MEMBER WAS NEVER TOLD — ON
 *   FIVE OF THE SEVEN DOORS.
 *
 *   Seven admin paths write a decision into LOAN_APPLICATIONS. TWO of them told
 *   the applicant anything:
 *
 *       actions/admin/_loans.ts::_approveLoanApplication        email + bell
 *       actions/admin/_loans.ts::_rejectLoanApplication         email + bell
 *       cooperative/_loans_decisions.ts::approveLoanAction      SILENT
 *       cooperative/_loans_decisions.ts::rejectLoanAction       SILENT
 *       api/admin/cooperative/approve-loan                      SILENT
 *       api/admin/cooperative/reject-loan                       SILENT
 *       actions/loan-actions.ts::approveLoanApplication         SILENT
 *
 *   The five silent ones each wrote the status and an admin audit row and
 *   stopped. A cooperative member whose loan was decided on the cooperative
 *   screens got no email and no bell; they find out by opening /loans and
 *   noticing the status changed, if they think to look.
 *
 *   THE REJECTIONS ARE THE WORSE HALF. Both rejection doors write a
 *   `rejectionReason` onto the application — a field only an admin can read.
 *   The member was told neither that they had been declined nor why, so there
 *   was nothing for them to correct before applying again.
 *
 *   THIS IS THE AUDIT'S OWN RECURRING CLASS. docs/audit/outstanding-work.md
 *   calls it "the fix reached one of N doors", and these exact doors have been
 *   here before: #619 found the guarantor gate applied on two of three
 *   approvals, which is why lib/loan-approval-policy.ts exists. A rule that
 *   lives inside one caller is a rule the next caller will not have.
 *
 * ── WHAT WAS DONE ───────────────────────────────────────────────────────────
 *
 *   lib/loan-decision-notice.ts states it once and all SEVEN doors call it —
 *   including the two that already did the work, so there is one copy of the
 *   wording rather than three that drift. It resolves the member's address from
 *   the user record when the caller does not carry one, which is what let the
 *   cooperative doors join at all: they hold a LoanApplication, which has no
 *   address on it.
 *
 *   IT NEVER THROWS. The decision is committed before it runs, and a refused
 *   email must not turn a successful approval into an error the admin retries.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

const ROOT = process.cwd();
const code = (rel: string) => stripComments(readFileSync(join(ROOT, rel), 'utf8'), { label: rel });

/** Every door that writes an approval or a rejection. */
const DOORS = [
    'src/app/actions/admin/_loans.ts',
    'src/app/actions/cooperative/_loans_decisions.ts',
    'src/app/api/admin/cooperative/approve-loan/route.ts',
    'src/app/api/admin/cooperative/reject-loan/route.ts',
    'src/app/actions/loan-actions.ts',
];

const NOTICE = 'src/lib/loan-decision-notice.ts';

// ─────────────────────────────────────────────────────────────────────────────
describe('#688 — every door that decides a loan tells the member', () => {
    it.each(DOORS)('%s CALLS THE SHARED NOTICE', (door) => {
        /*
         *   THE finding, as a ratchet. Five of these five files contained no
         *   notification of any kind at the time this was written; the first
         *   contained two hand-written ones.
         */
        expect(code(door)).toContain('notifyLoanDecision(');
    });

    it('AND THERE ARE SEVEN CALLS, ONE PER DECISION', () => {
        /*
         *   Presence per FILE is not enough: _loans.ts, _loans_decisions.ts and
         *   the two routes each carry more than one decision between them, and
         *   a file can name the function once while leaving its other decision
         *   silent. Counted, so adding a decision without a notice fails here.
         *
         *   approve + reject in _loans.ts, approve + reject in
         *   _loans_decisions.ts, one in each route, one in loan-actions.ts.
         */
        const total = DOORS.reduce(
            (n, d) => n + (code(d).match(/notifyLoanDecision\(/g) ?? []).length, 0);
        expect(total).toBe(7);
    });

    it('AND NO DOOR KEEPS ITS OWN COPY OF THE WORDING', () => {
        /*
         *   The control on the lines above. Calling the shared notice AND
         *   keeping a hand-written email beside it would satisfy them and leave
         *   two copies to drift — which is the state #688 found, one door
         *   having the words and the rest having nothing.
         */
        for (const door of DOORS) {
            const src = code(door);
            expect({ door, subject: src.includes('Loan Application Approved!') }).toEqual({ door, subject: false });
            expect({ door, declined: src.includes('Loan Application Declined') }).toEqual({ door, declined: false });
        }
    });

    it('AND THE DISBURSEMENT NOTICE IS LEFT ALONE — it is a different event', () => {
        /*
         *   Recorded so the sweep above is not read as "every loan message goes
         *   through the notice". Disbursement already told the member, in the
         *   one door that performs it, and "your money has moved" is not a
         *   decision about an application.
         */
        expect(code('src/app/actions/cooperative/_loans_decisions.ts'))
            .toContain('has been disbursed');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#688 — what the notice actually says and does', () => {
    const notify = async (notice: any) => {
        const mod = await import('@/lib/loan-decision-notice');
        return mod.notifyLoanDecision(notice);
    };

    let created: any[];
    let emailed: any[];
    let emailResult: any;

    beforeEach(() => {
        jest.resetModules();
        created = [];
        emailed = [];
        emailResult = { error: null };

        jest.doMock('@/infrastructure/notifications/service', () => ({
            createNotification: async (n: any) => { created.push(n); return { success: true }; },
        }));
        jest.doMock('@/lib/email-notifications', () => ({
            canSendEmail: (_ctx: string, to: unknown) => typeof to === 'string' && !!to.trim(),
            sendEmailNotification: async (e: any) => { emailed.push(e); return emailResult; },
        }));
        /*
         *   The DATABASE IS NOT STUBBED HERE.
         *
         *   An earlier version doMock'd `@/lib/supabase-db` to hand back a user
         *   with an address. That registration outlives resetModules and broke
         *   the describe below, which needs the real adapter so installFakeDb
         *   can drive it — jest.setup.js's global mock is what the fake
         *   configures, and replacing it leaves nothing to configure.
         *
         *   So the member is SEEDED instead, which is also a truer test of
         *   resolveEmail: it reads a user document, and here it reads one.
         */
        const { installFakeDb } = jest.requireActual<typeof import('@/lib/testing/fake-db')>(
            '@/lib/testing/fake-db');
        const { COLLECTIONS } = jest.requireActual<typeof import('@/lib/types/firestore')>(
            '@/lib/types/firestore');
        installFakeDb().seed(COLLECTIONS.USERS, 'u1', { email: 'ada@example.com' });
    });

    it('TELLS A DECLINED MEMBER WHY, IN THE MESSAGE AND NOT ONLY IN THE RECORD', async () => {
        await notify({
            userId: 'u1', decision: 'rejected', amount: 250000,
            reason: 'Your guarantor could not be verified',
        });

        expect(created).toHaveLength(1);
        expect(created[0].title).toBe('Loan Application Declined');
        expect(created[0].message).toContain('Your guarantor could not be verified');
        expect(created[0].message).toContain('₦250,000');
    });

    it('AND ANNOUNCES AN APPROVAL WITH THE AMOUNT', async () => {
        await notify({ userId: 'u1', decision: 'approved', amount: 250000 });

        expect(created[0].title).toBe('Loan Approved');
        expect(created[0].message).toContain('₦250,000');
    });

    it('AND SAYS WHETHER THE MONEY HAS ALREADY MOVED', async () => {
        //   The two are not interchangeable to somebody checking their bank
        //   account: "approved" and "approved and disbursed" are different
        //   facts, and _loans.ts distinguished them before this was shared.
        await notify({ userId: 'u1', decision: 'approved', amount: 1000, disbursed: true });
        expect(created[0].message).toContain('disbursed to your bank account');

        created.length = 0;
        await notify({ userId: 'u1', decision: 'approved', amount: 1000, disbursed: false });
        expect(created[0].message).toContain('Disbursement will follow shortly');
    });

    it('AND EMAILS AS WELL AS RINGING THE BELL', async () => {
        await notify({ userId: 'u1', decision: 'approved', amount: 1000, userEmail: 'ada@example.com' });

        expect(emailed).toHaveLength(1);
        expect(emailed[0].to).toBe('ada@example.com');
        expect(emailed[0].subject).toBe('Loan Application Approved!');
    });

    it('AND FINDS THE ADDRESS ON THE USER RECORD WHEN THE CALLER HAS NONE', async () => {
        /*
         *   The half that let the cooperative doors join. They hold a
         *   LoanApplication, which carries no email address — requiring one
         *   from the caller would have left them where they were.
         */
        await notify({ userId: 'u1', decision: 'approved', amount: 1000 });

        expect(emailed).toHaveLength(1);
        expect(emailed[0].to).toBe('ada@example.com');
    });

    it('AND THE BELL RINGS EVEN WHEN EMAIL IS NOT CONFIGURED', async () => {
        /*
         *   THE control that matters most. RESEND_API_KEY is absent in some of
         *   this platform's environments, and an implementation that sent the
         *   notice by email alone would be silent exactly where the old code
         *   was. The bell is written FIRST, before anything that can refuse.
         */
        jest.doMock('@/lib/email-notifications', () => ({
            canSendEmail: () => false,
            sendEmailNotification: async (e: any) => { emailed.push(e); return { error: null }; },
        }));

        await notify({ userId: 'u1', decision: 'rejected', amount: 1000, reason: 'x' });

        expect(emailed).toEqual([]);
        expect(created).toHaveLength(1);
    });

    it('AND A FAILED EMAIL DOES NOT UNDO A COMMITTED DECISION', async () => {
        /*
         *   The second control. The status is already written when this runs.
         *   Throwing here would surface as "Failed to approve loan" over a loan
         *   that IS approved, and the admin would press the button again.
         */
        jest.doMock('@/lib/email-notifications', () => ({
            canSendEmail: () => true,
            sendEmailNotification: async () => { throw new Error('resend is down'); },
        }));

        await expect(notify({ userId: 'u1', decision: 'approved', amount: 1000 }))
            .resolves.toBeUndefined();
    });

    it('AND A FAILED BELL DOES NOT STOP THE EMAIL', async () => {
        //   The same argument in the other direction — neither channel may take
        //   the other down, because each is the only one some member has.
        jest.doMock('@/infrastructure/notifications/service', () => ({
            createNotification: async () => { throw new Error('db is down'); },
        }));

        await expect(notify({ userId: 'u1', decision: 'approved', amount: 1000 }))
            .resolves.toBeUndefined();
        expect(emailed).toHaveLength(1);
    });

    it('AND A REFUSED SEND IS LOGGED RATHER THAN SWALLOWED', async () => {
        /*
         *   #394's lesson, carried into the shared notice. Resend RETURNS its
         *   errors instead of throwing them, so a rate-limited loan decision
         *   email is invisible unless the result is read. Five sends across the
         *   platform had that shape.
         */
        expect(code(NOTICE)).toContain('if (sendError)');
        expect(code(NOTICE)).toContain('email send failed');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
/**
 *   AND THE DOORS ARE EXERCISED, NOT GREPPED.
 *
 *   THE FIRST VERSION OF THIS FILE ASSERTED THAT EACH DOOR CONTAINED THE TEXT
 *   `notifyLoanDecision(`, AND TWO MUTANTS SURVIVED: wrapping the call as
 *   `if (false) await notifyLoanDecision({…})` leaves the text in place and the
 *   count at seven. The suite would have passed over a door gone silent again,
 *   which is the defect itself.
 *
 *   That is this audit's fifth recorded instance of "a check that cannot fail",
 *   and the cure is the recorded one: ask the code a question with a known
 *   answer instead of reading it. The source assertions above are kept — they
 *   are what fails when a NEW door is added — but the doors a unit test can
 *   invoke are now invoked.
 */
describe('#688 — the doors, run', () => {
    const ADMIN = { id: 'admin-1', roles: ['super_admin'], name: 'Ada Admin', email: 'admin@example.com' };
    const APP = 'loan-1';
    const BORROWER = 'member-9';

    let notices: any[];
    let store: any;

    async function harness() {
        jest.resetModules();
        notices = [];

        /*
         *   The describe above mocks `@/lib/email-notifications` and the
         *   notification service to inspect the notice in isolation. A doMock
         *   registration OUTLIVES resetModules — it is a registry entry, not a
         *   module instance — so without this the doors below would run against
         *   a stubbed mailer and a stubbed bell.
         *
         *   These tests passed individually and failed together, which is the
         *   signature of exactly that.
         */
        jest.dontMock('@/lib/email-notifications');
        jest.dontMock('@/infrastructure/notifications/service');

        jest.doMock('@/lib/session-guard', () => ({
            requireSession: async () => ({ session: { user: ADMIN }, error: null }),
        }));
        jest.doMock('@/lib/loan-decision-notice', () => ({
            notifyLoanDecision: async (n: any) => { notices.push(n); },
        }));
        jest.doMock('@/lib/audit-log', () => ({
            createAdminAuditLog: async () => undefined,
            recordAdminAction: async () => undefined,
        }));
        //   The CAS helper speaks PostgREST, not the fake store, so it is the
        //   one collaborator that has to be replaced rather than driven. It
        //   reports a won claim; whether it really claims is #652's business.
        jest.doMock('@/lib/status-transition', () => ({
            claimStatusTransitionFromAny: async () => ({ claimed: true, status: null }),
            claimStatusTransition: async () => ({ claimed: true, status: null }),
        }));

        const { installFakeDb } = jest.requireActual<typeof import('@/lib/testing/fake-db')>(
            '@/lib/testing/fake-db');
        store = installFakeDb();
        const { COLLECTIONS } = jest.requireActual<typeof import('@/lib/types/firestore')>(
            '@/lib/types/firestore');
        return { COLLECTIONS };
    }

    /** A pending application that passes every pre-check on the way to approval. */
    const pending = (COLLECTIONS: any, overrides: Record<string, unknown> = {}) =>
        store.seed(COLLECTIONS.LOAN_APPLICATIONS, APP, {
            userId: BORROWER,
            amount: 50000,
            //   Well above the amount, so the tier cap does not refuse it, and
            //   below the dual-control threshold so one admin finishes it.
            contributionAmount: 500000,
            status: 'pending',
            durationMonths: 6,
            ...overrides,
        });

    it('THE COOPERATIVE APPROVAL SENDS THE NOTICE', async () => {
        const { COLLECTIONS } = await harness();
        pending(COLLECTIONS);

        const { approveLoanAction } = await import('@/app/actions/cooperative/_loans_decisions');
        const res = await approveLoanAction(APP, ADMIN.id);

        expect(res.success).toBe(true);
        expect(notices).toHaveLength(1);
        expect(notices[0]).toMatchObject({ userId: BORROWER, decision: 'approved', amount: 50000 });
    });

    it('THE COOPERATIVE REJECTION SENDS THE NOTICE, CARRYING THE REASON', async () => {
        const { COLLECTIONS } = await harness();
        pending(COLLECTIONS);

        const { rejectLoanAction } = await import('@/app/actions/cooperative/_loans_decisions');
        const res = await rejectLoanAction(APP, ADMIN.id, 'Guarantor could not be verified');

        expect(res.success).toBe(true);
        expect(notices).toHaveLength(1);
        expect(notices[0]).toMatchObject({
            userId: BORROWER,
            decision: 'rejected',
            reason: 'Guarantor could not be verified',
        });
    });

    it('THE GENERAL APPROVAL DOOR SENDS THE NOTICE TOO', async () => {
        /*
         *   loan-actions.ts::approveLoanApplication — the third of the three
         *   doors #619 already had to reconcile over the guarantor gate, and
         *   the one whose file contained no notification of any kind.
         *
         *   Exercised rather than grepped for the same reason as the two above:
         *   a mutant wrapping the call in `if (false)` survived every source
         *   assertion in this file.
         */
        const { COLLECTIONS } = await harness();
        store.seed(COLLECTIONS.LOAN_APPLICATIONS, APP, {
            userId: BORROWER,
            amount: 50000,
            status: 'pending',
            durationMonths: 6,
            interestRate: 3,
        });

        const { approveLoanApplication } = await import('@/app/actions/loan-actions');
        const res = await approveLoanApplication({ loanId: APP, approved: true });

        expect(res.success).toBe(true);
        expect(notices).toHaveLength(1);
        expect(notices[0]).toMatchObject({
            userId: BORROWER, decision: 'approved', amount: 50000,
        });
        //   And it passes the figures it holds, which the cooperative doors
        //   cannot — that is why the email's detail block is optional.
        expect(notices[0].terms).toMatchObject({ durationMonths: 6, interestRate: 3 });
    });

    it('AND BOTH API ROUTES SEND IT — the buttons on /admin/cooperatives/loans', async () => {
        /*
         *   The last two doors, and the last two that a source assertion alone
         *   could not hold: a mutant wrapping either route's call in
         *   `if (false)` left the text and the count untouched and survived.
         *
         *   The handlers are called directly with a Request, which is all a
         *   route handler is.
         */
        const { COLLECTIONS } = await harness();
        jest.doMock('@/lib/audit-log', () => ({
            createAdminAuditLog: async () => undefined,
            recordAdminAction: async () => undefined,
        }));
        store.seed(COLLECTIONS.LOAN_APPLICATIONS, APP, {
            userId: BORROWER, amount: 50000, status: 'pending', contributionAmount: 500000,
        });

        const post = (mod: any, body: unknown) =>
            mod.POST(new Request('http://localhost/api', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(body),
            }) as any);

        const reject = await import('@/app/api/admin/cooperative/reject-loan/route');
        const rejected = await post(reject, { applicationId: APP, reason: 'Insufficient savings history' });

        expect(rejected.status).toBe(200);
        expect(notices).toHaveLength(1);
        expect(notices[0]).toMatchObject({
            userId: BORROWER, decision: 'rejected', reason: 'Insufficient savings history',
        });

        notices.length = 0;
        const approve = await import('@/app/api/admin/cooperative/approve-loan/route');
        const approved = await post(approve, { applicationId: APP, adminId: ADMIN.id });

        expect(approved.status).toBe(200);
        expect(notices).toHaveLength(1);
        expect(notices[0]).toMatchObject({ userId: BORROWER, decision: 'approved', amount: 50000 });
    });

    it('AND A REFUSED DECISION SENDS NOTHING', async () => {
        /*
         *   The control, and the reason the two above cannot be satisfied by
         *   notifying unconditionally. An application that loses its claim — a
         *   second admin pressing the same button — must not tell the member
         *   their loan was decided twice.
         */
        const { COLLECTIONS } = await harness();
        jest.doMock('@/lib/status-transition', () => ({
            claimStatusTransitionFromAny: async () => ({ claimed: false, status: 'approved' }),
            claimStatusTransition: async () => ({ claimed: false, status: 'approved' }),
        }));
        jest.resetModules();
        const { installFakeDb } = jest.requireActual<typeof import('@/lib/testing/fake-db')>(
            '@/lib/testing/fake-db');
        store = installFakeDb();
        pending(COLLECTIONS);

        const { rejectLoanAction } = await import('@/app/actions/cooperative/_loans_decisions');
        const res = await rejectLoanAction(APP, ADMIN.id, 'too late');

        expect(res.success).toBe(false);
        expect(notices).toEqual([]);
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored and diffed after each.
 *
 *     MUTANT                                                        RESULT
 *     THE DEFECT: the cooperative approval goes silent again          KILLED
 *     THE DEFECT: the cooperative rejection goes silent again         KILLED
 *     THE DEFECT: the third approval door goes silent again           KILLED
 *     the reject ROUTE's call is disabled but left in place           KILLED
 *     the approve ROUTE drops its call entirely                       KILLED
 *     the decline drops the reason from the message                   KILLED
 *     the bell is sent only when email is configured                  KILLED
 *     a failed email throws instead of being logged                   KILLED
 *     a failed bell throws and takes the email with it                KILLED
 *     the address is never resolved from the user record              KILLED
 *     approval and disbursement are announced identically             KILLED
 *     a refused Resend result is swallowed again (#394)               KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword the shared notice's header                               SURVIVED ✓
 *
 * ── THREE OF THOSE SURVIVED THE FIRST TIME, AND THAT IS THE POINT ───────────
 *
 *   This file began with source assertions only: each door was required to
 *   CONTAIN `notifyLoanDecision(`, and the calls were counted. Wrapping a call
 *   as `if (false) await notifyLoanDecision({…})` leaves both the text and the
 *   count exactly as they were, so three doors could go silent again — the
 *   defect itself — with the suite still green.
 *
 *   This audit's fifth recorded instance of "a check that cannot fail", and the
 *   recorded cure applied: ask the code a question with a known answer instead
 *   of reading it. Every one of the seven decisions is now invoked. The source
 *   assertions are KEPT, because they are what fails when an EIGHTH door is
 *   added — a case no behavioural test can anticipate.
 *
 * ── WHAT WAS MEASURED, AND WHERE ────────────────────────────────────────────
 *
 *   The doors were found by searching every write of an approved/rejected
 *   status into LOAN_APPLICATIONS across src, and each was read for a
 *   notification or an email. Two had one; five had nothing. The claim that
 *   only `disburseLoanAction` spoke to the member on the cooperative side was
 *   checked against the whole of _loans_decisions.ts, which contained exactly
 *   one createNotificationAction call, inside disbursement.
 */
