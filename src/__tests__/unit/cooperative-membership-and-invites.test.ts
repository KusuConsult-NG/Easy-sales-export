/**
 * @jest-environment node
 */

/**
 * One invitation, two fee-free memberships — and a member directory open to
 * every account on the platform.
 *
 * THE INVITATION IS THE FEE WAIVER
 * --------------------------------
 * An admin invites an existing member by email; the link carries a 32-byte
 * token. registerCooperativeMemberAction sets
 *
 *     paymentStatus: "completed"
 *
 * from `if (inviteToken)` alone. So consuming a token IS the payment.
 *
 * The token was validated near the top of the handler and marked "used" much
 * later, by a blind `transaction.update` inside runTransaction — which takes no
 * lock on this adapter and cannot roll back. Two registrations submitted with
 * the same link both read `status: "pending"` and both wrote "used". One
 * invitation, two memberships, one fee.
 *
 * It is claimed now, before the writes, because a claim made afterwards cannot
 * refuse anything — the member is already recorded as paid by the time it runs.
 * The cost of claiming first is that a later failure burns a legitimate
 * member's link, so the failure path releases it, from "used" only.
 *
 * THE DIRECTORY WAS NOT A LIST OF NAMES
 * -------------------------------------
 * getDirectoryMembersAction guarded on `if (!session?.user)`, under a comment
 * that asked the question and never answered it — "Allow any logged in user? Or
 * just admin? Assuming members can view directory."
 *
 * /cooperatives/directory sits under a layout that calls checkModuleAccess and
 * redirects anyone without cooperative access. But that guards the PAGE. The
 * action is an exported server action, reachable directly by anyone with any
 * account, and every row it returns carries a member's phone number, passport
 * photograph URL, occupation, LGA and state.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';

const REGISTRATION = 'src/app/actions/cooperative/_coop_registration.ts';
const MEMBERSHIP = 'src/app/actions/cooperative/_coop_membership.ts';
const PAYMENT = 'src/app/actions/cooperative/_payment.ts';
const LEGACY = 'src/app/actions/admin/_legacy.ts';
const MEMBER_LAYOUT = 'src/app/cooperatives/(member)/layout.tsx';

function code(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .map((l) => l.replace(/\s\/\/.*$/, ''))
        .join('\n');
}

function fn(rel: string, name: string): string {
    const src = code(rel);
    const start = src.search(new RegExp(`(export )?(async )?function ${name}\\(`));
    expect(start).toBeGreaterThan(-1);
    const after = src.slice(start + 10);
    const end = after.search(/\n(export )?(async )?function /);
    return end > 0 ? after.slice(0, end) : after;
}

describe('an invitation really is the fee waiver', () => {
    it('because holding a token is what marks the member paid', () => {
        // THE premise. Without this the token race would be a bookkeeping issue.
        const register = fn(REGISTRATION, 'registerCooperativeMemberAction');

        expect(register).toContain('if (inviteToken) { Object.assign(updatedData, {');
        expect(register).toContain('paymentStatus: "completed"');
    });

    it('and the invite email says so in as many words', () => {
        // Raw source: the invitation body is an HTML template literal and the
        // block-comment stripper does not survive it.
        const raw = readFileSync(join(process.cwd(), LEGACY), 'utf-8');

        expect(raw).toContain('your registration fee has already been waived');
    });

    it('and nothing else about the token is checked', () => {
        // The validator tests status and nothing more — no expiry field is ever
        // written, and the recorded `email` is not compared to the caller. Both
        // are recorded for the owner rather than changed here: enforcing the
        // email binding would refuse an invited member who signed up under a
        // different address, which is a policy call, not a bug fix.
        const validate = fn(REGISTRATION, 'validateCooperativeInviteAction');

        expect(validate).toContain('data.status !== "pending"');
        // Raw source: a not.toContain against the stripped text would pass for
        // the wrong reason, since the stripper eats most of this file.
        expect(readFileSync(join(process.cwd(), LEGACY), 'utf-8')).not.toContain('expiresAt');
        expect(validate).not.toContain('email');
    });
});

describe('the invitation is claimed, not read and later written', () => {
    const register = fn(REGISTRATION, 'registerCooperativeMemberAction');

    it('through the compare-and-swap primitive', () => {
        // THE test.
        expect(register).toContain('const inviteClaim = await claimStatusTransition({');
        expect(register).toContain('collection: COLLECTIONS.COOPERATIVES_INVITES');
        expect(register).toContain('from: "pending"');
        expect(register).toContain('to: "used"');
    });

    it('refusing the registration when the claim is lost', () => {
        expect(register).toContain('if (!inviteClaim.claimed)');
        expect(register).toContain('This invitation has already been used or revoked.');
    });

    it('and no longer marks it used with a blind write', () => {
        expect(register).not.toMatch(/transaction\.update\(db\.collection\(COLLECTIONS\.COOPERATIVES_INVITES\)/);
    });

    it('before the membership is written, which is the only order that can refuse', () => {
        const claim = register.indexOf('const inviteClaim = await claimStatusTransition({');
        const write = register.indexOf('transaction.set(existingMemberRef, updatedData');

        expect(claim).toBeGreaterThan(-1);
        expect(write).toBeGreaterThan(claim);
    });
});

describe('a failed registration gives the invitation back', () => {
    const register = fn(REGISTRATION, 'registerCooperativeMemberAction');

    it('so an invited member is not locked out by a transient failure', () => {
        expect(register).toContain('let claimedInvite: string | null = null;');
        expect(register).toContain('claimedInvite = inviteToken;');
        expect(register).toContain('if (claimedInvite) {');
        expect(register).toContain('to: "pending"');
    });

    it('releasing only from "used", so another registration is not disturbed', () => {
        const release = register.slice(register.indexOf('if (claimedInvite) {'));

        expect(release).toContain('from: "used"');
        expect(release).toContain('to: "pending"');
    });

    it('and does not mask the original failure if the release itself fails', () => {
        const release = register.slice(register.indexOf('if (claimedInvite) {'));
        const catchBlock = release.slice(release.indexOf('} catch (releaseError) {'));

        expect(catchBlock).toContain('needs a new invite');
        expect(catchBlock.slice(0, catchBlock.indexOf('\n            }'))).not.toContain('throw');
    });

    it('which matters because this handler tells the member to retry', () => {
        // Vacuity guard: the transient-failure branch below advises exactly the
        // retry that a burnt token would make impossible.
        expect(register).toContain('A temporary connection issue occurred. Please try again.');
    });
});

describe('the member directory', () => {
    const directory = fn(MEMBERSHIP, '_getDirectoryMembersAction');

    it('requires cooperative access, not merely an account', () => {
        // THE test.
        expect(directory).toContain('await checkModuleAccess(');
        expect(directory).toContain('"cooperatives"');
        expect(directory).toContain('if (!hasAccess && !isAdmin(session.user.roles))');
    });

    it('refusing before it reads a single member', () => {
        const guard = directory.indexOf('if (!hasAccess && !isAdmin(session.user.roles))');
        const read = directory.indexOf('membershipsRef');

        expect(guard).toBeGreaterThan(-1);
        expect(read).toBeGreaterThan(guard);
    });

    it('and the open guard it replaced is gone', () => {
        expect(directory).not.toContain('Allow any logged in user? Or just admin?');
    });

    it('which is the same rule the page layout applies', () => {
        // Vacuity guard: the rule is the platform's own, not one invented here.
        const layout = code(MEMBER_LAYOUT);

        expect(layout).toContain('checkModuleAccess(userId, session.user.roles || [], "cooperatives")');
    });

    it('and it really does return personal data, which is why this matters', () => {
        expect(directory).toContain('phone: data.phone');
        expect(directory).toContain('data.documents?.passportPhoto?.url');
        expect(directory).toContain('occupation: data.occupation');
    });

    it('and no longer presents a truncated list as the whole membership', () => {
        expect(directory).toContain('.limit(DIRECTORY_ROW_CAP)');
        expect(directory).toContain('the directory shown is incomplete');
        expect(directory).toContain('truncated, rowCap: DIRECTORY_ROW_CAP');
    });
});

describe('the contribution audit entry', () => {
    it('records the tier the contribution actually produced', () => {
        // `newTier: result.newTier` — the transaction returns
        // { currentTotal, previousTier } and nothing else, so every entry
        // recorded undefined for the one field it exists to evidence.
        const verify = fn(PAYMENT, 'verifyContributionPaymentAction');

        expect(verify).not.toContain('newTier: result.newTier');
        expect(verify).toMatch(/previousTier: result\.previousTier,\s*\n\s*newTier,/);
    });

    it('and that value is the one read back after the increment', () => {
        // Vacuity guard: `newTier` in scope is computed from the stored total,
        // not from the pre-write arithmetic the surrounding comment warns about.
        const verify = fn(PAYMENT, 'verifyContributionPaymentAction');

        expect(verify).toContain('const newTier = calculateUserTier(newTotal);');
        expect(verify).toContain('const freshMembership = await getDoc(membershipRefOuter);');
    });
});
