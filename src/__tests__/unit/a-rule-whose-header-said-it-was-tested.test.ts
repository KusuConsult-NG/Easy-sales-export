/**
 * @jest-environment node
 */

/**
 * Two modules that decide what happens to somebody's money, and no test had
 * ever named either of them.
 *
 *   Found by counting: 1,272 shipping files, 137 of which no test mentions by
 *   path or import. These two were on that list, and the first one SAYS IT IS
 *   TESTED.
 *
 * ── lib/claim-outcome ───────────────────────────────────────────────────────
 *
 *   Its header, on the constant below:
 *
 *       "The constant below is asserted against both writers by test, so the
 *        two cannot drift."
 *
 *   There was no such test. What exists —
 *   a-lost-claim-is-not-proof-somebody-delivered.test.ts — is a SOURCE-SHAPE
 *   classifier: it feeds snippets of text to a matcher and checks how the
 *   matcher labels them. It never imports the module, so
 *   `lostClaimWasFulfilled` itself, the function that decides whether a charged
 *   buyer is told their money is safe or is quietly told "success", had no
 *   check of any kind.
 *
 *   And the drift it claimed to prevent is live: `unhandled_type` is exported
 *   from payment-router as UNHANDLED_PAYMENT_STATUS, and `fulfilment_failed` is
 *   a string literal in wallet-ledger. Rename either and this list silently
 *   stops matching — at which point a payment that was claimed and NOT
 *   fulfilled reads as fulfilled, and the buyer is told everything is fine.
 *
 * ── lib/write-guard ─────────────────────────────────────────────────────────
 *
 *   It sits at the write boundary of the payment status and the user roles
 *   array. #720 records what it cost when it behaved as a filter: a four-field
 *   money write against a one-field schema wrote one field and reported
 *   success, so a paid export order never left `pending_payment`. The repair —
 *   validate, do not filter — was the whole point, and nothing pinned it.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { stripComments } from '@/lib/testing/strip-comments';
import {
    lostClaimWasFulfilled,
    NON_FULFILMENT_CLAIM_STATUSES,
    UNFULFILLED_CLAIM_MESSAGE,
} from '@/lib/claim-outcome';
import {
    writeGuard, PaymentStatusWriteSchema, UserRolesWriteSchema,
} from '@/lib/write-guard';
import { UNHANDLED_PAYMENT_STATUS } from '@/infrastructure/payments/payment-router';
import { ALL_USER_ROLES } from '@/lib/types/roles';

const ROOT = process.cwd();
const source = (rel: string) =>
    stripComments(readFileSync(join(ROOT, rel), 'utf8'), { label: rel });

/*
 *   NO LOGGER MOCK HERE, deliberately.
 *
 *   This file imports write-guard statically, and write-guard imports the
 *   logger — so with `jest` taken from @jest/globals (no hoisting), a
 *   `jest.mock('@/lib/logger')` below those imports would register after the
 *   real module had already loaded and silently do nothing.
 *   every-jest-mock-takes-effect.test.ts caught exactly that here. Nothing in
 *   this file asserts on a log line, so the real logger is left alone.
 */

