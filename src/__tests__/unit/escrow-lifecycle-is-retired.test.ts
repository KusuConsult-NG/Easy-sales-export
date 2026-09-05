/**
 * @jest-environment node
 */

/**
 *   #398 A COMPLETE SECOND ESCROW LIFECYCLE THAT HAS NEVER RUN, BESIDE THE ONE
 *        THAT HOLDS THE MONEY.
 *
 *   FROM THE ORPHAN QUEUE. #396's caller count over all 457 exported *Action
 *   definitions left 45 with no live caller. Four of them are the entire public
 *   surface of actions/marketplace/_escrow_lifecycle.ts:
 *
 *        createEscrowAction           0 live callers, 0 tests
 *        confirmEscrowPaymentAction   0 live callers, 1 test
 *        requestEscrowReleaseAction   0 live callers, 0 tests
 *        releaseEscrowAction          0 live callers, 1 test
 *
 *   WHAT ACTUALLY HOLDS AND MOVES THE MONEY
 *   ---------------------------------------
 *     create   _payment_orders.ts, one row per seller at checkout, fee split
 *              computed from the cart by platformFeeFor / sellerNetFor (#271)
 *     fund     _payment_verify.ts, after Paystack verification
 *     release  _escrow_actions.ts::releaseEscrowFunds / refundEscrowToBuyer,
 *              from /admin/marketplace/escrow and /escrow
 *     auto     api/cron/release-escrow, 24h after the buyer confirms receipt
 *
 *   THE HAZARD IS SPECIFIC: STRANDED MONEY
 *   ---------------------------------------
 *   Every live path addresses an escrow row by the deterministic
 *   escrowIdFor(orderId, sellerId, allSellerIds) — the scheme #104 introduced so
 *   two sellers on one order cannot collide. createEscrowAction uses `.add()`
 *   and gets a random id, so a row created through it could not be addressed by
 *   the release, the refund, the cron or the order screen. The buyer's money
 *   would sit in it with no path out.
 *
 *   ALL FOUR, NOT JUST THE CREATE. They are one lifecycle: arming the create
 *   alone strands money, the confirm alone funds rows the create never made, the
 *   release alone duplicates releaseEscrowFunds on a differently-addressed row.
 *   The incoherent states are the half-armed ones, so the flag is per module.
 *
 *   WHAT IS NOT CLAIMED. requestEscrowReleaseAction has NO live equivalent — a
 *   seller cannot ask for a release, which #390 already recorded at the field it
 *   writes that nothing reads. The outcome is reached another way (buyer
 *   confirms, cron releases; or an admin releases), but that is a different
 *   mechanism, not the same feature. #384's rule cuts against overclaiming here.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the refusal is dropped from the create        KILLED
 *     the refusal is dropped from the release       KILLED
 *     the flag accepts any truthy value             KILLED
 *     the refusal stops naming the id mismatch      KILLED
 *     reword the header prose                       SURVIVED, as intended
 */

import { describe, it, expect } from '@jest/globals';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import {
    MARKETPLACE_ESCROW_LIFECYCLE_ENV,
    MARKETPLACE_ESCROW_LIFECYCLE_ENABLED_VALUE,
    MARKETPLACE_ESCROW_LIFECYCLE_REFUSAL,
    isMarketplaceEscrowLifecycleEnabled,
} from '@/lib/marketplace-escrow-lifecycle';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');

const cache = new Map<string, string>();
const code = (p: string) => {
    if (!cache.has(p)) cache.set(p, stripComments(readFileSync(p, 'utf-8'), { label: relative(ROOT, p) }));
    return cache.get(p)!;
};

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            if (entry === 'node_modules') continue;
            walk(full, out);
        } else if (/\.tsx?$/.test(entry)) {
            out.push(full);
        }
    }
    return out;
}

const FILES = walk(SRC);
const MODULE = join(SRC, 'app/actions/marketplace/_escrow_lifecycle.ts');
const FLAG = join(SRC, 'lib/marketplace-escrow-lifecycle.ts');
const isTest = (p: string) => p.includes('__tests__') || /\.test\.tsx?$/.test(p);

const RETIRED = [
    'createEscrowAction',
    'confirmEscrowPaymentAction',
    'requestEscrowReleaseAction',
    'releaseEscrowAction',
] as const;

