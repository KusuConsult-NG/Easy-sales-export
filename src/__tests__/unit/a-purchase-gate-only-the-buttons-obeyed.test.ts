/**
 * @jest-environment node
 */

/**
 *   #815 THE PURCHASE GATE LIVED IN THE SCREEN, AND THE SCREEN IS NOT WHERE
 *        THE MONEY IS TAKEN.
 *
 *        Farm Nation land is sold to cooperative members. The whole of that
 *        rule was this, in CheckoutClient:
 *
 *            getUserTierAction().then((res) => {
 *                if (tier !== "Member") router.push(property page);
 *            });
 *
 *        `initializePropertyPaymentAction` — the action that prices the
 *        property, creates the escrow and opens the Paystack charge — checked
 *        NOTHING. Zero occurrences of tier, Member or cooperative in the file.
 *
 *        A SERVER ACTION IS A PUBLIC HTTP ENDPOINT. A gate drawn only in the
 *        client stops the buyer who uses the buttons and nobody else, which is
 *        the same finding as #812's `maxLength={1000}` one layer further in:
 *        the rule was real, the enforcement was decoration.
 *
 *        This action already carries the scar of the same shape. Its own
 *        comment: "`amount` is a caller-supplied parameter and the only check
 *        on it was `< 10000` … Anyone could buy any verified property for
 *        ₦10,000."
 *
 * ── AND THE LOOKUP WAS IDENTITY-BLIND, WHICH MADE ENFORCING IT DANGEROUS ────
 *
 *   `getUserTierAction` read `findCooperativeMemberRow`, which takes the id it
 *   is handed and stops. A member whose membership row sits under a profile
 *   they no longer sign in as read as a NON-member — no tier and no
 *   contributions on their own dashboard.
 *
 *   Enforcing that on the server would have turned a wrong screen into a real
 *   lockout: a paying member refused at the point of buying land. Both sides go
 *   through `cooperativeTierForPerson` now, which walks every profile the
 *   person owns.
 *
 *   MUTATION-TESTED, WITH CONTROLS — table at the foot of this file.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { stripComments } from '@/lib/testing/strip-comments';
import { join } from 'node:path';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null, setCache: async () => undefined,
    deleteCache: async () => undefined, deleteCachePattern: async () => undefined, redis: null,
}));

const requireSession = jest.fn<any>();
jest.mock('@/lib/session-guard', () => ({ requireSession: (...a: any[]) => requireSession(...a) }));

const cooperativeTierForPerson = jest.fn<any>();
jest.mock('@/lib/cooperative-member-lookup', () => ({
    cooperativeTierForPerson: (...a: any[]) => cooperativeTierForPerson(...a),
    findCooperativeMemberRow: jest.fn(async () => null),
    findCooperativeMemberRowForPerson: jest.fn(async () => null),
    membershipRefForPayment: jest.fn(async () => null),
}));

//   The real parameter list, not a shortened one. The first version of this
//   helper passed three arguments and jest ran it happily — JavaScript does not
//   mind — while `tsc` did: "Expected 5-7 arguments, but got 3". A test that
//   calls the action with the wrong shape is not exercising the action.
const BUYER = {
    fullName: 'Ada Okonkwo',
    email: 'ada@example.com',
    phone: '08011111111',
    purpose: 'Maize',
    zoningComplianceDeclarationAccepted: true,
};

const buy = async () => {
    const { initializePropertyPaymentAction } =
        await import('@/app/actions/farm-nation-payment');
    return await initializePropertyPaymentAction(
        'plot-1', 'E2E Farmland Plot 1', 6_250_000, 'seller-1', BUYER,
    ) as any;
};

beforeEach(() => {
    jest.clearAllMocks();
    requireSession.mockResolvedValue({ session: { user: { id: 'buyer-1', email: 'ada@example.com' } } });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#815 — the server refuses a non-member', () => {
    it('A NON-MEMBER CANNOT START A PURCHASE — the defect', async () => {
        //   THE test. Before this, the action ran straight through to pricing
        //   the property and opening a charge.
        cooperativeTierForPerson.mockResolvedValue(null);

        const res = await buy();

        expect(res.success).toBe(false);
        expect(res.error).toMatch(/sold to cooperative members/i);
    });

    it('AND IS TOLD WHAT WOULD LET THEM', async () => {
        cooperativeTierForPerson.mockResolvedValue(null);

        const res = await buy();

        expect(res.error).toMatch(/join the cooperative/i);
    });

    it('AND THE CHECK RUNS BEFORE THE PROPERTY IS EVEN READ', async () => {
        //   An eligibility rule about the CALLER. There is no reason to read a
        //   property, price it or resolve an offer for somebody who may not buy
        //   it — and a refusal that happens after those reads is a refusal that
        //   costs them.
        cooperativeTierForPerson.mockResolvedValue(null);

        await buy();

        expect(cooperativeTierForPerson).toHaveBeenCalledWith(
            expect.anything(), 'buyer-1',
        );
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#815 — a membership that cannot be read is not a membership', () => {
    it('IT FAILS CLOSED, because this is the path that charges a card', async () => {
        cooperativeTierForPerson.mockRejectedValue(new Error('statement timeout'));

        const res = await buy();

        expect(res.success).toBe(false);
        expect(res.error).toMatch(/could not confirm your cooperative membership/i);
    });

    it('AND SAYS NOTHING WAS CHARGED, which is what they will worry about', async () => {
        cooperativeTierForPerson.mockRejectedValue(new Error('statement timeout'));

        const res = await buy();

        expect(res.error).toMatch(/nothing has been charged/i);
    });

    it('and it is told apart from simply not being a member', async () => {
        //   Two different situations. Telling a paying member to go and join
        //   would be its own defect.
        cooperativeTierForPerson.mockRejectedValue(new Error('down'));

        const res = await buy();

        expect(res.error).not.toMatch(/join the cooperative/i);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#815 — and a member is not blocked', () => {
    it('POSITIVE CONTROL: A MEMBER GETS PAST THE MEMBERSHIP GATE', async () => {
        //   The direction that must not move. A gate that refused everybody
        //   would pass every assertion above and close Farm Nation sales.
        //
        //   It is asserted by what the action does NEXT: with no database
        //   behind it the call fails later, on the property read — which is
        //   proof it got past the gate, and is why the message is checked
        //   rather than only `success`.
        cooperativeTierForPerson.mockResolvedValue('Member');

        const res = await buy();

        expect(res.error ?? '').not.toMatch(/sold to cooperative members/i);
        expect(res.error ?? '').not.toMatch(/could not confirm your cooperative membership/i);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#815 — one rule, so the two sides cannot disagree', () => {
    const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

    it('BOTH THE SCREEN AND THE ACTION GO THROUGH THE PERSON-AWARE LOOKUP', () => {
        expect(read('src/app/actions/farm-nation-payment.ts'))
            .toContain('cooperativeTierForPerson(');
        expect(read('src/app/actions/cooperative/_coop_membership.ts'))
            .toContain('findCooperativeMemberRowForPerson(');
    });

    it('AND THE TIER ACTION NO LONGER READS ONLY THE SESSION ID', () => {
        /*
         *   Scoped to _getUserTierAction'S OWN BODY, because this file holds
         *   THREE member lookups and the first version of this assertion
         *   matched the wrong one — `indexOf('const memberRow = await')` finds
         *   _getMembershipAction, forty lines earlier, and reported a fix that
         *   had in fact landed as missing.
         *
         *   The other two — _getMembershipAction and _checkCooperativeStatusAction
         *   — had the same blindness and are fixed too (#816), which the next
         *   test pins.
         */
        const src = read('src/app/actions/cooperative/_coop_membership.ts');
        const at = src.indexOf('async function _getUserTierAction');
        expect(at).toBeGreaterThan(-1);

        const body = src.slice(at, src.indexOf('export const getUserTierAction', at));
        expect(body).toContain('findCooperativeMemberRowForPerson(');
        expect(body).not.toContain('await findCooperativeMemberRow(');
    });

    it('AND NO READER IN THAT FILE STILL STOPS AT THE SESSION ID — #816', () => {
        /*
         *   THREE readers, not one. This file held _getMembershipAction,
         *   _getUserTierAction and _checkCooperativeStatusAction, all reading
         *   `findCooperativeMemberRow` — the id they are handed, and no
         *   further. A member whose row sits under a profile they no longer
         *   sign in as was invisible to all three: no membership, no tier, no
         *   status.
         *
         *   Asserted on the CODE with comments stripped, because every one of
         *   those three now has a comment that mentions the old function by
         *   name and would otherwise match.
         */
        const src = stripComments(read('src/app/actions/cooperative/_coop_membership.ts'),
            { label: '_coop_membership.ts' });

        expect(src).not.toMatch(/await findCooperativeMemberRow\(/);
        expect((src.match(/findCooperativeMemberRowForPerson\(/g) ?? []).length)
            .toBeGreaterThanOrEqual(3);
    });

    it('AND THE EMAIL CLAIM STEP IS STILL BEHIND ITS OWN GUARD', () => {
        //   The person-aware walk resolves OWNED PROFILE IDS and matches no
        //   address, so the claim path is untouched — reached less often, since
        //   a row under the member's other profile is now found first, but not
        //   removed and not widened.
        //   The GUARD, not the string. The first version asserted that
        //   `session.user.email` appeared somewhere in the file — which it does
        //   inside the block too, so a mutant that replaced the condition with
        //   `if (false)` survived. It is the branch being reachable that
        //   matters.
        const src = stripComments(read('src/app/actions/cooperative/_coop_membership.ts'),
            { label: '_coop_membership.ts' });

        expect(src).toContain('if (session.user.email) {');
    });

    it('POSITIVE CONTROL: the files really are being read', () => {
        expect(read('src/app/actions/farm-nation-payment.ts').length).toBeGreaterThan(1000);
    });
});

