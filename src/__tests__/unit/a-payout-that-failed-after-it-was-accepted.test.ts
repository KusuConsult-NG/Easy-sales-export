/**
 * @jest-environment node
 */

/**
 *   #693 A PAYOUT PAYSTACK ACCEPTED AND THEN FAILED WAS RECORDED AS COMPLETED.
 *
 *   A Paystack transfer is ASYNCHRONOUS. `POST /transfer` answers
 *
 *       { status: true, data: { transfer_code: "TRF_…", status: "pending" } }
 *
 *   where the OUTER `status` says the API call was accepted and `data.status`
 *   says where the money is. On acceptance it is "pending". The money has not
 *   moved.
 *
 *   `initiateTransfer` tested `res.ok && data.status` and returned
 *   `success: true`, never reading `data.data.status`. Its log line is honest —
 *   "Transfer initiated" — and every caller read the boolean as PAID:
 *
 *       status: payoutSuccess ? "completed" : "approved_pending_payout"
 *
 *   and wrote a TRANSACTIONS row with `status: "completed"`.
 *
 *   THE OUTCOME ARRIVES BY WEBHOOK, AND THE WEBHOOK IGNORED IT. The Paystack
 *   route handled `charge.success`, `charge.failed` and `charge.abandoned`.
 *   Every `transfer.success`, `transfer.failed` and `transfer.reversed` fell
 *   through to `{ message: "Event ignored" }` with a 200.
 *
 *   So a transfer a bank rejected — closed account, name mismatch, an
 *   insufficient Paystack balance — left:
 *
 *       the member's balance DEBITED,
 *       the withdrawal marked COMPLETED,
 *       a ledger row saying they were paid,
 *       the money back in the Paystack balance,
 *
 *   and nothing anywhere that could notice.
 *
 *   THIS IS NOT #318. That finding covered payouts whose INITIATION was
 *   ambiguous — a duplicate reference, or no response at all — and
 *   reconcile-fulfilment reports those by scanning `needsReconciliation`. Here
 *   initiation SUCCEEDED, so no flag was ever set and there was nothing to
 *   scan.
 *
 * ── IT MARKS AND TELLS; IT DOES NOT MOVE MONEY ──────────────────────────────
 *
 *   A failed transfer means the money is provably still with the platform, so
 *   crediting the member back is arguably safe. It is deliberately not done,
 *   for the reason cron/reconcile-fulfilment already gives for the four
 *   money-out paths it watches: "retrying a transfer moves money, and this
 *   route alerts rather than auto-heals". A webhook is replayable and
 *   externally reachable, and a credit racing an admin's manual correction pays
 *   twice.
 *
 *   What it does is everything short of that, and the part that was missing
 *   entirely: the record is flagged `needsReconciliation` — which
 *   reconcile-fulfilment ALREADY scans — the failure is recorded in Paystack's
 *   own words, and THE MEMBER IS TOLD, which nothing did before.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

const ROOT = process.cwd();
const code = (rel: string) => stripComments(readFileSync(join(ROOT, rel), 'utf8'), { label: rel });

describe('#693 — the transfer outcome is read at all', () => {
    it('THE DEFECT: the webhook no longer ignores every transfer event', () => {
        const route = code('src/app/api/webhooks/paystack/route.ts');
        for (const e of ['transfer.success', 'transfer.failed', 'transfer.reversed']) {
            expect({ e, handled: route.includes(`"${e}"`) }).toEqual({ e, handled: true });
        }
        expect(route).toContain('recordPayoutOutcome(');
    });

    it('AND initiateTransfer REPORTS PAYSTACK\'S OWN STATUS', () => {
        /*
         *   `success` says the API accepted the request. `data.data.status` —
         *   "pending" / "otp" / "success" — says where the money is, and was
         *   never read. The boolean is left alone deliberately: its callers
         *   write statuses with many readers, and rewriting those from a
         *   transport detail would be a wide, risky edit. The real state is
         *   reported alongside it instead.
         */
        const src = code('src/lib/paystack-transfer.ts');
        expect(src).toContain('transferStatus');
        expect(src).toMatch(/transferStatus:\s*data\.data\.status/);
    });

    it('AND THE CHARGE EVENTS ARE UNTOUCHED', () => {
        //   The control on the first line: adding a branch must not displace
        //   the money-IN handling, which has its own claim and its own tests.
        const route = code('src/app/api/webhooks/paystack/route.ts');
        for (const e of ['charge.success', 'charge.failed', 'charge.abandoned']) {
            expect({ e, handled: route.includes(`"${e}"`) }).toEqual({ e, handled: true });
        }
        expect(route).toContain('claimPaymentOnce');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#693 — what a transfer outcome does to the record', () => {
    let notices: any[];
    let store: any;
    let COLLECTIONS: any;

    async function harness() {
        jest.resetModules();
        notices = [];
        jest.doMock('@/lib/member-decision-notice', () => ({
            notifyMemberDecision: async (n: any) => { notices.push(n); },
        }));
        const { installFakeDb } = jest.requireActual<typeof import('@/lib/testing/fake-db')>(
            '@/lib/testing/fake-db');
        store = installFakeDb();
        COLLECTIONS = jest.requireActual<typeof import('@/lib/types/firestore')>(
            '@/lib/types/firestore').COLLECTIONS;
        return (await import('@/lib/payout-outcome'));
    }

    beforeEach(() => { jest.clearAllMocks(); });

    it('THE DEFECT: a failed transfer flags the record and tells the member', async () => {
        const mod = await harness();
        store.seed(COLLECTIONS.WAVE_WITHDRAWALS, 'w-1', {
            userId: 'member-9', amount: 75000, status: 'completed',
        });

        const out = await mod.recordPayoutOutcome({
            reference: 'WAVE-w-1',
            event: 'transfer.failed',
            message: 'Account name mismatch',
            amountNaira: 75000,
        });

        expect(out.handled).toBe(true);

        const after = store.get(COLLECTIONS.WAVE_WITHDRAWALS, 'w-1');
        expect(after.needsReconciliation).toBe(true);
        expect(after.payoutOutcome).toBe('failed');
        expect(String(after.payoutError)).toContain('Account name mismatch');

        expect(notices).toHaveLength(1);
        expect(notices[0]).toMatchObject({ userId: 'member-9', outcome: 'rejected', amount: 75000 });
        expect(String(notices[0].reason)).toContain('Account name mismatch');
    });

    it('AND DOES NOT ROLL THE STATUS BACK TO SOMETHING PAYABLE', () => {
        /*
         *   #250's rule, and the reason this is a separate assertion rather
         *   than an implied one: "A caller MUST NOT return the record to a
         *   state it can be paid from again; park it for reconciliation
         *   instead." A status rolled back to `approved_pending_payout` is a
         *   record an admin can press Pay on, for money that may yet land.
         */
        const src = code('src/lib/payout-outcome.ts');
        expect(src).not.toMatch(/status:\s*["'](approved_pending_payout|pending|approved)["']/);
    });

    it('AND DOES NOT MOVE MONEY', () => {
        //   The control that matters most. Crediting the balance back from a
        //   replayable, externally-reachable webhook is the repair this
        //   deliberately does not make — see the header.
        const src = code('src/lib/payout-outcome.ts');
        expect(src).not.toMatch(/FieldValue\.increment|creditWallet|creditUser|waveEarningsBalance/);
    });

    it('AND A SUCCESSFUL TRANSFER LEAVES THE FIRST REAL PROOF OF PAYMENT', async () => {
        /*
         *   The other control. A handler that only reacted to failure would
         *   satisfy the assertions above and leave "completed" still meaning
         *   nothing more than "the API accepted it".
         */
        const mod = await harness();
        store.seed(COLLECTIONS.WAVE_WITHDRAWALS, 'w-2', { userId: 'member-9', amount: 1000 });

        await mod.recordPayoutOutcome({ reference: 'WAVE-w-2', event: 'transfer.success' });

        const after = store.get(COLLECTIONS.WAVE_WITHDRAWALS, 'w-2');
        expect(after.payoutConfirmedAt).toBeDefined();
        expect(after.payoutOutcome).toBe('success');
        expect(after.needsReconciliation).toBeUndefined();
        expect(notices).toEqual([]);
    });

    it('AND A REDELIVERED WEBHOOK DOES NOT TELL THE MEMBER TWICE', async () => {
        //   Paystack redelivers. The flags are idempotent; a second "your
        //   payout did not arrive" is not.
        const mod = await harness();
        store.seed(COLLECTIONS.WAVE_WITHDRAWALS, 'w-3', { userId: 'member-9', amount: 500 });

        const first = await mod.recordPayoutOutcome({ reference: 'WAVE-w-3', event: 'transfer.failed' });
        const second = await mod.recordPayoutOutcome({ reference: 'WAVE-w-3', event: 'transfer.failed' });

        expect(first.handled).toBe(true);
        expect(second.handled).toBe(false);
        expect(second.reason).toBe('already recorded');
        expect(notices).toHaveLength(1);
    });

    it('AND FINDS THE RECORD WHEREVER THE PREFIX SAYS IT LIVES', async () => {
        /*
         *   WITHDRAW spans three collections because admin/_withdrawals.ts
         *   resolves a withdrawal across them. A resolver that looked in one
         *   would report "record not found" for two thirds of the platform's
         *   withdrawals and the member would still not be told.
         */
        const mod = await harness();
        store.seed(COLLECTIONS.COOPERATIVE_WITHDRAWALS, 'cw-1', { userId: 'member-4', amount: 20000 });

        const out = await mod.recordPayoutOutcome({ reference: 'WITHDRAW-cw-1', event: 'transfer.failed' });

        expect(out.handled).toBe(true);
        expect(out.collection).toBe(COLLECTIONS.COOPERATIVE_WITHDRAWALS);
        expect(notices[0]).toMatchObject({ userId: 'member-4' });
    });

    it('AND AN ESCROW PAYOUT TELLS THE SELLER, NOT THE BUYER', async () => {
        //   The payee of an escrow release is the seller. Reading `userId`
        //   there would notify the buyer that THEIR payout failed.
        const mod = await harness();
        store.seed(COLLECTIONS.MARKETPLACE_ORDERS, 'ord-1', {
            userId: 'buyer-1', sellerId: 'seller-7', totalAmount: 5000,
        });

        await mod.recordPayoutOutcome({ reference: 'ESCROW-ord-1', event: 'transfer.failed' });

        expect(notices[0]).toMatchObject({ userId: 'seller-7' });
    });

    it('AND AN UNKNOWN REFERENCE IS REPORTED, NOT SWALLOWED', async () => {
        //   Money left the Paystack balance that this platform cannot account
        //   for. That is worth a log line, and it must not throw — the webhook
        //   has to answer 200 or be redelivered forever.
        const mod = await harness();

        const out = await mod.recordPayoutOutcome({ reference: 'SOMETHING-else', event: 'transfer.failed' });

        expect(out).toMatchObject({ handled: false, reason: 'unrecognised reference' });
    });

    it('AND A REFERENCE WHOSE ID CONTAINS A HYPHEN SURVIVES THE PARSE', async () => {
        /*
         *   payoutReference() joins prefix and id with "-" and most ids are
         *   uuid-shaped. Splitting on every "-" would truncate them, so only
         *   the FIRST segment is the prefix.
         */
        const mod = await harness();
        expect(mod.parsePayoutReference('WAVE-3f2a-9c11-aa02'))
            .toEqual({ prefix: 'WAVE', entityId: '3f2a-9c11-aa02' });
        expect(mod.parsePayoutReference('NOTAPREFIX-x')).toBeNull();
        expect(mod.parsePayoutReference('WAVE')).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#693 — and the flag it sets is one somebody reads', () => {
    it('reconcile-fulfilment ALREADY SCANS needsReconciliation', () => {
        /*
         *   The reason this finding sets that field rather than inventing an
         *   alerting path of its own. #318 built the scan; this supplies it
         *   with the case it could never see, because initiation had succeeded
         *   and nothing set a flag.
         *
         *   If that scan is ever removed, a failed payout goes back to being
         *   recorded and unwatched — so this fails rather than going quiet.
         */
        const cron = code('src/app/api/cron/reconcile-fulfilment/route.ts');
        expect(cron).toMatch(/where\(\s*["']needsReconciliation["']\s*,\s*["']==["']\s*,\s*true\s*\)/);
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored and diffed after each.
 *
 *     MUTANT                                                        RESULT
 *     THE DEFECT: the webhook ignores transfer events again           KILLED
 *     a failed transfer no longer flags the record                    KILLED
 *     a failed transfer no longer tells the member                    KILLED
 *     a successful transfer records no proof of payment               KILLED
 *     a redelivered webhook is processed twice                        KILLED
 *     the reference is split on every hyphen, truncating a uuid       KILLED
 *     WITHDRAW looks in only the first collection                     KILLED
 *     an escrow payout notifies the buyer instead of the seller       KILLED
 *     the fake's create() stops throwing on a duplicate               KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword the shared module's header                               SURVIVED ✓
 *
 * ── AND THE HARNESS WAS NARROWER THAN THE ADAPTER, FOR THE THIRD TIME ───────
 *
 *   `docRef.create()` — an INSERT at a KNOWN id that throws ALREADY_EXISTS — is
 *   what makes the once-only guard above real. The adapter has it. The test
 *   harness did not, so the first run failed with "create is not a function",
 *   the module's catch turned that into a generic error, and the once-only
 *   assertion could not have failed either way.
 *
 *   testing/firestore-mock-db.js's own comments record the same thing happening
 *   to `delete()` and to `updateExisting()` — this is the third. What made it
 *   take three attempts to find is that a `create` DID exist a few dozen lines
 *   below, on the COLLECTION, as an alias of add(): a generated id, no conflict,
 *   nothing to throw. It looks like the method you want and is not it.
 */
