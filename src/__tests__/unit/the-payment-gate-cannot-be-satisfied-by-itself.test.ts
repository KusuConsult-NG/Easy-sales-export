/**
 * @jest-environment node
 */

/**
 *   #496 THE PAYMENT GATE WAS SATISFIED BY AN ACTIVATION THE SAME FUNCTION
 *        WROTE SIXTY LINES ABOVE IT.
 *
 *   getCooperativeMemberIdCardAction issues the cooperative ID card behind two
 *   gates. Gate 1 read:
 *
 *       if (!effectivePaymentCompleted && !isLegacy && !isApprovedOrActive) {
 *           return { error: "Your membership fee payment has not been verified…" };
 *       }
 *
 *   so being approved skipped the payment check. And `isApprovedOrActive` is not
 *   something the function is given — it MAKES it, at the heal above:
 *
 *       if (!isApprovedOrActive && (isCentralActive || (paid && onboarded))) {
 *           isApprovedOrActive = true;
 *           await healRef.set({ membershipStatus: "active", … }, { merge: true });
 *           await usersRef.set({ serviceRegistrations: {
 *               cooperatives: { status: "active" } } }, { merge: true });
 *       }
 *
 *   Read the `||`. The second branch requires payment. THE FIRST REQUIRES ONLY
 *   THAT THE USER DOCUMENT ALREADY SAYS "active" — no payment, anywhere. So an
 *   unpaid member reached the heal, was written `membershipStatus: "active"`,
 *   and that write then satisfied the payment gate. A check whose precondition
 *   the same call manufactures cannot fail.
 *
 *   AND IT COULD NOT STOP. The heal also writes
 *   `serviceRegistrations.cooperatives.status: "active"` onto the user document,
 *   which IS `isCentralActive` on every later call. One firing made it
 *   permanent.
 *
 *   THE COMMENT ABOVE IT HAD ALREADY MET THIS SHAPE. "A SUSPENSION WAS UNDONE BY
 *   OPENING THE ID CARD" — someone closed the suspension direction with
 *   `decidedAgainst` and left the payment direction open. Same heal, same
 *   read-only screen writing a decision, one of two directions fixed. #486's
 *   class again: the repair reached one of N doors.
 *
 * ── MEASURED BEFORE THE GATE MOVED ──────────────────────────────────────────
 *
 *   Changing a gate that controls whether real members can see their ID card is
 *   not something to do on a hunch, so the blast radius was counted on
 *   production first:
 *
 *       active with payment not completed                 77
 *         ...legacy, exempt by design and still exempt     74
 *         ...non-legacy                                     3
 *           ...with a real payment in processed_payments     1   (now found)
 *           ...with no payment anywhere                      2   (now refused)
 *
 *   TWO PEOPLE lose a card they were being issued, and for those two there is no
 *   record of the ₦10,000 in any table. That is the gate doing its job.
 *
 * ── WHAT IS DELIBERATELY LEFT ───────────────────────────────────────────────
 *
 *   `isLegacy` still bypasses payment. Those members joined before this platform
 *   charged anything, and 74 of the 77 are them; removing that exemption would
 *   lock out the entire pre-platform membership to catch nobody.
 *
 *   AND APPROVAL STILL SATISFIES GATE 2, untouched. The fix is not "approval
 *   counts for less" — it is that approval and payment are two different
 *   sentences and only one of them is about money.
 *
 *   RECORDED, NOT FIXED: checkModuleAccess Layer 2 grants the cooperative module
 *   on `membershipStatus` alone, so the heal's write still opens the module for
 *   an unpaid member even now the card is gated. Same defect, a different door.
 *   It needs its own measurement before its own gate moves, and inventing one
 *   here would be the thing this audit keeps catching.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the approval bypass restored on Gate 1         KILLED — by the RENDERED
 *                                                    refusal, not only by the
 *                                                    source assertion
 *     reword this header                             SURVIVED, as intended
 *
 *   The behavioural kill is the one that counts. Every source ratchet in this
 *   file could be satisfied by a name while the gate stayed open — #486, #490
 *   and #493 each proved that in turn — so the first assertion executes the
 *   action against a seeded database and reads what it answers.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { stripComments } from '@/lib/testing/strip-comments';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null,
    setCache: async () => undefined,
    deleteCache: async () => undefined,
    redis: null,
}));

jest.mock('next/cache', () => ({
    revalidatePath: jest.fn(),
    revalidateTag: jest.fn(),
    unstable_cache: (fn: unknown) => fn,
}));

const code = (rel: string) => stripComments(readFileSync(rel, 'utf-8'), { label: rel });

let store: FakeDbHandle;

const MEMBER = 'member-1';
const MEMBERS = COLLECTIONS.COOPERATIVE_MEMBERS;
const PAYMENTS = COLLECTIONS.PROCESSED_PAYMENTS;

function actAs(id: string | null): void {
    (globalThis as {
        mockRequireSession: { mockImplementation: (f: () => unknown) => void };
    }).mockRequireSession.mockImplementation(() => Promise.resolve(
        id === null
            ? { session: null, error: { error: 'Not authenticated' } }
            : { session: { user: { id, roles: ['user'], email: 'ada@example.com', name: 'Ada Obi' } }, error: null },
    ));
}

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    actAs(MEMBER);
});

const card = async () =>
    (await (await import('@/app/actions/cooperative/_coop_identity')).getCooperativeMemberIdCardAction()) as any;

/** A user whose CENTRAL registration says active — the branch that needed nothing. */
function seedCentrallyActiveUser(extra: Record<string, unknown> = {}): void {
    store.seed(COLLECTIONS.USERS, MEMBER, {
        email: 'ada@example.com',
        fullName: 'Ada Obi',
        firstName: 'Ada',
        lastName: 'Obi',
        roles: ['user', 'cooperative_member'],
        serviceRegistrations: { cooperatives: { status: 'active' } },
        ...extra,
    });
}