// ─────────────────────────────────────────────────────────────────────────────
describe('what a lost payment claim means', () => {
    it('A CLAIM LOST TO SOMETHING THAT DID NOT FULFIL IT IS NOT A FULFILMENT', () => {
        //   THE function. #259 established that a lost claim means the money
        //   was already applied; #531 then gave the webhook a reason to claim a
        //   reference it could not apply. This is the discriminator.
        for (const status of NON_FULFILMENT_CLAIM_STATUSES) {
            expect({ status, fulfilled: lostClaimWasFulfilled(status) })
                .toEqual({ status, fulfilled: false });
        }
    });

    it('AND EVERYTHING ELSE IS, INCLUDING NULL', () => {
        /*
         *   Deliberately a denylist. `processed_payments` rows written before
         *   the status column carried a value read back as null, and an
         *   allowlist would refuse every one of them — turning #259's defect
         *   back on for the oldest payments on the platform.
         */
        for (const status of [null, undefined, '', 'completed', 'overfunded_review', 'anything']) {
            expect({ status, fulfilled: lostClaimWasFulfilled(status as any) })
                .toEqual({ status, fulfilled: true });
        }
    });

    it('AND SURROUNDING WHITESPACE DOES NOT SMUGGLE ONE PAST', () => {
        expect(lostClaimWasFulfilled('  fulfilment_failed  ')).toBe(false);
        expect(lostClaimWasFulfilled('\tunhandled_type\n')).toBe(false);
    });

    it('THE LIST MATCHES THE WRITER payment-router EXPORTS', () => {
        //   The drift the header promised was guarded. payment-router names it
        //   as a constant, so a rename there would leave this list silently
        //   wrong — and a claimed-but-unfulfilled payment reading as fulfilled.
        expect(NON_FULFILMENT_CLAIM_STATUSES).toContain(UNHANDLED_PAYMENT_STATUS);
    });

    it('AND THE WRITER wallet-ledger SPELLS IT THE SAME WAY', () => {
        //   A string literal rather than a constant over there, which is why
        //   this is asserted against the source rather than against an import:
        //   importing wallet-ledger drags the whole money graph into this file.
        const ledger = source('src/lib/wallet-ledger.ts');

        expect(ledger).toContain('status: "fulfilment_failed"');
        expect(NON_FULFILMENT_CLAIM_STATUSES).toContain('fulfilment_failed');
    });

    it('AND IT NAMES NOTHING ELSE — two markers, not a catch-all', () => {
        //   Widening this list would refuse legitimate duplicate callbacks,
        //   which is #259's defect coming back.
        expect([...NON_FULFILMENT_CLAIM_STATUSES].sort())
            .toEqual(['fulfilment_failed', 'unhandled_type']);
    });

    it('AND THE MESSAGE TELLS THE BUYER THE MONEY IS SAFE', () => {
        //   It must not say "failed": the payment succeeded and the fulfilment
        //   did not happen, and a buyer told their payment failed will pay again.
        expect(UNFULFILLED_CLAIM_MESSAGE).toMatch(/went through/i);
        expect(UNFULFILLED_CLAIM_MESSAGE).toMatch(/nothing further has been charged/i);
        expect(UNFULFILLED_CLAIM_MESSAGE).not.toMatch(/payment failed/i);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the guard at the write boundary', () => {
    it('IT VALIDATES AND DOES NOT FILTER — #720, the whole repair', () => {
        /*
         *   THE test. It returned Zod's parsed output, which DROPS undeclared
         *   keys, so this exact call wrote `{ paymentStatus }` alone: the order
         *   asserted both that the payment completed and that it was still
         *   awaiting payment, and nothing logged, because a silent partial
         *   write is this function's success path.
         */
        const written = writeGuard(PaymentStatusWriteSchema.partial(), {
            status: 'processing',
            paymentStatus: 'completed',
            paymentVerifiedAt: '2026-09-24T00:00:00.000Z',
            updatedAt: '2026-09-24T00:00:00.000Z',
        }, 'test/payment');

        expect(written).toEqual({
            status: 'processing',
            paymentStatus: 'completed',
            paymentVerifiedAt: '2026-09-24T00:00:00.000Z',
            updatedAt: '2026-09-24T00:00:00.000Z',
        });
    });

    it('AND THE VALIDATED VALUE STILL WINS, so a coercing schema coerces', () => {
        const Coercing = z.object({ count: z.coerce.number() });

        expect(writeGuard(Coercing, { count: '7', note: 'kept' } as any, 'test/coerce'))
            .toEqual({ count: 7, note: 'kept' });
    });

    it('AND A VIOLATION THROWS, naming the field and the context', () => {
        //   In this environment it throws; the module's header records that
        //   production fails open deliberately, to avoid blocking a payment on
        //   schema drift.
        expect(() => writeGuard(PaymentStatusWriteSchema, { paymentStatus: 'successful' }, 'test/bad'))
            .toThrow(/paymentStatus/);
        expect(() => writeGuard(PaymentStatusWriteSchema, { paymentStatus: 'successful' }, 'test/bad'))
            .toThrow(/test\/bad/);
    });

    it('AND A NON-OBJECT IS RETURNED AS THE SCHEMA PARSED IT', () => {
        //   The spread only applies to plain objects. An array or a primitive
        //   must not be turned into one.
        const Arr = z.array(z.number());
        expect(writeGuard(Arr, [1, 2, 3], 'test/array')).toEqual([1, 2, 3]);
        expect(writeGuard(z.string(), 'plain', 'test/string')).toBe('plain');
    });

    it('THE ROLE LIST IS THE ONE LIST, not a sixth copy of it', () => {
        /*
         *   It was a hand-written nineteen entries that omitted `general_user`
         *   — the base role on essentially every account — so editing an
         *   ordinary user's roles failed at the write boundary every time, with
         *   a message that reads like an internal error because it is one.
         */
        for (const role of ['general_user', 'marketplace_buyer', 'field_officer']) {
            expect({ role, accepted: UserRolesWriteSchema.safeParse({ roles: [role] }).success })
                .toEqual({ role, accepted: true });
        }
        //   Derived from ALL_USER_ROLES, so a role added there is accepted here.
        for (const role of ALL_USER_ROLES) {
            expect({ role, accepted: UserRolesWriteSchema.safeParse({ roles: [role] }).success })
                .toEqual({ role, accepted: true });
        }
    });

    it('AND A ROLE THAT IS NOT A ROLE IS STILL REFUSED (control)', () => {
        //   The vacuity guard. A schema that accepted anything would satisfy
        //   every assertion above.
        expect(UserRolesWriteSchema.safeParse({ roles: ['exporter'] }).success).toBe(false);
        expect(UserRolesWriteSchema.safeParse({ roles: ['root'] }).success).toBe(false);
    });
});
