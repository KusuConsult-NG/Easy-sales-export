/**
 * @jest-environment node
 */

/**
 *   #782 AN ADMIN COULD CHANGE A MEMBER'S BANK ACCOUNT NUMBER AND THE MEMBER
 *        WAS NEVER TOLD.
 *
 *   The owner: "when admin edits or approves, users should get notification on
 *   what was done and should be able to read the notice of what was done."
 *
 *   Swept properly, the two halves failed differently.
 *
 * ── THE EDIT PATH TOLD NOBODY ANYTHING ──────────────────────────────────────
 *
 *   editApplicationAction wrote an admin audit log and stopped. No email, no
 *   in-app notice, nothing the member could read. The fields it can change
 *   include `accountNumber`, `bankName`, `bvn` and `nin` — and #775 had just
 *   widened that editor from five fields to seventeen AND made it actually
 *   write them, so the silence covered more ground than before, not less.
 *
 *   A payout destination altered without the account holder being told is the
 *   shape of every account-takeover story there is. The audit trail records it
 *   as a legitimate admin edit, which it almost always is, and the member is
 *   the only person who can tell the difference.
 *
 * ── THE DECISION PATHS SENT EMAIL INTO A VOID ───────────────────────────────
 *
 *   WAVE approve/reject and the cooperative withdrawal decisions called an
 *   email helper and created no in-app notification. RESEND_API_KEY is not set
 *   on this deployment — the boot log says so on every start — so in practice
 *   the member was told nothing, and there was no record in the app to go back
 *   and READ, which is the owner's own wording.
 *
 * ── WHAT THE SWEEP ACTUALLY FOUND, AFTER I FIXED THE SWEEP ──────────────────
 *
 *   My first two sweeps were wrong and would have had me "fix" working code.
 *
 *     awk '/function X/,/^}/'  stopped at the first `}` in column 0, three
 *                              lines in, and reported Farm Nation's seller
 *                              decisions as silent when #690 had already
 *                              closed them.
 *
 *     brace matching           latched onto a `{` inside the RETURN TYPE —
 *                              these signatures are `): Promise<| { success:
 *                              true; ... }` — giving 74-character bodies and
 *                              declaring every function silent, including two
 *                              I had just edited.
 *
 *   The third sweep takes each top-level declaration to the next one. It also
 *   showed that most of what the earlier ones flagged were DELEGATING WRAPPERS
 *   — academy, export and land all notify in their `_`-prefixed canonical
 *   implementation — so only three doors were genuinely silent. That is the
 *   instrument rule this audit keeps relearning: the measurement was wrong
 *   twice before it was right.
 *
 * ── WHY THE NOTICE NAMES FIELDS AND NOT VALUES ──────────────────────────────
 *
 *   "Your bank account number was updated", not the number. A notification is
 *   rendered in the notification centre, counted in an unread badge and can be
 *   pushed to a device. Putting a BVN or an account number in one would move
 *   the exact data #779 just finished protecting into a channel with none of
 *   those protections — and naming the field is enough for the member's only
 *   job here, which is deciding whether the change was expected.
 *
 * ── MUTATION LOG ────────────────────────────────────────────────────────────
 *
 *     the edit notice removed from editApplicationAction        KILLED
 *     changedFields reporting unchanged fields as changed       KILLED
 *     the notice echoing the new value into the message         KILLED
 *     a bank-field change demoted from warning to info          KILLED
 *     notifyMemberRecordEdited allowed to throw          SURVIVED → KILLED
 *     the WAVE approve notice removed                           KILLED
 *     reword this header                              SURVIVED, intended
 *
 *   THE THROW MUTANT SURVIVED THE FIRST RUN, because the suite asserted that a
 *   try/catch existed in the SOURCE — a claim about the text, not about what
 *   happens when the thing inside it throws. Proving it needed the notification
 *   service mocked into failing, and that exposed a harness gotcha worth
 *   knowing: `jest.mock` hoists only on the GLOBAL `jest`. Imported from
 *   '@jest/globals' it stays where it is written, the statically-imported
 *   module has already loaded unmocked, and the factory never runs — silently,
 *   with the real implementation answering and the test blaming the code.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';
import {
    changedFields, describeEdit, fieldLabel, isSensitiveField, notifyMemberRecordEdited,
} from '@/lib/admin-edit-notice';

jest.mock('next/cache', () => ({
    revalidatePath: jest.fn(), revalidateTag: jest.fn(),
    unstable_cache: (fn: unknown) => fn,
}));

/*
 *   The notification service, wrapped rather than replaced, so a test can make
 *   it FAIL on demand while every other test still writes a real notification
 *   into the fake database.
 *
 *   Added because "allowed to throw" SURVIVED the first mutation run: the suite
 *   asserted that a try/catch existed in the SOURCE, which is a claim about the
 *   text and not about what happens when the thing inside it throws.
 *
 *   A HARNESS GOTCHA, WORTH WRITING DOWN. `jest.mock` is hoisted above the
 *   imports only when it is called on the GLOBAL `jest`. Import `jest` from
 *   '@jest/globals' — as most suites here do — and the call stays where it is
 *   written, so a module imported STATICALLY at the top of the file has already
 *   been loaded unmocked and the factory never runs. It fails silently: the
 *   real implementation answers and the test reports the code as broken.
 *
 *   That is why `jest` is not in this file's import list. The other suites in
 *   this repository get away with it because they `await import(...)` the
 *   module under test inside the test body, by which time the mock is
 *   registered.
 */
