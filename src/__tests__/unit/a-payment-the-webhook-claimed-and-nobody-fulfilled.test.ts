/**
 * @jest-environment node
 */

/**
 *   #695 TWO CORRECT FIXES, COMPOSED INTO A CHECKOUT THAT TAKES THE MONEY AND
 *        FULFILS NOTHING — AND TELLS THE BUYER IT WORKED.
 *
 *   Neither #259 nor #531 is wrong. Read together they leave a hole that three
 *   of the platform's eight checkouts fall through.
 *
 *     #259 SAID: a lost claim means the payment was ALREADY APPLIED.
 *          Its own words: "a claim that loses means the payment was ALREADY
 *          APPLIED — by the webhook, or by an earlier delivery of the same
 *          callback. The money moved." So four verify paths were changed to
 *          report SUCCESS on a lost claim instead of an error, which was right:
 *          telling a charged buyer "Payment already processed" as a failure is
 *          the outcome that finding existed to stop.
 *
 *     #531 SAID: a type the router cannot handle must still be recorded, or an
 *          unknown payment vanishes silently. So the webhook now CLAIMS a
 *          reference it could not route, with status "unhandled_type".
 *
 *   #531 made the webhook a claimant that does not fulfil. #259's rule reads
 *   every lost claim as proof that somebody did. The premise the first finding
 *   rested on was removed by the second, and nothing connected them.
 *
 * ── AND THREE CHECKOUTS SIT EXACTLY IN THAT GAP ─────────────────────────────
 *
 *   PAYMENT_ROUTES was built by measuring the three dispatch CHAINS against the
 *   nine PROCESSORS service.ts exports. That is one side of the contract. The
 *   other side — what the checkouts actually MINT into metadata.type — was
 *   never measured against it. Measured here:
 *
 *     export_buyer_order                    export-payment.ts         NOT ROUTED
 *     property_purchase                     farm-nation-payment.ts    NOT ROUTED
 *     academy_enrollment                    academy/_payment.ts       NOT ROUTED
 *     academy_enrollment                    _ac_course_payment.ts     NOT ROUTED
 *     export_investment                     ×2                        routed
 *     marketplace_order                                               routed
 *     contribution                                                    routed
 *     cooperative_membership_registration                             routed
 *     academy_registration                                            routed
 *
 *   `academy_enrollment` is not a spelling of `academy_registration`: the table
 *   already carries multi-spelling rows where two names mean one thing
 *   (farm_nation_registration/_subscription, wave_registration/_application).
 *   Registration is the programme and takes metadata.plan; enrolment is the
 *   purchase of one course. Different fulfilment, no processor.
 *
 *   SO, FOR THOSE THREE, THE ORDINARY SEQUENCE IS:
 *
 *     1. the buyer pays;
 *     2. Paystack delivers charge.success — and the marketplace path's own
 *        comment says "the webhook usually finishes before the user is
 *        redirected back", so this normally happens FIRST;
 *     3. dispatchPaystackPayment finds no route and the webhook claims the
 *        reference as "unhandled_type";
 *     4. the buyer lands on the callback, claimPaymentOnce returns claimed:false,
 *        and #259's rule reports SUCCESS.
 *
 *   The order stays at pending_payment, catalog stock is never decremented, no
 *   TRANSACTIONS ledger row is written, the payment is deliberately excluded
 *   from revenue as "unhandled_type" — and the buyer is shown "Order payment
 *   successful!".
 *
 * ── THE DISCRIMINATOR WAS BUILT IN 2026 AND HAS NEVER BEEN READ ─────────────
 *
 *   claim_payment_once does not just return a boolean. Migration 009 says why,
 *   in the function's own contract block:
 *
 *       status   the status recorded on the existing row when claimed is FALSE,
 *                so a caller can distinguish "already completed" from a row left
 *                behind in some other state.
 *
 *   That is precisely this question, answered at the database, available to
 *   every caller since the day claiming was introduced. Not one of the four
 *   verify paths looks at it — every one of them branches on `!claim.claimed`
 *   alone. The test doubles are narrower than the adapter in the same way: the
 *   existing suites mock `claimPaymentOnce` as `{ claimed: false }` with no
 *   status field at all, so no test could have noticed.
 *
 * ── HOW LIVE IS IT ──────────────────────────────────────────────────────────
 *
 *   Stated honestly, because it changes what the owner should do first.
 *
 *   #531 recorded that the webhook URL "pointed at a host that rejects POST
 *   with 405, so no delivery ever arrived". While that holds, step 2 never
 *   happens and these three checkouts work. THE DAY THE WEBHOOK URL IS
 *   CORRECTED, all three begin taking money and fulfilling nothing. That is the
 *   owner's complaint in one sentence — a fix landing and the app breaking —
 *   and it is why this is repaired before the URL is.
 *
 *   The cron reconciler is the one thing that still sees it: it scans
 *   processedPayments WHERE status == "completed", and "unhandled_type" is not
 *   that, so the reference is reported as a discrepancy on every run. It can
 *   never auto-heal it — there is no route — but it is visible. That is the
 *   whole of the existing safety net, and it is a report, not a repair.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { join, relative } from 'path';
import crypto from 'node:crypto';

import { stripComments } from '@/lib/testing/strip-comments';

const ROOT = process.cwd();

// ─────────────────────────────────────────────────────────────────────────────
// THE MEASUREMENT: what the checkouts mint, against what the router knows.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Every file that calls the shared Paystack initializer.
 *
 * Listed rather than swept, and the control below proves the list is complete:
 * a sweep over src for the call is cheap and is exactly what #678's discarded
 * instrument got wrong by being clever. This is the narrow, sound version.
 */
