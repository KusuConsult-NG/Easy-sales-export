/**
 * @jest-environment node
 */

/**
 *   THE SAME LOOP, IN FOUR MORE PLACES.
 *
 *   #207 was the login self-heal. #225 was course enrolment. #227/#228 was the
 *   application the access check picked. Each time: a repair rule reads
 *   evidence, decides the member looks legitimate, and writes an approval back
 *   — without asking whether somebody had already decided the other way.
 *
 *   Sweeping the remaining role-grant sites for the same shape found four more.
 *
 *   #229 A SUSPENSION WAS UNDONE BY THE NEXT COOPERATIVE PAGE LOAD.
 *
 *        module-access-check.ts Layer 2.6:
 *
 *            const isHealable = !isApprovedOrActive
 *                && memberDocData.onboardingCompleted === true
 *                && memberDocData.paymentStatus === "completed";
 *
 *        A suspended member satisfies that exactly — they paid to join and
 *        their onboarding is complete, and "suspended" is not "active". So the
 *        heal fired: `membershipStatus: "active"` back onto the member document,
 *        `serviceRegistrations.cooperatives.status: "active"` and
 *        `arrayUnion("cooperative_member")` onto the user document, and access
 *        granted.
 *
 *        _coop_admin_members.ts was taught to revoke that role on suspension
 *        precisely so a suspended member loses the module — savings, loans,
 *        contributions, withdrawals. This layer handed it back on the next page
 *        load. registration-progress.ts states "the cooperative was safe only
 *        because its suspend path revokes the role too"; that was wrong, and
 *        this is the reason.
 *
 *   #230 AND BY OPENING THE MEMBERSHIP ID CARD.
 *
 *        _coop_identity.ts had the same rule, from a read-only screen. It also
 *        sat behind `if (!isPremiumSubscriber)` — read from
 *        `serviceRegistrations.academy.plan` — so a suspended member who had
 *        bought an ACADEMY plan skipped every cooperative gate and was issued a
 *        valid membership card. Buying a course is not a cooperative
 *        membership, and it is not an appeal.
 *
 *   #231 AND BY PAYING THE ACADEMY FEE AGAIN.
 *
 *        Both academy fulfilment paths — the client verify and the webhook that
 *        races it — auto-approve: find the application, write
 *        `status: "approved"` with `reviewedBy: "paystack_auto_approval"`, grant
 *        `academy_participant`, set `isVerified`. Right for a new applicant;
 *        paying the fee is what admits them. Neither asked whether an admin had
 *        already rejected them, so a rejection was reversible for the price of
 *        the registration fee.
 *
 *        The money is still recorded — claimPaymentOnce banks the reference and
 *        the ledger row is still written — so support can see and refund it.
 *        What no longer happens is the approval. And initiating such a payment
 *        is refused outright, which is the half that leaves nothing to refund.
 *
 *        The webhook read `.limit(1)` with no orderBy as well, so which
 *        application it approved was the #227 lottery, in a path that grants
 *        module access.
 *
 *   #232 AND BY REAPPLYING.
 *
 *        _ac_applications.ts auto-approves a paid applicant. The registration
 *        fee is paid once and the duplicate guard deliberately lets a rejected
 *        applicant reapply — the rejection email invites it. So the applicant
 *        an admin had just rejected submitted a new form and was auto-approved
 *        by their OLD payment, in the same request, role included.
 *
 *        A reapplication after a decision goes to the admin now. Nothing is
 *        lost: the payment still counts and the admin can approve. It just
 *        cannot happen without them.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';
import { isDecidedAgainst } from '@/lib/registration-progress';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null, setCache: async () => undefined,
    deleteCache: async () => undefined, redis: null,
}));

jest.mock('next/cache', () => ({
    revalidatePath: () => undefined,
    revalidateTag: () => undefined,
}));

const mockRequireSession = jest.fn() as jest.Mock<any>;
jest.mock('@/lib/session-guard', () => ({
    requireSession: (...a: any[]) => mockRequireSession(...a),
}));

let store: FakeDbHandle;
const USERS = COLLECTIONS.USERS;
const MEMBERS = COLLECTIONS.COOPERATIVE_MEMBERS;
const MEMBER = 'member-1';

const access = async () => await import('@/lib/module-access-check');
const identity = async () => await import('@/app/actions/cooperative/_coop_identity');

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
});

/**
 * The state _coop_admin_members.ts leaves behind after Suspend: the role is
 * revoked, both status copies say "suspended", and the member's PAYMENT and
 * ONBOARDING are untouched — which is exactly what the heals keyed on.
 */
