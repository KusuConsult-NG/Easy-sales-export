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
describe('#973 — the gate is GONE, and a signed-in non-member can buy land', () => {
    /**
     *   THIS SUITE USED TO ASSERT THE OPPOSITE, AND THE OWNER OVERRULED IT.
     *
     *   "there is a gate that tells them they are not part of cooperative which
     *   is not supposed to be so."
     *
     *   #815's three describes here — the refusal, the fail-closed read, and a
     *   member getting past — were all correct about the SHAPE of a purchase
     *   gate and wrong about whether this one should exist. They are replaced
     *   rather than deleted so the rule cannot come back by accident: every test
     *   below fails if anybody reinstates a cooperative check on this path.
     *
     *   app/actions/farm-nation-payment.ts records where the rule came from — a
     *   February 2026 audit commit's `tier !== "Premium"`, a tier this platform
     *   deleted — and why nothing replaces it.
     */
    it('THE test: A NON-MEMBER IS NOT REFUSED FOR NOT BEING A MEMBER', async () => {
        //   The lookup is still mocked, and answers "not a member". Whatever
        //   this purchase does next, it must not be refused for that.
        cooperativeTierForPerson.mockResolvedValue(null);

        const res = await buy();

        expect(res.error ?? '').not.toMatch(/cooperative/i);
        expect(res.error ?? '').not.toMatch(/sold to cooperative members|join the cooperative/i);
    });

    it('AND THE ACTION DOES NOT ASK ABOUT COOPERATIVE MEMBERSHIP AT ALL', async () => {
        /*
         *   Stronger than checking the message, and the assertion that would
         *   catch a reinstated gate that worded its refusal differently: the
         *   person-aware cooperative lookup is never called on this path.
         */
        cooperativeTierForPerson.mockResolvedValue(null);

        await buy();

        expect(cooperativeTierForPerson).not.toHaveBeenCalled();
    });

    it('AND A MEMBERSHIP THAT CANNOT BE READ CANNOT BLOCK A PURCHASE EITHER', async () => {
        //   #815 made the read fail CLOSED, which was right while the rule
        //   existed: on the path that charges a card, an unreadable membership
        //   had to refuse. With no rule there is nothing to fail closed about,
        //   and a cooperative outage must not stop land sales.
        cooperativeTierForPerson.mockRejectedValue(new Error('supabase down'));

        const res = await buy();

        expect(res.error ?? '').not.toMatch(/could not confirm your cooperative membership/i);
    });

    it('AND THE SOURCE CARRIES NO COOPERATIVE READ', () => {
        //   The behaviour tests above go through mocks. This one reads the file,
        //   so a gate added with a different helper is still caught.
        const src = readFileSync(
            join(process.cwd(), 'src/app/actions/farm-nation-payment.ts'), 'utf8');
        const code = stripComments(src, { label: 'farm-nation-payment' });

        expect(code).not.toMatch(/cooperativeTierForPerson/);
        expect(code).not.toMatch(/COOPERATIVE_MEMBERS/);
        expect(code).not.toMatch(/serviceRegistrations/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#815 — one rule, so the two sides cannot disagree', () => {
    const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

    /*
     *   #973 "BOTH THE SCREEN AND THE ACTION GO THROUGH THE PERSON-AWARE
     *   LOOKUP" was here. Neither does any more — the screen and the action
     *   both stopped asking. The #816 assertions below are about
     *   lib/cooperative-member-lookup itself and are untouched by that: they
     *   are the reason the cooperative's OWN doors do not mistake a person for
     *   a stranger, and the cooperative still has those doors.
     */
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