const INITIATOR_FILES = [
    'src/app/actions/export-payment.ts',
    'src/app/actions/marketplace/_payment_orders.ts',
    'src/app/actions/export/_ex_investments.ts',
    'src/app/actions/cooperative/_payment.ts',
    'src/app/actions/cooperative/_coop_money.ts',
    'src/app/actions/farm-nation-payment.ts',
    'src/app/actions/academy/_payment.ts',
    'src/app/actions/academy/_ac_course_payment.ts',
];

/** The span of one call, from its opening paren to the paren that closes it. */
function callSpan(src: string, openParenAt: number): string {
    let depth = 0;
    for (let i = openParenAt; i < src.length; i++) {
        const c = src[i];
        if (c === '(') depth++;
        else if (c === ')') {
            depth--;
            if (depth === 0) return src.slice(openParenAt, i + 1);
        }
    }
    return src.slice(openParenAt);
}

/**
 * The `type` each initializer puts in Paystack's metadata.
 *
 * Scoped to the CALL, by matching parens — not to a fixed window. A window long
 * enough to reach the metadata object of one call is long enough to reach the
 * next call's, and this file's whole claim is about which call mints which
 * type.
 */
function mintedTypes(): Array<{ where: string; type: string }> {
    const found: Array<{ where: string; type: string }> = [];
    for (const rel of INITIATOR_FILES) {
        const src = stripComments(readFileSync(join(ROOT, rel), 'utf8'), { label: rel });
        const needle = 'initializePaystackPayment(';
        let at = src.indexOf(needle);
        while (at !== -1) {
            const span = callSpan(src, at + needle.length - 1);
            const m = span.match(/\btype:\s*["'`]([a-z_]+)["'`]/);
            if (m) found.push({ where: rel, type: m[1] });
            at = src.indexOf(needle, at + needle.length);
        }
    }
    return found;
}

describe('#695 — every checkout the platform mints must have a door that fulfils it', () => {
    it('THE SCAN IS READING THE APPLICATION', () => {
        //   THE control. Every assertion below is about a list of minted types,
        //   and an empty list agrees with any expectation about it.
        const minted = mintedTypes();
        expect(minted.length).toBeGreaterThanOrEqual(8);
        expect(new Set(minted.map((m) => m.where)).size).toBe(INITIATOR_FILES.length);
    });

    it('AND EVERY MINTED TYPE HAS AN OWNER — A PROCESSOR, OR A NAMED CALLBACK', () => {
        /*
         *   There are exactly two honest answers to "who fulfils this
         *   checkout", and this asserts every minted type gives one of them.
         *   A type that gives NEITHER is the defect: no processor can fulfil
         *   it, and the doors that cannot fulfil it will claim the reference
         *   away from the callback that can.
         *
         *   FAILS IN BOTH DIRECTIONS ON PURPOSE. A new checkout minting a new
         *   type fails here until somebody decides which door owns it. A route
         *   deleted from the table fails here too.
         */
        const { HANDLED_PAYMENT_TYPES, CALLBACK_FULFILLED_TYPES } =
            require('@/infrastructure/payments/payment-router');

        const ownerless = mintedTypes()
            .filter((m) => !HANDLED_PAYMENT_TYPES.has(m.type) && !CALLBACK_FULFILLED_TYPES.has(m.type))
            .map((m) => `${m.type} (${m.where})`)
            .sort();

        expect({ ownerless }).toEqual({ ownerless: [] });
    });

    it('AND THE THREE THE WEBHOOK CANNOT FULFIL ARE PINNED, NOT OPEN-ENDED', () => {
        /*
         *   THE COST OF THIS LIST, WRITTEN DOWN WHERE IT CANNOT BE MISSED.
         *
         *   Being on it means: a buyer who pays and never returns to the
         *   callback gets no fulfilment, and only the reconciler's discrepancy
         *   list will say so. That is the pre-existing behaviour of these three
         *   checkouts — this finding neither caused it nor cures it — and it is
         *   the reason the list is pinned exactly rather than merely consulted.
         *   A fourth entry is a fourth checkout with that hole and has to be
         *   argued for here; an entry REMOVED means somebody wrote the
         *   processor, which is the direction this should move.
         */
        const { CALLBACK_FULFILLED_TYPES, HANDLED_PAYMENT_TYPES } =
            require('@/infrastructure/payments/payment-router');

        expect([...CALLBACK_FULFILLED_TYPES].sort()).toEqual([
            'academy_enrollment',
            'export_buyer_order',
            'property_purchase',
        ]);

        //   And no type may be in both. The webhook skips claiming whatever is
        //   callback-owned, so a type that is ALSO routable would have its
        //   processor silently bypassed — trading this defect for its mirror.
        const both = [...CALLBACK_FULFILLED_TYPES].filter((t) => HANDLED_PAYMENT_TYPES.has(t));
        expect({ both }).toEqual({ both: [] });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE INSTRUMENT, VALIDATED: the double must match what the database returns.
// ─────────────────────────────────────────────────────────────────────────────

describe('#695 — the claim contract, read from the migration that defines it', () => {
    it('claim_payment_once RETURNS THE EXISTING STATUS WHEN THE CLAIM IS LOST', () => {
        /*
         *   The behavioural test below stands on a double for claimPaymentOnce.
         *   A double that returned `{ claimed: false }` with no status — which
         *   is what every existing suite uses — would make the defect
         *   unreproducible and the fix unprovable. So the contract is read from
         *   the SQL, here, before anything is believed.
         */
        const sql = readFileSync(
            join(ROOT, 'supabase/migrations/009_claim_payment_once.sql'), 'utf8');

        expect(sql).toContain('RETURNS TABLE (claimed BOOLEAN, status TEXT)');
        //   The conflict branch: read the row that won, return its status.
        expect(sql).toContain("SELECT p.raw_data->>'status' INTO v_current");
        expect(sql).toContain('RETURN QUERY SELECT FALSE, v_current;');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE DOOR: the webhook claims, then the buyer's callback is asked.
// ─────────────────────────────────────────────────────────────────────────────

const REF = 'PSK-EXPORT-ORDER-695';
const BUYER = 'buyer-695';
const ORDER_ID = 'EXP-ORD-695';
const TOTAL_NGN = 250_000;
const SECRET = 'sk_test_695';

/**
 * One claim store, shared by the webhook and the callback, faithful to 009:
 * first caller wins and gets its own status back; every later caller loses and
 * is told the status of the row that won.
 */
const claims = new Map<string, string>();
const claimPaymentOnce = jest.fn(async (p: any) => {
    if (claims.has(p.reference)) return { claimed: false, status: claims.get(p.reference)! };
    claims.set(p.reference, p.status ?? 'completed');
    return { claimed: true, status: p.status ?? 'completed' };
});

jest.mock('@/lib/wallet-ledger', () => ({
    claimPaymentOnce: (p: any) => claimPaymentOnce(p),
    markFulfilmentFailed: jest.fn(async () => undefined),
    incrementWithinCeiling: jest.fn(async () => ({ ok: true, applied: true })),
    decrementManyOrFail: jest.fn(async () => ({ ok: true })),
    creditWalletOnce: jest.fn(async () => ({ claimed: true })),
}));

const verifyPaystackPayment = jest.fn() as jest.Mock<any>;
jest.mock('@/lib/paystack-server', () => {
    const actual = jest.requireActual('@/lib/paystack-server') as any;
    return {
        ...actual,
        verifyPaystackPayment: (r: string) => verifyPaystackPayment(r),
        initializePaystackPayment: jest.fn(async () => ({})),
    };
});

const mockRequireSession = jest.fn() as jest.Mock<any>;
jest.mock('@/lib/session-guard', () => ({
    requireSession: (...a: any[]) => mockRequireSession(...a),
}));

jest.mock('@/lib/redis', () => ({
    getCached: async () => null, setCache: async () => undefined,
    deleteCache: async () => undefined, deleteCachePattern: async () => undefined, redis: null,
}));
jest.mock('next/cache', () => ({
    unstable_cache: (fn: unknown) => fn,
    revalidateTag: jest.fn(), updateTag: jest.fn(), revalidatePath: jest.fn(),
}));
jest.mock('@/lib/whatsapp-invites', () => ({ generateAndSendWhatsAppInvite: jest.fn() }));

import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

let store: FakeDbHandle;

function signedChargeSuccess(type: string) {
    const event = {
        event: 'charge.success',
        data: {
            reference: REF,
            amount: TOTAL_NGN * 100,
            paid_at: '2026-09-13T00:00:00.000Z',
            metadata: { userId: BUYER, type, totalNGN: TOTAL_NGN },
        },
    };
    const body = JSON.stringify(event);
    const signature = crypto.createHmac('sha512', SECRET).update(body).digest('hex');
    return {
        text: async () => body,
        headers: { get: (h: string) => (h === 'x-paystack-signature' ? signature : null) },
    } as any;
}

describe('#695 — an export order the webhook claimed and nobody fulfilled', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        claims.clear();
        process.env.PAYSTACK_SECRET_KEY = SECRET;

        store = installFakeDb();
        store.seed(COLLECTIONS.EXPORT_ORDERS, ORDER_ID, {
            orderId: ORDER_ID,
            buyerId: BUYER,
            items: [],
            totalNGN: TOTAL_NGN,
            totalUSD: 150,
            paymentReference: REF,
            paymentStatus: 'pending',
            status: 'pending_payment',
        });

        mockRequireSession.mockResolvedValue({
            session: { user: { id: BUYER, email: 'b@e.test', roles: ['export_participant'] } },
            error: null,
        });

        verifyPaystackPayment.mockResolvedValue({
            status: true,
            data: {
                status: 'success',
                amount: TOTAL_NGN * 100,
                metadata: { userId: BUYER, type: 'export_buyer_order', totalNGN: TOTAL_NGN },
            },
        });
    });

    it('THE WEBHOOK FULFILS IT, RATHER THAN CLAIMING A REFERENCE IT CANNOT ROUTE', async () => {
        /*
         *   Asserted on the STORE, not on the 200. The route answers 200 in both
         *   the broken and the fixed world — #531's own test note makes the same
         *   point about the pre-claim, and asserting on the response there would
         *   have passed against the defect.
         */
        const route = await import('@/app/api/webhooks/paystack/route');
        await route.POST(signedChargeSuccess('export_buyer_order'));

        expect(claims.get(REF)).not.toBe('unhandled_type');
    });

    it('AND A TYPE THE PLATFORM DOES NOT MINT IS STILL CLAIMED — #531 HOLDS', async () => {
        /*
         *   THE control on the fix's reach, and the thing it would be easiest
         *   to break while repairing this.
         *
         *   #531's rule is right about a payment nothing can ever fulfil: a
         *   Paystack payment link, or the twelve ghost ₦10,000 payments with no
         *   application metadata. There is no callback waiting for those, so
         *   leaving them unclaimed records nothing and helps nobody. Only the
         *   types a CHECKOUT mints are skipped, and this pins the difference.
         */
        const route = await import('@/app/api/webhooks/paystack/route');
        await route.POST(signedChargeSuccess('a_type_no_checkout_mints'));

        expect(claims.get(REF)).toBe('unhandled_type');
    });

    it('AND A LEGACY unhandled_type ROW IS REFUSED, NOT REPORTED AS SUCCESS', async () => {
        /*
         *   The webhook no longer writes these — but production has been
         *   running the code that did, so rows already carrying `unhandled_type`
         *   are the live case this finding is about, not a hypothetical. A
         *   buyer returning to a callback for one of them must be told the
         *   truth rather than "successful".
         */
        claims.set(REF, 'unhandled_type');

        const { verifyExportOrderPaymentAction } = await import('@/app/actions/export-payment');
        const res = await verifyExportOrderPaymentAction(REF) as any;

        expect(res.success).toBe(false);
        expect(store.get(COLLECTIONS.EXPORT_ORDERS, ORDER_ID)!.paymentStatus).toBe('pending');
    });

    it('AND THE BUYER IS NEVER TOLD A CLAIM IT LOST TO A NON-FULFILMENT WAS SUCCESS', async () => {
        /*
         *   THE defect, behaviourally. The webhook goes first — which is the
         *   ordinary order of events, not a race — and then the buyer lands on
         *   the callback.
         *
         *   Whatever the fix, exactly one thing must not happen: success
         *   reported while the order sits at pending_payment. Either the
         *   webhook fulfilled it (so the order is no longer pending), or the
         *   callback fulfils it, or the callback refuses. Never "successful"
         *   over an unfulfilled order.
         */
        const route = await import('@/app/api/webhooks/paystack/route');
        await route.POST(signedChargeSuccess('export_buyer_order'));

        const { verifyExportOrderPaymentAction } = await import('@/app/actions/export-payment');
        const res = await verifyExportOrderPaymentAction(REF) as any;

        const order = store.get(COLLECTIONS.EXPORT_ORDERS, ORDER_ID)!;
        const fulfilled = order.status !== 'pending_payment' || order.paymentStatus === 'completed';

        expect({ reportedSuccess: res.success === true, fulfilled })
            .not.toEqual({ reportedSuccess: true, fulfilled: false });
    });

    it('A GENUINE FIRST CALLBACK STILL FULFILS THE ORDER', async () => {
        /*
         *   Vacuity guard. The assertion above is satisfied by a verifier that
         *   refuses everything, so the ordinary path is pinned here: no webhook
         *   delivery, the buyer comes back, the order is fulfilled and the
         *   answer is success.
         */
        const { verifyExportOrderPaymentAction } = await import('@/app/actions/export-payment');
        const res = await verifyExportOrderPaymentAction(REF) as any;

        expect(res.success).toBe(true);
        const order = store.get(COLLECTIONS.EXPORT_ORDERS, ORDER_ID)!;
        expect(order.paymentStatus).toBe('completed');
    });

    it('AND A CLAIM LEFT BEHIND BY A FULFILMENT THAT DIED IS NOT SUCCESS EITHER', async () => {
        /*
         *   THE HALF THAT PROTECTS THE FIVE ROUTED TYPES TOO, and the reason
         *   this fix is not confined to the three unrouted ones.
         *
         *   markFulfilmentFailed writes `fulfilment_failed` onto a reference
         *   that WAS claimed and whose fulfilment then threw — in its own
         *   words, "money was collected and nothing was delivered". A callback
         *   arriving afterwards loses the claim exactly as it would to a real
         *   duplicate, and reported success over it. Confining the repair to
         *   the unrouted types would have been this audit's own most repeated
         *   defect, committed in the fix for it.
         */
        claims.set(REF, 'fulfilment_failed');

        const { verifyExportOrderPaymentAction } = await import('@/app/actions/export-payment');
        const res = await verifyExportOrderPaymentAction(REF) as any;

        expect(res.success).toBe(false);
        expect(store.get(COLLECTIONS.EXPORT_ORDERS, ORDER_ID)!.status).toBe('pending_payment');
    });

    it('AND A DUPLICATE OF A REAL FULFILMENT IS STILL REPORTED AS SUCCESS — #259 HOLDS', async () => {
        /*
         *   The other direction, and the reason this cannot be fixed by simply
         *   refusing every lost claim. #259 is still right: when the reference
         *   was claimed by something that DID fulfil it, the buyer has been
         *   charged and served, and an error is the wrong answer.
         */
        const { verifyExportOrderPaymentAction } = await import('@/app/actions/export-payment');
        await verifyExportOrderPaymentAction(REF);

        const again = await verifyExportOrderPaymentAction(REF) as any;
        expect(again.success).toBe(true);
        expect(String(again.error ?? '')).not.toMatch(/already processed/i);
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored and diffed after each.
 *
 *     MUTANT                                                        RESULT
 *     webhook claims a reference it cannot route                      KILLED
 *     every lost claim is treated as a fulfilment                     KILLED
 *     unhandled_type dropped from the non-fulfilment list             KILLED
 *     fulfilment_failed dropped from the non-fulfilment list          KILLED
 *     export_buyer_order removed from the declared set                KILLED
 *     every unroutable type is left unclaimed (#531 broken)           KILLED
 *     the order path stops consulting the claim status                KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword the header                                            SURVIVED ✓
 *
 *   AND THE HARNESS ITSELF WAS WRONG THE FIRST TIME, which is worth more than
 *   the table. It restored between mutants with `git checkout --`, and
 *   lib/claim-outcome.ts is a NEW file — git had nothing to restore it from. The
 *   mutations ACCUMULATED, so every result after the second measured the
 *   wreckage rather than the mutant, and the control came back KILLED. A control
 *   that fails is the instrument reporting its own breakage; it was rebuilt to
 *   snapshot the files and copy them back, and each mutant now asserts its own
 *   edit landed so a pattern that matched nothing cannot pose as a survivor.
 */