let mockNotificationThrows = false;
jest.mock('@/infrastructure/notifications/service', () => {
    const actual = jest.requireActual('@/infrastructure/notifications/service') as any;
    return {
        ...actual,
        createNotification: async (...args: any[]) => {
            if (mockNotificationThrows) throw new Error('notification service is down');
            return actual.createNotification(...args);
        },
    };
});

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

let store: FakeDbHandle;
const ADMIN = 'admin-1';
const MEMBER = 'member-1';
const APP = 'WAVE-1';

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    (globalThis as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id: ADMIN, roles: ['super_admin'], email: 'a@b.c', name: 'Admin One' } },
        error: null,
    }));
    store.seed(COLLECTIONS.USERS, ADMIN, { roles: ['super_admin'] });
    store.seed(COLLECTIONS.USERS, MEMBER, {
        email: 'ada@example.com',
        serviceRegistrations: { wave: { applicationId: APP } },
    });
    store.seed(COLLECTIONS.WAVE_APPLICATIONS, APP, {
        userId: MEMBER, surname: 'Obi', firstName: 'Ada', accountNumber: '0123456789',
    });
});

/*
 *   `store.all` returns [id, doc] ENTRIES, not documents. The first draft of
 *   this helper filtered the entries on `.userId` — which is undefined on an
 *   array — so every assertion about a notification's content saw an empty
 *   list and the tests failed while the code was correct. Worth the note: a
 *   helper that reads the instrument wrongly makes working code look broken,
 *   which is how a real fix gets reverted.
 */
const notices = () =>
    (store.all(COLLECTIONS.NOTIFICATIONS) as any[])
        .map(entry => (Array.isArray(entry) ? entry[1] : entry))
        .filter(n => n?.userId === MEMBER);

