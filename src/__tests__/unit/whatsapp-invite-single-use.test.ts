/**
 * @jest-environment node
 */

/**
 * The one-time invite token was one-time against a slow double-click.
 *
 * /api/whatsapp-invite redeems a token and redirects the holder into a private
 * WhatsApp group. It checks the token exists, that it has not been used, that
 * it has not expired, and that a group URL is configured — all of which is
 * right, and it does them in the right order. Then:
 *
 *     // --- 6. Atomically mark as used BEFORE redirecting ---
 *     await inviteRef.update({ used: true, usedAt: ... });
 *
 * The comment claims atomicity the code does not have. Step 2 reads the
 * document and step 6 writes it, so two requests carrying the same token both
 * read `used: false`, both pass step 3, and both are redirected. A link that
 * leaks or gets forwarded admits as many people as can load it together —
 * which is the failure the token exists to prevent.
 *
 * This is the same read-then-write shape as the withdrawal route that
 * claimStatusTransition was written for, whose own comment records two admins
 * both marking one payout complete.
 *
 * WHY claimIdempotencyKey RATHER THAN claimStatusTransition
 * ---------------------------------------------------------
 * claimStatusTransition compare-and-swaps a `status` STRING. An invite has a
 * `used` boolean and no status, so using it would mean adding a field to the
 * document — and every token already issued lacks it, so every outstanding
 * invite would stop redeeming.
 *
 * claimIdempotencyKey is an insert into a table with a unique key. Exactly one
 * concurrent caller wins, nothing about the invite document changes, and
 * tokens issued before this change work.
 *
 * WHAT DOES NOT CHANGE
 * --------------------
 * A caller that claims and then fails leaves the token spent. That was already
 * true — `used: true` was written before the redirect — so this is not a new
 * trade-off, and it is the one claimIdempotencyKey documents.
 *
 * The token itself was already sound: randomUUID, stored as the document id, a
 * seven-day expiry, and a length check before the lookup. There is nothing to
 * enumerate, which is why no rate limit was added.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';

function source(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8');
}

function codeOnly(src: string): string {
    return src
        .split('\n')
        .filter((l) => {
            const t = l.trim();
            return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
        })
        .join('\n');
}

const route = source('src/app/api/whatsapp-invite/route.ts');
const issuer = source('src/lib/whatsapp-invites.ts');

describe('redemption is claimed once', () => {
    it('claims the token through the idempotency primitive', () => {
        // THE test.
        expect(route).toContain('claimIdempotencyKey({');
        expect(route).toContain('key: `whatsapp-invite:${token}`');
    });

    it('the claim precedes the redirect', () => {
        // Ordering is the whole point: a claim after the redirect protects
        // nothing.
        const claimAt = route.indexOf('claimIdempotencyKey({');
        const redirectAt = route.indexOf('NextResponse.redirect(groupUrl)');

        expect(claimAt).toBeGreaterThan(-1);
        expect(redirectAt).toBeGreaterThan(claimAt);
    });

    it('a losing caller is sent to the used page', () => {
        expect(route).toContain('if (!claim.claimed)');
        expect(route).toContain('reason=used');
    });

    it('the key is namespaced', () => {
        // The idempotency table is shared with withdrawals and export windows.
        // A bare UUID would be a collision waiting for a coincidence.
        expect(route).toContain('`whatsapp-invite:${token}`');
        expect(route).toContain('action: "whatsapp_invite_redeem"');
    });

    it('the document is still marked used', () => {
        // Vacuity guard: dropping the write would satisfy the claim assertions
        // and leave every admin view showing unredeemed invites.
        expect(route).toContain('used: true');
        expect(route).toContain('usedAt: FieldValue.serverTimestamp()');
    });

    it('and the early `used` check is kept, correctly described', () => {
        // It is a cheap exit and honest about not being the enforcement. Tokens
        // redeemed before this change have no idempotency row, so this is what
        // still stops them.
        expect(route).toContain('invite.used === true');
        expect(route).toContain('NOT what makes redemption single-use');
    });

    it('no longer claims atomicity it does not have', () => {
        // Asserted on the replacement, not the absence of the old wording,
        // since the new comment quotes it.
        expect(route).toContain('Claim the token, once, before redirecting');
    });
});

describe('the checks that were already right', () => {
    it('rejects a missing or short token before touching the database', () => {
        const guardAt = route.indexOf('!token || token.length < 10');
        const readAt = route.indexOf('inviteRef.get()');

        expect(guardAt).toBeGreaterThan(-1);
        expect(readAt).toBeGreaterThan(guardAt);
    });

    it('checks expiry', () => {
        expect(route).toContain('new Date() > expiresAt');
        expect(route).toContain('reason=expired');
    });

    it('refuses when no group URL is configured', () => {
        // Fails closed rather than redirecting somewhere undefined.
        expect(route).toContain('if (!groupUrl)');
        expect(route).toContain('reason=unavailable');
    });

    it('the group URLs come from the environment, not the token', () => {
        // The token names a groupType and the URL is looked up locally, so a
        // forged document could not redirect a user off-site.
        expect(route).toContain('process.env.WAVE_WHATSAPP_GROUP_URL');
        expect(route).toContain('GROUP_URLS[invite.groupType as string]');
        expect(codeOnly(route)).not.toContain('invite.groupUrl');
    });

    it('the token is unguessable and expires', () => {
        expect(issuer).toContain('randomUUID()');
        expect(issuer).toContain('expiresAt');
    });
});
