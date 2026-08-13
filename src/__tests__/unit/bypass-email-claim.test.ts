/**
 * @jest-environment node
 */

/**
 * The payment bypass was safe for a reason that stopped being true.
 *
 * src/lib/payment-bypass.ts consolidated an address that had been hard-coded in
 * seventeen places, and recorded why it was not a vulnerability:
 *
 *     - there is no self-service action that changes a user's email
 *     - registration rejects a duplicate via adminAuth.getUserByEmail
 *     - /api/auth/register returns 404 in production anyway
 *
 * The first is no longer the case. updateProfileAction takes an email in its
 * schema and calls syncAuthEmail, so a user can change their own address. That
 * action was added after the reasoning was written.
 *
 * WHAT ACTUALLY STOPPED IT, AND WHY THAT IS NOT ENOUGH
 * ----------------------------------------------------
 * The default address is held by the owner's account, so
 * supabaseAdmin.auth.admin.updateUserById rejects the change as a duplicate and
 * profile.ts reports "already in use by another account". Real protection —
 * and conditional on something nobody wrote down.
 *
 * Nothing requires an address on PAYMENT_BYPASS_EMAILS to correspond to a
 * registered account. Add a colleague's address before they sign up, or mistype
 * one, and any user could claim it by editing their profile — and with it free
 * cooperative and academy membership, since isPaymentBypassAccount grants
 * paymentStatus "completed" and a fully approved membership through
 * autoProvisionZereCooperative.
 *
 * So the change is refused outright, which does not depend on who holds the
 * address.
 *
 * WHAT THIS IS NOT
 * ----------------
 * Not a claim that the bypass is currently exploitable. It is not: the default
 * address is registered. It is a claim that the recorded reason no longer
 * explains why, and that the reason which replaced it has a gap the original
 * did not.
 *
 * That is the second stale premise found in this audit — after
 * kyc-self-assertion.test.ts's "No QoreID call exists in the repository" — and
 * both were load-bearing. A recorded reason for leaving something alone needs
 * re-reading when the code around it changes.
 */

import { describe, it, expect, beforeEach, afterAll } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { isPaymentBypassAccount } from '@/lib/payment-bypass';

/**
 * A stand-in address, set through the environment variable.
 *
 * The real default is deliberately NOT written here: payment-bypass.test.ts
 * ratchets on that literal appearing anywhere outside the module that owns it,
 * and it was right to fire on the first draft of this file. Configuring the
 * list is also a better test of the behaviour than asserting one hard-coded
 * value.
 */
const BYPASS = 'bypass-fixture@example.test';

function source(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8');
}

const profile = source('src/app/actions/profile.ts');
const bypass = source('src/lib/payment-bypass.ts');

const ORIGINAL_LIST = process.env.PAYMENT_BYPASS_EMAILS;

beforeEach(() => {
    process.env.PAYMENT_BYPASS_EMAILS = BYPASS;
});

afterAll(() => {
    if (ORIGINAL_LIST === undefined) delete process.env.PAYMENT_BYPASS_EMAILS;
    else process.env.PAYMENT_BYPASS_EMAILS = ORIGINAL_LIST;
});

describe('a profile edit cannot move a user onto the bypass list', () => {
    it('the change is refused', () => {
        // THE test.
        expect(profile).toContain('isPaymentBypassAccount(validated.email)');
    });

    it('refused before the auth store is touched', () => {
        // Ordering: refusing after syncAuthEmail has run would already have
        // moved the address in Supabase.
        const refuseAt = profile.indexOf('isPaymentBypassAccount(validated.email)');
        const syncAt = profile.indexOf('syncAuthEmail(userId, validated.email)');

        expect(refuseAt).toBeGreaterThan(-1);
        expect(syncAt).toBeGreaterThan(refuseAt);
    });

    it('says the same thing as a genuine collision', () => {
        // The bypass list is not something to disclose through an error
        // message. "Already in use" is true of the default address anyway.
        expect(profile).toContain('That email address is already in use by another account.');
    });

    it('the attempt is logged', () => {
        expect(profile).toContain('refused an email change onto the payment-bypass list');
    });

    it('an ordinary email change is still allowed', () => {
        // Vacuity guard: refusing every change satisfies the assertions above
        // and removes a feature people use.
        expect(profile).toContain('const sync = await syncAuthEmail(userId, validated.email)');
        expect(isPaymentBypassAccount('someone@example.com')).toBe(false);
    });

    it('the check is case-insensitive, like the bypass itself', () => {
        // The original comparisons were exact-match and the consolidation fixed
        // that; the refusal has to match the same way or it is trivially
        // sidestepped.
        expect(isPaymentBypassAccount(BYPASS.toUpperCase())).toBe(true);
        expect(isPaymentBypassAccount(`  ${BYPASS}  `)).toBe(true);
    });
});

describe('the self-service email change that invalidated the premise', () => {
    it('exists', () => {
        expect(profile).toContain('email: strictEmailSchema.optional()');
        expect(profile).toContain('syncAuthEmail');
    });

    it('still rejects a duplicate', () => {
        // The protection that actually held, recorded so its role is clear.
        expect(profile).toContain('/already|exists|registered/i.test(message)');
    });

    it('fails closed when the duplicate wording changes', () => {
        // If Supabase reworded its error, primaryRevoked is still false and the
        // change is refused with a generic message rather than allowed.
        expect(profile).toContain('if (!sync.primaryRevoked)');
        expect(profile).toContain('Failed to update email');
    });
});

describe('the record says what is true now', () => {
    it('the stale reason is corrected where it was written', () => {
        // Asserted on the correction rather than the absence of the old claim —
        // the corrected passage quotes it, which is the trap that has caught
        // seven assertions in this audit.
        expect(bypass).toContain('The first is no longer the case');
        expect(bypass).toContain('updateProfileAction accepts an email');
    });

    it('and names the gap that replaced it', () => {
        expect(bypass).toContain('Nothing requires an address on this list to belong to a');
    });

    it('the bypass still does what it did', () => {
        // Vacuity guard: this change must not have quietly disabled the owner
        // account's bypass.
        expect(isPaymentBypassAccount(BYPASS)).toBe(true);
        expect(isPaymentBypassAccount(null)).toBe(false);
        expect(isPaymentBypassAccount('')).toBe(false);
    });

    it('and can still be switched off with an environment variable', () => {
        expect(bypass).toContain('PAYMENT_BYPASS_EMAILS');
    });
});

describe('what the bypass grants, which is why the address matters', () => {
    it('a fully approved, fully paid cooperative membership', () => {
        const coop = source('src/app/actions/cooperative/_actions.ts');

        expect(coop).toContain('if (!isPaymentBypassAccount(email)) return');
        expect(coop).toContain('membershipStatus: "approved"');
        expect(coop).toContain('paymentStatus: "completed"');
        expect(coop).toContain('onboardingCompleted: true');
    });

    it('and it is consulted elsewhere too', () => {
        // So the address is worth more than one module's fees.
        expect(source('src/app/actions/academy/_actions.ts')).toContain('isPaymentBypassAccount');
    });
});