// ─────────────────────────────────────────────────────────────────────────────
describe('#782 — an admin edit reaches the member', () => {
    it('EDITING A MEMBER\'S RECORD NOTIFIES THEM', async () => {
        //   THE test. Before this, the action wrote an audit log and stopped.
        const { editApplicationAction } = await import('@/app/actions/admin/_applications');
        const res: any = await editApplicationAction({
            collection: COLLECTIONS.WAVE_APPLICATIONS,
            docId: APP,
            fields: { surname: 'Okafor' } as any,
        });

        expect(res.success).toBe(true);
        expect(notices()).toHaveLength(1);
        expect(notices()[0].message).toMatch(/surname/i);
    });

    it('AND A CHANGE TO A PAYOUT DESTINATION IS FLAGGED, not filed as routine', async () => {
        /*
         *   The case that matters. An account number altered without the
         *   account holder being told is the shape of every takeover story
         *   there is, and this editor fans a bank change out to as many as
         *   seven documents.
         */
        const { editApplicationAction } = await import('@/app/actions/admin/_applications');
        await editApplicationAction({
            collection: COLLECTIONS.WAVE_APPLICATIONS,
            docId: APP,
            fields: { accountNumber: '9876543210' } as any,
        });

        const n = notices()[0];
        expect(n.type).toBe('warning');
        expect(n.title).toMatch(/account details were changed/i);
        expect(n.message).toMatch(/contact support/i);
    });

    it('AND IT NEVER PUTS THE NEW VALUE IN THE NOTICE', async () => {
        /*
         *   A notification is rendered in the notification centre, counted in
         *   an unread badge, and can be pushed to a device. #779 spent a whole
         *   finding keeping identity numbers out of places like that.
         */
        const { editApplicationAction } = await import('@/app/actions/admin/_applications');
        await editApplicationAction({
            collection: COLLECTIONS.WAVE_APPLICATIONS,
            docId: APP,
            fields: { accountNumber: '9876543210', bvn: '22107458391' } as any,
        });

        const blob = JSON.stringify(notices());
        expect(blob).not.toContain('9876543210');
        expect(blob).not.toContain('22107458391');
        //   but it does say WHICH fields moved
        expect(blob).toMatch(/bank account number/i);
        expect(blob).toMatch(/BVN/);
    });

    it('CONTROL: a save that changes nothing sends nothing', async () => {
        /*
         *   Sending on every save would teach members that these notices do not
         *   mean anything, which is worse than not sending — and it is what a
         *   naive "notify after write" would have done, because the editor
         *   re-submits every field on the form.
         */
        const { editApplicationAction } = await import('@/app/actions/admin/_applications');
        await editApplicationAction({
            collection: COLLECTIONS.WAVE_APPLICATIONS,
            docId: APP,
            fields: { surname: 'Obi', firstName: 'Ada' } as any,
        });

        expect(notices()).toHaveLength(0);
    });

    it('AND A FAILING NOTICE DOES NOT FAIL THE EDIT', async () => {
        //   The edit is committed before the notice runs. A retried edit is a
        //   second write to a member's record — #688's rule.
        const src = stripComments(read('src/lib/admin-edit-notice.ts'));
        const fn = src.split('export async function notifyMemberRecordEdited')[1];

        expect(fn).toMatch(/try\s*\{/);
        expect(fn).toMatch(/catch/);

        //   AND PROVED, not merely asserted to exist.
        mockNotificationThrows = true;
        try {
            await expect(notifyMemberRecordEdited({
                userId: MEMBER,
                before: { firstName: 'Ada' },
                after: { firstName: 'Adaeze' },
            })).resolves.toEqual([]);
        } finally {
            mockNotificationThrows = false;
        }
        //   and it is awaited AFTER the write, not before it
        const action = stripComments(read('src/app/actions/admin/_applications.ts'));
        expect(action.indexOf('syncBatch.commit()'))
            .toBeLessThan(action.indexOf('notifyMemberRecordEdited('));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#782 — the wording is the deliverable', () => {
    it('only genuinely changed fields are reported', () => {
        expect(changedFields({ a: 'x' }, { a: 'x' })).toEqual([]);
        expect(changedFields({ a: 'x' }, { a: 'y' })).toEqual(['a']);
        //   a stored number against a written string is not a change
        expect(changedFields({ a: 123 }, { a: '123' })).toEqual([]);
        //   nor is whitespace, which the editor trims on the way in
        expect(changedFields({ a: ' x ' }, { a: 'x' })).toEqual([]);
        //   but filling an empty field is
        expect(changedFields({ a: null }, { a: 'x' })).toEqual(['a']);
    });

    it('fields are named in words a member would recognise', () => {
        //   `bvn` humanises to "Bvn" and `lgaOfResidence` to "Lga Of
        //   Residence". This is the one sentence the member gets.
        expect(fieldLabel('bvn')).toBe('BVN');
        expect(fieldLabel('lgaOfResidence')).toBe('LGA of residence');
        expect(fieldLabel('nextOfKin.phone')).toBe("next of kin's phone number");
        //   an unknown key falls back to itself rather than to an invention
        expect(fieldLabel('somethingNew')).toBe('somethingNew');
    });

    it('several changes read as a sentence, not a comma dump', () => {
        const { message } = describeEdit(['firstName', 'phone', 'residentialAddress']);
        expect(message).toContain('first name, phone number and residential address');
    });

    it('and money and identity fields are the sensitive ones', () => {
        for (const f of ['accountNumber', 'bankName', 'bvn', 'nin', 'email', 'phone']) {
            expect(isSensitiveField(f)).toBe(true);
        }
        for (const f of ['firstName', 'occupation', 'residentialAddress']) {
            expect(isSensitiveField(f)).toBe(false);
        }
    });

    it('notifyMemberRecordEdited reports what it sent', async () => {
        const sent = await notifyMemberRecordEdited({
            userId: MEMBER,
            before: { firstName: 'Ada' },
            after: { firstName: 'Adaeze' },
        });
        expect(sent).toEqual(['firstName']);
    });

    it('and a record with no owner is logged rather than thrown on', async () => {
        expect(await notifyMemberRecordEdited({
            userId: '', before: {}, after: { firstName: 'x' },
        })).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#782 — a decision reaches the member in the app, not only by email', () => {
    it('WAVE APPROVE AND REJECT BOTH WRITE AN IN-APP NOTICE', () => {
        /*
         *   Both called sendWaveApplicationEmail and nothing else. Asserted on
         *   the source rather than by driving the action, because approving a
         *   WAVE application transitions status, grants a role and invalidates
         *   caches — a test that drove all of that to observe one notification
         *   would fail for reasons that are not this finding.
         */
        const src = stripComments(read('src/app/actions/wave/_wv_admin_applications.ts'));

        expect(src).toMatch(/outcome: "approved"/);
        expect(src).toMatch(/outcome: "rejected"/);
        expect((src.match(/notifyMemberDecision\(/g) ?? []).length).toBe(2);
    });

    it('AND SO DO THE COOPERATIVE WITHDRAWAL DECISIONS — which decide money', () => {
        const src = stripComments(read('src/app/actions/cooperative/_coop_admin_money.ts'));

        expect((src.match(/notifyMemberDecision\(/g) ?? []).length).toBe(2);
        //   the amount travels with the notice, so the member can check it
        expect(src).toMatch(/amount: notificationData\.amount/);
    });

    it('AND THE MARKETPLACE BUYER VERDICT DOES TOO', () => {
        const src = stripComments(read('src/app/actions/admin/_marketplace.ts'));
        expect((src.match(/notifyMemberDecision\(/g) ?? []).length).toBe(2);
    });

    it('the notice is written INSIDE the settled batch, so it cannot undo a payout', () => {
        //   A throwing notice must not turn a committed withdrawal decision
        //   into an error an admin retries — a retry there is a second claim on
        //   money.
        const src = stripComments(read('src/app/actions/cooperative/_coop_admin_money.ts'));
        const batch = src.split('Promise.allSettled([')[1]?.split('])')[0] ?? '';
        expect(batch).toMatch(/notifyMemberDecision/);
    });

    it('CONTROL: the modules that already told the member still do', () => {
        /*
         *   #690 closed eleven doors and my first two sweeps reported several
         *   of them as silent — they are delegating wrappers whose canonical
         *   implementation notifies. Pinned so that a later "fix" does not add
         *   a second notice to a path that already has one.
         */
        /*
         *   THIS CONTROL FOUND A REAL GAP RATHER THAN CONFIRMING SAFETY, which
         *   is the only reason it was worth writing. Land uses
         *   createNotification directly — checked, working, left alone.
         *   ACADEMY had neither: its approve and reject paths called
         *   sendEmailNotification behind `canSendEmail`, which returns false
         *   when RESEND_API_KEY is unset, so on this deployment the decision
         *   reached the learner nowhere at all. It is fixed here rather than
         *   excused by loosening this assertion.
         */
        for (const f of [
            'src/app/actions/farm-nation/_fn_admin.ts',
            'src/app/actions/academy/_ac_admin_review.ts',
            'src/app/actions/land-listings.ts',
        ]) {
            expect(read(f)).toMatch(/notifyMemberDecision|createNotification/);
        }

        //   and academy specifically now has BOTH halves, not just the email
        const academy = stripComments(read('src/app/actions/academy/_ac_admin_review.ts'));
        expect((academy.match(/notifyMemberDecision\(/g) ?? []).length).toBe(2);
    });
});