function seedMembership(extra: Record<string, unknown> = {}, id = 'coop-1'): void {
    store.seed(MEMBERS, id, {
        userId: MEMBER,
        email: 'ada@example.com',
        firstName: 'Ada',
        lastName: 'Obi',
        gender: 'female',
        stateOfOrigin: 'Plateau',
        membershipStatus: 'pending',
        paymentStatus: 'pending',
        createdAt: '2025-03-04T00:00:00.000Z',
        ...extra,
    });
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#496 — approval is not a payment', () => {
    it('AN UNPAID MEMBER IS REFUSED THE CARD, EVEN WHEN CENTRALLY ACTIVE', async () => {
        //   THE test. Central status "active" was enough to manufacture
        //   `isApprovedOrActive`, which was enough to skip Gate 1 entirely.
        //   There is no payment in any collection here.
        seedCentrallyActiveUser();
        seedMembership();

        expect(await card()).toMatchObject({
            success: false,
            reason: 'payment_required',
        });
    });

    it('AND A REAL PAYMENT STILL OPENS IT — from processed_payments', async () => {
        //   The control that matters most, and the reason the fallback's own
        //   `!isApprovedOrActive` guard had to go with it: an approved member
        //   never had processed_payments consulted, because the approval
        //   bypassed the gate and nobody bothered to look. One of the three
        //   non-legacy members on production is exactly this case.
        seedCentrallyActiveUser();
        seedMembership();
        store.seed(PAYMENTS, 'pay-1', {
            userId: MEMBER,
            type: 'cooperative_membership_registration',
            status: 'completed',
            amount: 10000,
        });

        expect((await card()).success).toBe(true);
    });

    it('AND THE STALE FIELD IS HEALED SO THE LOOKUP IS NOT REPEATED', async () => {
        seedCentrallyActiveUser();
        seedMembership();
        store.seed(PAYMENTS, 'pay-1', {
            userId: MEMBER,
            type: 'cooperative_membership_registration',
            status: 'completed',
        });

        await card();

        expect(store.get(MEMBERS, 'coop-1')!.paymentStatus).toBe('completed');
    });

    it('AND A LEGACY MEMBER IS STILL EXEMPT', async () => {
        //   74 of the 77 active-unpaid members are these. They joined before the
        //   platform charged anything; removing the exemption locks out the
        //   entire pre-platform membership to catch nobody.
        seedCentrallyActiveUser();
        seedMembership({ isLegacy: true, membershipStatus: 'active' });

        expect((await card()).success).toBe(true);
    });

    it('AND AN ORDINARY PAID MEMBER IS UNAFFECTED', async () => {
        //   The vacuity guard. A change that refused everybody would satisfy
        //   every assertion above except this one.
        seedCentrallyActiveUser();
        seedMembership({ membershipStatus: 'active', paymentStatus: 'completed' });

        expect((await card()).success).toBe(true);
    });

    it('and a member who paid but is not yet approved is still told THAT', async () => {
        //   Gate 2 is untouched. The two gates must keep giving two different
        //   answers, or "pay us" starts being shown to people who have paid.
        store.seed(COLLECTIONS.USERS, MEMBER, {
            email: 'ada@example.com', fullName: 'Ada Obi', roles: ['user'],
        });
        seedMembership({ paymentStatus: 'completed' });

        expect(await card()).toMatchObject({
            success: false,
            reason: 'pending_approval',
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#496 — the gate no longer reads what the heal wrote', () => {
    it('GATE 1 ASKS ABOUT PAYMENT AND LEGACY STATUS ONLY', () => {
        //   Pins the CONDITION, not a name. An assertion that the file mentions
        //   `effectivePaymentCompleted` is satisfied by the declaration while the
        //   guard still carries the bypass — the trap #486, #490 and #493 each
        //   hit in turn.
        const body = code('src/app/actions/cooperative/_coop_identity.ts');

        expect(body).toContain('if (!effectivePaymentCompleted && !isLegacy) {');
        expect(body).not.toContain('!effectivePaymentCompleted && !isLegacy && !isApprovedOrActive');
    });

    it('AND GATE 2 STILL ASKS ABOUT APPROVAL', () => {
        //   The other half of the decomposition, asserted so that "separate the
        //   claims" cannot quietly become "drop one of them".
        const body = code('src/app/actions/cooperative/_coop_identity.ts');

        expect(body).toContain('if (!isApprovedOrActive) {');
        expect(body).toContain('pending_approval');
    });
});
