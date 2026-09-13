/**
 * @jest-environment node
 */

/**
 *   #690 AN ADMIN DECIDED, AND THE MEMBER WAS NOT TOLD — THIRTEEN TIMES,
 *   ACROSS FIVE MODULES.
 *
 *   #688 found this on loan decisions and fixed it there. This is the rest of
 *   it, found by sweeping for the same shape instead of by reading: every write
 *   of an approved / rejected / verified verdict through `update()`, `set()` or
 *   a claimed transition, checked for a notice anywhere in the enclosing
 *   function.
 *
 *     WAVE        withdrawal approved / rejected / completed
 *     Land        listing verified or rejected — the platform's MAIN land
 *                 decision, eight call sites, in a file with no notification
 *                 of any kind
 *     FarmNation  land approved, land rejected  (both API routes)
 *     FarmNation  seller approved, seller rejected, property verified
 *     Academy     application REJECTED — while approval emails, in the same file
 *     Content     a member's product, land or export listing approved/rejected
 *
 *   THE ASYMMETRIES ARE THE TELL, because nobody designed them:
 *
 *     - Three withdrawal systems decide a member's money. The cooperative one
 *       emails, wallet.ts rings the bell, and WAVE did neither.
 *     - _approveAcademyApplicationAction sends an email;
 *       _rejectAcademyApplicationAction, in the same file, sends nothing.
 *     - land-listings.ts notifies the ADMIN when a listing arrives and the
 *       member nothing when it is judged.
 *
 *   And every rejection wrote its reason — `rejectionReason`, `adminNotes`,
 *   `verificationNotes` — onto a record only an admin can read. The member was
 *   told neither the verdict nor the reason, so there was nothing to act on.
 *
 * ── THE SWEEP TOOK THREE ATTEMPTS, AND THAT IS RECORDED ─────────────────────
 *
 *   Each attempt found more, and the instrument was validated against doors
 *   whose answer was already known — the seven loan decisions #688 had just
 *   repaired — before any result was believed.
 *
 *     1. Matched `status: "approved"` anywhere. 72 "silent" hits, most of them
 *        query FILTERS and reads. Useless.
 *     2. Narrowed to writes, and widened the notice vocabulary — it had missed
 *        `sendWithdrawalApprovedEmail`, so the cooperative withdrawal read as
 *        silent when it is not. 23 hits.
 *     3. Read the whole VALUE expression of the status key, not just a literal.
 *        `to: LandStatus.VERIFIED` and
 *        `to: validated.verified ? 'verified' : 'rejected'` were both invisible
 *        to attempt 2 — and the second of those is the platform's main land
 *        decision, which the first two sweeps missed twice.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

const ROOT = process.cwd();
const code = (rel: string) => stripComments(readFileSync(join(ROOT, rel), 'utf8'), { label: rel });

/** Every door this finding wired, with how many decisions each carries. */
const DOORS: Array<[string, number]> = [
    ['src/app/actions/wave/_wv_admin_withdrawals.ts', 1],
    ['src/app/actions/land-actions.ts', 1],
    ['src/app/actions/land-listings.ts', 2],
    ['src/app/actions/farm-nation/_fn_admin.ts', 3],
    ['src/app/actions/admin/_academy.ts', 1],
    ['src/app/actions/admin-content.ts', 2],
    ['src/app/api/admin/farm-nation/approve-land/route.ts', 1],
    ['src/app/api/admin/farm-nation/reject-land/route.ts', 1],
];