const seedSuspendedMember = (overrides: Record<string, unknown> = {}) => {
    store.seed(USERS, MEMBER, {
        email: 'member@e.com',
        roles: ['general_user'],
        serviceRegistrations: { cooperatives: { status: 'suspended' } },
    });
    store.seed(MEMBERS, MEMBER, {
        userId: MEMBER,
        email: 'member@e.com',
        firstName: 'Ada',
        lastName: 'Obi',
        membershipStatus: 'suspended',
        paymentStatus: 'completed',
        onboardingCompleted: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        ...overrides,
    });
};

// ─────────────────────────────────────────────────────────────────────────────
describe('#229 — a suspended member does not heal back in on a page load', () => {
    it('IS REFUSED THE COOPERATIVE MODULE', async () => {
        seedSuspendedMember();

        // Was: true, via the Layer 2.6 "isHealable" branch.
        expect(await (await access()).checkModuleAccess(MEMBER, ['general_user'], 'cooperatives' as never))
            .toBe(false);
    });

    it('AND THE SUSPENSION IS NOT REWRITTEN AS ACTIVE', async () => {
        seedSuspendedMember();

        await (await access()).checkModuleAccess(MEMBER, ['general_user'], 'cooperatives' as never);

        expect(store.get(MEMBERS, MEMBER)?.membershipStatus).toBe('suspended');
        expect(store.get(USERS, MEMBER)?.serviceRegistrations.cooperatives.status).toBe('suspended');
    });

    it('AND THE ROLE THE SUSPENSION REVOKED IS NOT HANDED BACK', async () => {
        seedSuspendedMember();

        await (await access()).checkModuleAccess(MEMBER, ['general_user'], 'cooperatives' as never);

        expect(store.get(USERS, MEMBER)?.roles).not.toContain('cooperative_member');
        expect(store.get(USERS, MEMBER)?.isVerified).not.toBe(true);
    });

    it.each(['rejected', 'revoked', 'terminated', 'banned', 'cancelled'])(
        'covers %s too, not just suspended', async (status) => {
            seedSuspendedMember({ membershipStatus: status });
            store.seed(USERS, MEMBER, {
                email: 'member@e.com', roles: ['general_user'],
                serviceRegistrations: { cooperatives: { status } },
            });

            expect(await (await access()).checkModuleAccess(MEMBER, ['general_user'], 'cooperatives' as never))
                .toBe(false);
        });

    // ── and the heal this exists for still happens ───────────────────────────

    it('still heals a paid, onboarded member whose status was never set', async () => {
        // The case Layer 2.6 was written for: a member whose USER document was
        // never backfilled. Nothing was decided against them, so they go in.
        store.seed(USERS, MEMBER, { email: 'member@e.com', roles: ['general_user'] });
        store.seed(MEMBERS, MEMBER, {
            userId: MEMBER, email: 'member@e.com',
            membershipStatus: 'pending', paymentStatus: 'completed', onboardingCompleted: true,
        });

        expect(await (await access()).checkModuleAccess(MEMBER, ['general_user'], 'cooperatives' as never))
            .toBe(true);
        expect(store.get(MEMBERS, MEMBER)?.membershipStatus).toBe('active');
        expect(store.get(USERS, MEMBER)?.roles).toContain('cooperative_member');
    });

    it('still admits an already-active member without rewriting anything', async () => {
        store.seed(USERS, MEMBER, { email: 'member@e.com', roles: ['general_user'] });
        store.seed(MEMBERS, MEMBER, {
            userId: MEMBER, email: 'member@e.com',
            membershipStatus: 'active', paymentStatus: 'completed', onboardingCompleted: true,
        });

        expect(await (await access()).checkModuleAccess(MEMBER, ['general_user'], 'cooperatives' as never))
            .toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#230 — nor by opening the membership ID card', () => {
    const card = async () => (await identity()).getCooperativeMemberIdCardAction() as any;

    const asMember = () => mockRequireSession.mockResolvedValue({
        session: { user: { id: MEMBER, email: 'member@e.com', roles: ['general_user'] } },
    });

    it('REFUSES THE CARD', async () => {
        seedSuspendedMember();
        asMember();

        const res = await card();

        expect(res.success).toBe(false);
        expect(res.reason).toBe('membership_inactive');
    });

    it('AND DOES NOT WRITE THE MEMBERSHIP BACK TO ACTIVE', async () => {
        seedSuspendedMember();
        asMember();

        await card();

        expect(store.get(MEMBERS, MEMBER)?.membershipStatus).toBe('suspended');
        expect(store.get(USERS, MEMBER)?.serviceRegistrations.cooperatives.status).toBe('suspended');
    });

    it('AND AN ACADEMY PLAN DOES NOT BUY PAST IT', async () => {
        // isPremiumSubscriber reads serviceRegistrations.academy.plan and used
        // to skip every cooperative gate below it.
        seedSuspendedMember();
        store.seed(USERS, MEMBER, {
            email: 'member@e.com',
            roles: ['general_user'],
            serviceRegistrations: {
                cooperatives: { status: 'suspended' },
                academy: { plan: 'elite', status: 'approved' },
            },
        });
        asMember();

        const res = await card();

        expect(res.success).toBe(false);
        expect(res.reason).toBe('membership_inactive');
    });

    it('does not tell them to wait for an approval that already happened', async () => {
        seedSuspendedMember();
        asMember();

        const res = await card();

        expect(res.reason).not.toBe('pending_approval');
        expect(String(res.error)).not.toMatch(/pending admin approval/i);
    });

    // ── and a real member still gets their card ──────────────────────────────

    it('still issues a card to an active member', async () => {
        store.seed(USERS, MEMBER, {
            email: 'member@e.com', roles: ['cooperative_member'],
            firstName: 'Ada', lastName: 'Obi',
            serviceRegistrations: { cooperatives: { status: 'active' } },
        });
        store.seed(MEMBERS, MEMBER, {
            userId: MEMBER, email: 'member@e.com',
            firstName: 'Ada', lastName: 'Obi',
            membershipStatus: 'active', paymentStatus: 'completed', onboardingCompleted: true,
            createdAt: '2026-01-01T00:00:00.000Z',
        });
        asMember();

        expect(await card()).toMatchObject({ success: true });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the rule is one rule, not five hand-written status lists', () => {
    it('every decided-against spelling is recognised', () => {
        for (const s of ['rejected', 'declined', 'denied', 'suspended', 'revoked',
                         'cancelled', 'canceled', 'banned', 'withdrawn', 'terminated']) {
            expect(isDecidedAgainst(s)).toBe(true);
            expect(isDecidedAgainst(s.toUpperCase())).toBe(true);
            expect(isDecidedAgainst(` ${s} `)).toBe(true);
        }
    });

    it('and nothing pending or positive is', () => {
        for (const s of ['pending', 'under_review', 'revision_required', 'approved',
                         'active', 'verified', 'not_started', '', undefined, null]) {
            expect(isDecidedAgainst(s as any)).toBe(false);
        }
    });

    it('the four repaired sites all consult it rather than their own list', () => {
        const fs = require('fs');
        const path = require('path');
        for (const file of [
            'src/lib/module-access-check.ts',
            'src/app/actions/cooperative/_coop_identity.ts',
            'src/app/actions/academy/_payment.ts',
            'src/app/actions/academy/_ac_applications.ts',
            'src/infrastructure/payments/service.ts',
        ]) {
            const src = fs.readFileSync(path.join(process.cwd(), file), 'utf8');
            expect(src).toContain('isDecidedAgainst');
            expect(src).toContain('@/lib/registration-progress');
        }
    });
});