/*
 * ── MUTATION TABLE ──────────────────────────────────────────────────────────
 *
 *   Applied to src/app/actions/farm-nation-payment.ts and
 *   src/app/actions/cooperative/_coop_membership.ts, this suite re-run each
 *   time.
 *
 *   MUTANT                                    DEAD  FIRST TO FAIL
 *   ───────────────────────────────────────── ────  ──────────────────────────
 *   remove the membership gate — the defect     2   "A NON-MEMBER CANNOT START
 *                                                   A PURCHASE"
 *
 *   the gate fails OPEN on a read error         2   "IT FAILS CLOSED"
 *
 *   `tier !== "Member"` becomes `=== "Member"`  3   "A NON-MEMBER CANNOT START
 *   (refuses members instead)                       A PURCHASE"
 *
 *   the tier action goes back to the            2   "BOTH THE SCREEN AND THE
 *   identity-blind findCooperativeMemberRow         ACTION GO THROUGH THE
 *                                                   PERSON-AWARE LOOKUP"
 *
 *   _getMembershipAction reverts to the           1   "AND NO READER IN THAT FILE
 *   identity-blind lookup (#816)                    STILL STOPS AT THE
 *                                                   SESSION ID"
 *
 *   _checkCooperativeStatusAction reverts         2   same
 *
 *   the email claim step is removed               1   "AND THE EMAIL CLAIM STEP
 *   entirely                                          IS STILL BEHIND ITS OWN
 *                                                     GUARD"
 *
 *   CONTROL — SHOULD SURVIVE
 *   reword the #815 comment above the gate      0   SURVIVED ✓
 *
 *   THE EMAIL MUTANT SURVIVED THE FIRST RUN, and the reason is the usual one:
 *   the assertion looked for the STRING `session.user.email`, which still
 *   appears inside the block, so replacing the condition with `if (false)`
 *   changed nothing it could see. It pins the guard itself now.
 *
 *   The client-side half is mutation-tested in the-refusal-that-said-nothing:
 *   restoring the silent push, letting a failed read reach the form, and giving
 *   both blocks one message kill 4, 4 and 3.
 */