// ─────────────────────────────────────────────────────────────────────────────
describe('#690 — every verdict reaches the member it is about', () => {
    it.each(DOORS)('%s SENDS THE DECISION NOTICE', (door) => {
        expect(code(door)).toContain('notifyMemberDecision(');
    });

    it('AND THERE IS ONE CALL PER DECISION, NOT ONE PER FILE', () => {
        /*
         *   Presence per file is not enough: _fn_admin.ts carries three
         *   decisions and admin-content.ts two, and a file can name the
         *   function once while leaving its other decisions silent.
         */
        for (const [door, n] of DOORS) {
            const found = (code(door).match(/notifyMemberDecision\(/g) ?? []).length;
            expect({ door, found }).toEqual({ door, found: n });
        }
    });

    it('AND EVERY REJECTION CARRIES ITS REASON', () => {
        /*
         *   The half that makes a refusal useful. Each of these wrote its
         *   reason onto a record only an admin can read — `rejectionReason`,
         *   `adminNotes`, `verificationNotes` — so a member was told neither
         *   the verdict nor why.
         *
         *   Read as the arguments of each rejecting call, so a call that
         *   reports the outcome and drops the reason fails here.
         */
        const rejecting = DOORS.map(([d]) => d).filter((d) => {
            const src = code(d);
            return /outcome:\s*"rejected"/.test(src) || /\?\s*"rejected"/.test(src);
        });
        expect(rejecting.length).toBeGreaterThanOrEqual(6);

        for (const door of rejecting) {
            const src = code(door);
            for (const m of src.matchAll(/notifyMemberDecision\(\{([\s\S]{0,700}?)\n\s*\}\)/g)) {
                const args = m[1];
                if (!/outcome:\s*"rejected"|\?\s*"rejected"/.test(args)) continue;
                expect({ door, carriesReason: /reason[,:]/.test(args) })
                    .toEqual({ door, carriesReason: true });
            }
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#690 — what the notice says', () => {
    const notify = async (n: any) => (await import('@/lib/member-decision-notice')).notifyMemberDecision(n);

    let created: any[];
    let emailed: any[];

    beforeEach(() => {
        jest.resetModules();
        created = [];
        emailed = [];
        jest.doMock('@/infrastructure/notifications/service', () => ({
            createNotification: async (n: any) => { created.push(n); return { success: true }; },
        }));
        jest.doMock('@/lib/email-notifications', () => ({
            canSendEmail: (_c: string, to: unknown) => typeof to === 'string' && !!to.trim(),
            sendEmailNotification: async (e: any) => { emailed.push(e); return { error: null }; },
        }));
        const { installFakeDb } = jest.requireActual<typeof import('@/lib/testing/fake-db')>(
            '@/lib/testing/fake-db');
        const { COLLECTIONS } = jest.requireActual<typeof import('@/lib/types/firestore')>(
            '@/lib/types/firestore');
        installFakeDb().seed(COLLECTIONS.USERS, 'u1', { email: 'ada@example.com' });
    });

    it('TELLS A REFUSED MEMBER WHY', async () => {
        await notify({
            userId: 'u1', subject: 'Your land listing', outcome: 'rejected',
            reason: 'The survey plan was illegible', link: '/farm-nation',
        });

        expect(created).toHaveLength(1);
        expect(created[0].title).toBe('Your land listing — Not approved');
        expect(created[0].message).toContain('was not approved');
        expect(created[0].message).toContain('The survey plan was illegible');
    });

    it('AND NAMES THE AMOUNT WHEN THE DECISION IS ABOUT MONEY', async () => {
        await notify({
            userId: 'u1', subject: 'Your WAVE withdrawal', outcome: 'rejected',
            amount: 75000, reason: 'Bank details did not match', link: '/wave/earnings',
        });

        expect(created[0].message).toContain('₦75,000');
    });

    it('AND SAYS SO WHEN IT WENT THE MEMBER\'S WAY', async () => {
        //   The control: a notice that only ever reported refusals would
        //   satisfy the two above and leave every approval silent, which is
        //   half of what this finding found.
        await notify({
            userId: 'u1', subject: 'Your land listing', outcome: 'approved',
            link: '/farm-nation', note: 'It is now visible to buyers on Farm Nation.',
        });

        expect(created[0].title).toBe('Your land listing — Approved');
        expect(created[0].message).toContain('has been approved');
        expect(created[0].message).toContain('visible to buyers');
    });

    it('AND DOES NOT PUT A REASON ON AN APPROVAL', async () => {
        //   "Approved. Reason: …" reads as a refusal at a glance.
        await notify({
            userId: 'u1', subject: 'Your land listing', outcome: 'approved',
            reason: 'should not appear', link: '/x',
        });
        expect(created[0].message).not.toContain('should not appear');
    });

    it('AND EMAILS AS WELL AS RINGING THE BELL', async () => {
        await notify({ userId: 'u1', subject: 'Your listing', outcome: 'approved', link: '/x' });

        expect(emailed).toHaveLength(1);
        expect(emailed[0].to).toBe('ada@example.com');
    });

    it('AND THE BELL RINGS EVEN WHEN EMAIL IS NOT CONFIGURED', async () => {
        //   RESEND_API_KEY is absent in some of this platform's environments.
        //   A notice that went by email alone would be silent exactly where the
        //   old code was.
        jest.doMock('@/lib/email-notifications', () => ({
            canSendEmail: () => false,
            sendEmailNotification: async (e: any) => { emailed.push(e); return { error: null }; },
        }));

        await notify({ userId: 'u1', subject: 'Your listing', outcome: 'rejected', reason: 'x', link: '/x' });

        expect(emailed).toEqual([]);
        expect(created).toHaveLength(1);
    });

    it('AND NEVER THROWS, WHICHEVER CHANNEL FAILS', async () => {
        /*
         *   The decision is committed before this runs. Throwing would report a
         *   completed approval as a failure the admin then retries — and on the
         *   withdrawal paths a retry is a second claim attempt on money.
         */
        jest.doMock('@/infrastructure/notifications/service', () => ({
            createNotification: async () => { throw new Error('db down'); },
        }));
        jest.doMock('@/lib/email-notifications', () => ({
            canSendEmail: () => true,
            sendEmailNotification: async () => { throw new Error('resend down'); },
        }));

        await expect(notify({ userId: 'u1', subject: 'X', outcome: 'approved', link: '/x' }))
            .resolves.toBeUndefined();
    });

    it('AND A DECISION WITH NOBODY TO TELL IS LOGGED, NOT SENT TO ""', async () => {
        //   Every door reads the owner off a record. A record that lost its
        //   owner must not produce a notification addressed to the empty
        //   string, which is a row nobody can ever see or clear.
        await notify({ userId: '', subject: 'X', outcome: 'approved', link: '/x' });
        expect(created).toEqual([]);
        expect(emailed).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#690 — the doors, run', () => {
    /*
     *   #688's lesson: a source assertion that the call is PRESENT is satisfied
     *   by `if (false) await notifyMemberDecision(...)`. Three mutants proved it
     *   there. The two highest-stakes doors are exercised here — the one that
     *   decides money, and the one eight screens reach.
     */
    const ADMIN = { id: 'admin-1', roles: ['super_admin'], name: 'Ada Admin', email: 'a@example.com' };
    let notices: any[];
    let store: any;

    async function harness() {
        jest.resetModules();
        notices = [];
        jest.doMock('@/lib/session-guard', () => ({
            requireSession: async () => ({ session: { user: ADMIN }, error: null }),
        }));
        jest.doMock('@/lib/member-decision-notice', () => ({
            notifyMemberDecision: async (n: any) => { notices.push(n); },
        }));
        jest.doMock('@/lib/audit-log', () => ({
            createAdminAuditLog: async () => undefined,
            recordAdminAction: async () => undefined,
            logAdminAction: async () => undefined,
        }));
        jest.doMock('@/lib/status-transition', () => ({
            claimStatusTransitionFromAny: async () => ({ claimed: true, status: null, exists: true }),
            claimStatusTransition: async () => ({ claimed: true, status: null, exists: true }),
        }));
        const { installFakeDb } = jest.requireActual<typeof import('@/lib/testing/fake-db')>(
            '@/lib/testing/fake-db');
        store = installFakeDb();
        const { COLLECTIONS } = jest.requireActual<typeof import('@/lib/types/firestore')>(
            '@/lib/types/firestore');
        return { COLLECTIONS };
    }

    it('THE WAVE WITHDRAWAL REJECTION TELLS THE MEMBER, WITH THE ADMIN\'S NOTE', async () => {
        const { COLLECTIONS } = await harness();
        store.seed(COLLECTIONS.WAVE_WITHDRAWALS, 'w-1', {
            userId: 'member-9', amount: 75000, status: 'pending',
        });
        store.seed(COLLECTIONS.USERS, 'member-9', { email: 'ada@example.com' });

        const { processWaveWithdrawalAction } = await import('@/app/actions/wave/_wv_admin_withdrawals');
        const res: any = await processWaveWithdrawalAction({
            withdrawalId: 'w-1', action: 'reject', adminNotes: 'Bank details did not match',
        });

        expect(res.success).toBe(true);
        expect(notices).toHaveLength(1);
        expect(notices[0]).toMatchObject({
            userId: 'member-9',
            outcome: 'rejected',
            amount: 75000,
            reason: 'Bank details did not match',
        });
    });

    it('AND THE LAND VERIFICATION TELLS THE OWNER', async () => {
        const { COLLECTIONS } = await harness();
        store.seed(COLLECTIONS.LAND_LISTINGS, 'l-1', {
            ownerId: 'owner-3', status: 'pending_verification', title: 'A plot',
        });

        const { verifyLandListing } = await import('@/app/actions/land-actions');
        const res: any = await verifyLandListing({ listingId: 'l-1', verified: true } as any);

        expect(res.success).toBe(true);
        expect(notices).toHaveLength(1);
        expect(notices[0]).toMatchObject({ userId: 'owner-3', outcome: 'approved' });
    });

    it('AND A REFUSED CLAIM TELLS NOBODY', async () => {
        /*
         *   The control on both. A decision that lost its transition — a second
         *   admin pressing the same button — must not tell the member their
         *   listing was decided twice.
         */
        const { COLLECTIONS } = await harness();
        jest.doMock('@/lib/status-transition', () => ({
            claimStatusTransitionFromAny: async () => ({ claimed: false, status: 'verified', exists: true }),
            claimStatusTransition: async () => ({ claimed: false, status: 'verified', exists: true }),
        }));
        jest.resetModules();
        const { installFakeDb } = jest.requireActual<typeof import('@/lib/testing/fake-db')>(
            '@/lib/testing/fake-db');
        store = installFakeDb();
        store.seed(COLLECTIONS.LAND_LISTINGS, 'l-1', {
            ownerId: 'owner-3', status: 'verified', title: 'A plot',
        });

        const { verifyLandListing } = await import('@/app/actions/land-actions');
        const res: any = await verifyLandListing({ listingId: 'l-1', verified: true } as any);

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
 *     THE DEFECT: the WAVE withdrawal goes silent again               KILLED
 *     THE DEFECT: the main land verification goes silent again        KILLED
 *     the withdrawal rejection drops the admin's note                 KILLED
 *     the withdrawal notice loses the amount                          KILLED
 *     a rejection stops carrying its reason                           KILLED
 *     an approval carries a reason too                                KILLED
 *     the bell is sent only when email is configured                  KILLED
 *     a failed bell throws instead of being logged                    KILLED
 *     a decision with no member is sent to the empty string           KILLED
 *     the amount is dropped from the message                          KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword the shared notice's header                               SURVIVED ✓
 *
 *   THE FIRST TWO ARE THE ONES THAT MATTER, and they are written as
 *   `if (false) await notifyMemberDecision(...)` deliberately: that is the
 *   mutant that survived #688's source assertions three times over, because it
 *   leaves the text and the call count exactly as they were. They die here
 *   because both doors are INVOKED, not read.
 *
 * ── WHAT WAS MEASURED, AND WHERE ────────────────────────────────────────────
 *
 *   Every write of a verdict through update(), set() or a claimed transition,
 *   across all of src, checked for a notice anywhere in the enclosing function.
 *   54 verdicts. The sweep was validated at each attempt against the ten doors
 *   whose answer was already known — the loan decisions #688 repaired and the
 *   cooperative withdrawal, all of which must read as NOTIFYING — before any
 *   result was believed. It now reports one remaining silent verdict, and that
 *   one is a paid applicant auto-approved inside their OWN request: they are on
 *   the screen, and there is no admin decision to announce.
 */