// ─────────────────────────────────────────────────────────────────────────────
describe('#398 — the measurement that decided it', () => {
    it('NOT ONE OF THE FOUR HAS A LIVE CALLER', () => {
        for (const name of RETIRED) {
            const pattern = new RegExp(`\\b${name}\\b`);
            const live = FILES
                .filter((p) => p !== MODULE && p !== FLAG && !isTest(p))
                .filter((p) => pattern.test(code(p)))
                .map((p) => relative(ROOT, p));
            expect({ name, live }).toEqual({ name, live: [] });
        }
    });

    it('and the counter can tell a reached action from an unreached one', () => {
        // Positive control: the live release, in the sibling module, IS wired
        // from the admin escrow screens. Without this, "no callers" could mean
        // the counter is broken rather than that nothing calls them.
        const live = FILES
            .filter((p) => !isTest(p) && !p.endsWith('_escrow_actions.ts'))
            .filter((p) => /\breleaseEscrowFunds\b/.test(code(p)));
        expect(live.length).toBeGreaterThan(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#398 — the live lifecycle addresses escrow a different way', () => {
    it('THE LIVE CREATE USES THE DETERMINISTIC ID, THE RETIRED ONE DOES NOT', () => {
        // This is the whole hazard: a row created by .add() cannot be found by
        // anything that rebuilds escrowIdFor(...) from the order.
        const liveCreate = code(join(SRC, 'app/actions/marketplace/_payment_orders.ts'));
        expect(liveCreate).toContain('escrowIdFor(');
        expect(liveCreate).toContain('COLLECTIONS.ESCROW_TRANSACTIONS');

        const retired = code(MODULE);
        expect(retired).toMatch(/collection\(COLLECTIONS\.ESCROW_TRANSACTIONS\)\.add\(/);
        expect(retired).not.toContain('escrowIdFor(');
    });

    it('and the paths that move the money all rebuild that id', () => {
        for (const rel of [
            'app/actions/marketplace/_payment_verify.ts',
            'app/actions/order-management.ts',
        ]) {
            expect({ rel, uses: code(join(SRC, rel)).includes('escrowIdFor(') })
                .toEqual({ rel, uses: true });
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#398 — retired at the door, kept behind a flag', () => {
    it('ALL FOUR REFUSE BEFORE THE SESSION LOOKUP', () => {
        const source = code(MODULE);
        for (const name of RETIRED) {
            const start = source.indexOf(`async function _${name}(`);
            expect({ name, found: start > -1 }).toEqual({ name, found: true });

            const head = source.slice(start, start + 1200);
            const refusalAt = head.indexOf('isMarketplaceEscrowLifecycleEnabled()');

            /**
             * Compared against whichever guard the function actually opens with.
             * Three of the four call requireSession(); _releaseEscrowAction is
             * admin-only and calls requireAdmin() instead, so pinning the
             * assertion to requireSession alone silently compared against -1 and
             * reported the refusal as NOT first when it was.
             */
            const guardAt = Math.min(
                ...['requireSession(', 'requireAdmin(']
                    .map((g) => head.indexOf(g))
                    .filter((i) => i > -1),
            );

            expect({ name, refused: refusalAt > -1 }).toEqual({ name, refused: true });
            expect({ name, hasGuard: Number.isFinite(guardAt) }).toEqual({ name, hasGuard: true });
            // Order is the claim: while the flag is off, no caller reaches the
            // session lookup, the guards, or any write.
            expect({ name, first: refusalAt < guardAt }).toEqual({ name, first: true });
        }
    });

    it('and the flag takes one exact word, not any truthy value', () => {
        const original = process.env[MARKETPLACE_ESCROW_LIFECYCLE_ENV];
        try {
            for (const value of ['1', 'true', 'yes', 'ENABLED', 'enabled ', '']) {
                process.env[MARKETPLACE_ESCROW_LIFECYCLE_ENV] = value;
                expect({ value, on: isMarketplaceEscrowLifecycleEnabled() })
                    .toEqual({ value, on: false });
            }
            delete process.env[MARKETPLACE_ESCROW_LIFECYCLE_ENV];
            expect(isMarketplaceEscrowLifecycleEnabled()).toBe(false);

            process.env[MARKETPLACE_ESCROW_LIFECYCLE_ENV] = MARKETPLACE_ESCROW_LIFECYCLE_ENABLED_VALUE;
            expect(isMarketplaceEscrowLifecycleEnabled()).toBe(true);
        } finally {
            if (original === undefined) delete process.env[MARKETPLACE_ESCROW_LIFECYCLE_ENV];
            else process.env[MARKETPLACE_ESCROW_LIFECYCLE_ENV] = original;
        }
    });

    it('and the refusal names the live path AND the id mismatch', () => {
        // A refusal that only says no sends the next developer looking (#322),
        // and the id mismatch is the reason arming this is not a wiring change.
        expect(MARKETPLACE_ESCROW_LIFECYCLE_REFUSAL).toContain('escrowIdFor');
        expect(MARKETPLACE_ESCROW_LIFECYCLE_REFUSAL).toMatch(/random id/i);
        expect(MARKETPLACE_ESCROW_LIFECYCLE_REFUSAL).toMatch(/admin\/marketplace\/escrow/);
        expect(MARKETPLACE_ESCROW_LIFECYCLE_REFUSAL).toMatch(/no path out/i);
    });

    it('and every repair this file carries is KEPT, not deleted', () => {
        /**
         * The standing rule: retire, never destroy. Each of these is a prior
         * finding's fix living in this file, and all of them are still here and
         * still exercised with the flag armed by escrow-lifecycle-behaviour and
         * escrow-confirm-authz.
         */
        const source = code(MODULE);
        expect(source).toContain('claimStatusTransition');   // #110 the release claim
        expect(source).toContain('verifyPaystackPayment');   // #111 reference ownership
        expect(source).toContain('creditWalletOnce');        // #113 net, not gross
        expect(source).toContain('requireAdmin(');           // #375 the named permission
    });
});
