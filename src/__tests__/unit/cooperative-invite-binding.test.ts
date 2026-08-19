/**
 * @jest-environment node
 */

/**
 * A forwarded invitation link admitted whoever held it, fee-free and for ever.
 *
 * A cooperative invite waives the registration fee outright —
 * registerCooperativeMember sets `paymentStatus: "completed"` from the presence
 * of a token alone. The only thing standing between a link and a free
 * membership was validateCooperativeInviteAction, and it checked one field:
 *
 *     if (data.status !== "pending") { ...refuse... }
 *
 * Two things were therefore absent.
 *
 * NO EXPIRY. The invite document is written with `email`, `token`, `status`,
 * `invitedBy`, `createdAt` and `updatedAt`. There is no expiresAt on the writer
 * or the reader, so a link from any date still worked.
 *
 * NO EMAIL BINDING. The invite records the address it was issued to, and that
 * field was compared to nothing anywhere in the codebase. Forwarding the link —
 * or finding it in a shared inbox — was enough.
 *
 * WHY THE BINDING FAILS CLOSED
 * ----------------------------
 * The password-reset revocation check in this audit fails OPEN, because a false
 * positive there signs out every user on the platform. The asymmetry runs the
 * other way here: a false refusal costs one invited member a support
 * conversation, and a false acceptance gives a membership away. So a mismatched
 * email refuses, and a MISSING recorded email refuses too — every invite this
 * platform issues writes one, so its absence means a hand-made row.
 *
 * WHY 90 DAYS IS SAFE TO PICK
 * ---------------------------
 * Rows carry no expiresAt, so an age limit has to come from createdAt, and the
 * business has never stated one. Picking a number is safe here only because the
 * email binding lands in the same change: an ageing invite can now be redeemed
 * only by the person it was issued to, so the window is a second line rather
 * than the only one. expiresAt is honoured when present.
 *
 * ONE POLICY, TWO DOORS
 * ---------------------
 * The onboarding page previews a link and registerCooperativeMember redeems it.
 * Both call the same action, and the action resolves the caller from the
 * session rather than taking it as a parameter — so the redemption path cannot
 * forget to pass it. That is the exact shape this codebase keeps getting wrong:
 * one rule, two doors, one of them missing a check.
 *
 * The preview is deliberately more permissive than the redemption. Signed out,
 * only status and age are checked, because a preview is not the fee waiver.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
    inviteRefusalReason,
    INVITE_MAX_AGE_MS,
    INVITE_MAX_AGE_DAYS,
    INVITE_USED_MESSAGE,
    INVITE_EXPIRED_MESSAGE,
    INVITE_WRONG_ACCOUNT_MESSAGE,
} from '@/lib/cooperative-invite';

const REG = 'src/app/actions/cooperative/_coop_registration.ts';
const LEGACY = 'src/app/actions/admin/_legacy.ts';

function source(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8');
}

function code(rel: string): string {
    return source(rel)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .map((l) => l.replace(/\s\/\/.*$/, ''))
        .join('\n');
}

const NOW = 1_800_000_000_000;
const FRESH = { status: 'pending', email: 'member@example.com', createdAt: NOW - 1000 };

describe('the invitation is bound to the address it was issued to', () => {
    it('the invited account may redeem it — THE test', () => {
        expect(inviteRefusalReason(FRESH, 'member@example.com', NOW)).toBeNull();
    });

    it('and anybody else may not', () => {
        expect(inviteRefusalReason(FRESH, 'someone.else@example.com', NOW))
            .toBe(INVITE_WRONG_ACCOUNT_MESSAGE);
    });

    it('matching case-insensitively and ignoring surrounding space', () => {
        // A refusal on capitalisation would strand a real member.
        expect(inviteRefusalReason(FRESH, '  MEMBER@Example.COM  ', NOW)).toBeNull();
        expect(inviteRefusalReason({ ...FRESH, email: ' Member@Example.com ' }, 'member@example.com', NOW))
            .toBeNull();
    });

    it('and refusing when the invite records no email at all', () => {
        // Fails CLOSED, unlike the session-revocation check. Every invite this
        // platform issues writes an email, so its absence is a hand-made row.
        expect(inviteRefusalReason({ status: 'pending', createdAt: NOW }, 'member@example.com', NOW))
            .toBe(INVITE_WRONG_ACCOUNT_MESSAGE);
        expect(inviteRefusalReason({ status: 'pending', email: '', createdAt: NOW }, 'member@example.com', NOW))
            .toBe(INVITE_WRONG_ACCOUNT_MESSAGE);
        expect(inviteRefusalReason({ status: 'pending', email: 42, createdAt: NOW }, 'member@example.com', NOW))
            .toBe(INVITE_WRONG_ACCOUNT_MESSAGE);
    });

    it('while a signed-out preview skips the binding', () => {
        // Deliberate: the onboarding page previews the link before anybody has
        // signed in, and a preview grants nothing.
        expect(inviteRefusalReason(FRESH, undefined, NOW)).toBeNull();
        expect(inviteRefusalReason(FRESH, null, NOW)).toBeNull();
    });
});

describe('the invitation stops working', () => {
    it('after the age window, derived from createdAt', () => {
        const old = { ...FRESH, createdAt: NOW - INVITE_MAX_AGE_MS - 1 };
        expect(inviteRefusalReason(old, 'member@example.com', NOW)).toBe(INVITE_EXPIRED_MESSAGE);
    });

    it('but not one millisecond before it', () => {
        const almost = { ...FRESH, createdAt: NOW - INVITE_MAX_AGE_MS + 1 };
        expect(inviteRefusalReason(almost, 'member@example.com', NOW)).toBeNull();
    });

    it('honouring an explicit expiresAt when the row has one', () => {
        // So setting a per-invite expiry later needs no change here.
        const withExpiry = { ...FRESH, createdAt: NOW - 1000, expiresAt: NOW - 1 };
        expect(inviteRefusalReason(withExpiry, 'member@example.com', NOW)).toBe(INVITE_EXPIRED_MESSAGE);

        const notYet = { ...FRESH, createdAt: NOW - 1000, expiresAt: NOW + 1 };
        expect(inviteRefusalReason(notYet, 'member@example.com', NOW)).toBeNull();
    });

    it('an explicit expiresAt overriding the derived window in BOTH directions', () => {
        // An ancient invite with a future expiresAt is still good...
        const ancientButExtended = {
            ...FRESH,
            createdAt: NOW - INVITE_MAX_AGE_MS * 10,
            expiresAt: NOW + 60_000,
        };
        expect(inviteRefusalReason(ancientButExtended, 'member@example.com', NOW)).toBeNull();

        // ...and a fresh one with a past expiresAt is not.
        const freshButRevoked = { ...FRESH, createdAt: NOW, expiresAt: NOW - 1 };
        expect(inviteRefusalReason(freshButRevoked, 'member@example.com', NOW)).toBe(INVITE_EXPIRED_MESSAGE);
    });

    it('and an unreadable createdAt is treated as ageless, not as epoch', () => {
        // toMillis returns 0 for shapes it cannot read, and 0 would expire every
        // such invite at once — a silent mass revocation.
        for (const createdAt of [undefined, null, 'not a date', {}]) {
            expect(inviteRefusalReason({ ...FRESH, createdAt }, 'member@example.com', NOW)).toBeNull();
        }
    });

    it('the window being a stated number of days, not a magic constant', () => {
        expect(INVITE_MAX_AGE_DAYS).toBe(90);
        expect(INVITE_MAX_AGE_MS).toBe(90 * 24 * 60 * 60 * 1000);
    });
});

describe('the checks it already had are unchanged', () => {
    it.each([['used'], ['revoked'], ['expired'], [undefined]])(
        'a %s invite is refused',
        (status) => {
            expect(inviteRefusalReason({ ...FRESH, status }, 'member@example.com', NOW))
                .toBe(INVITE_USED_MESSAGE);
        },
    );

    it('and a missing invite document too', () => {
        expect(inviteRefusalReason(null, 'member@example.com', NOW)).toBe(INVITE_USED_MESSAGE);
        expect(inviteRefusalReason(undefined, 'member@example.com', NOW)).toBe(INVITE_USED_MESSAGE);
    });

    it('status being checked before age, so a used invite reads as used', () => {
        const usedAndOld = { ...FRESH, status: 'used', createdAt: NOW - INVITE_MAX_AGE_MS - 1 };
        expect(inviteRefusalReason(usedAndOld, 'member@example.com', NOW)).toBe(INVITE_USED_MESSAGE);
    });
});

describe('one policy, and both doors ask it', () => {
    const reg = code(REG);

    it('the validating action calls the shared rule', () => {
        expect(reg).toContain('const refusal = inviteRefusalReason(data, callerEmail);');
        expect(reg).toContain('from "@/lib/cooperative-invite"');
    });

    it('resolving the caller from the session rather than a parameter', () => {
        // THE structural point. A parameter is something the redemption path
        // can forget to pass; a session lookup is not.
        expect(reg).toContain('const previewSession = await requireSession();');
        expect(reg).toContain('const callerEmail = previewSession.session?.user?.email ?? undefined;');
    });

    it('and the redemption path goes through that same action', () => {
        // Vacuity guard on "both doors": if registration validated the token
        // itself, the binding would cover the preview only.
        expect(reg).toContain('const inviteRes = await validateCooperativeInviteAction(inviteToken);');
        const validateAt = reg.indexOf('const inviteRes = await validateCooperativeInviteAction(inviteToken);');
        const claimAt = reg.indexOf('const inviteClaim = await claimStatusTransition({');

        expect(validateAt).toBeGreaterThan(-1);
        expect(claimAt).toBeGreaterThan(validateAt);
    });

    it('the old status-only check being gone', () => {
        expect(reg).not.toContain('if (data.status !== "pending") { return { success: false as const, error: "This invitation has already been used or revoked."');
    });

    it('and a refused forward is logged, not silently dropped', () => {
        expect(reg).toContain('the link was issued to a different address');
    });
});

describe('what the invite actually buys, and who can issue one', () => {
    it('a token waives the registration fee, which is why any of this matters', () => {
        // Vacuity guard on the whole file: if an invite granted nothing, a
        // forwarded link would be harmless.
        expect(code(REG)).toContain('paymentStatus');
        expect(source(REG)).toContain('an invite is\n            // what waives the ₦ registration fee');
    });

    it('and the only issuer is deprecated, so nothing new can be minted', () => {
        // Recorded rather than assumed: a member refused by the binding cannot
        // be sent a replacement link, and registers and pays instead.
        // Restoring the issuer is separate work.
        expect(code(LEGACY)).toContain('return { error: "Method deprecated", success: false as const, data: null };');
        expect(source('src/lib/cooperative-invite.ts')).toContain('Restoring the issuer is separate work.');
    });
});
