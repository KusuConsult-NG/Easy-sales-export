/**
 * @jest-environment node
 */

/**
 *   #911 IT CALLED ITSELF CANONICAL AND HELD SIX OF THE THIRTEEN.
 *
 *   Found while auditing src/lib/export-order-fulfilment.ts — one of the files
 *   no test had named. The module is carefully reasoned and its header states
 *   its own limits, so the defect is not in it: it is in the vocabulary it has
 *   to write into, and it shows up there as a write that could not be guarded.
 *
 * ── THE MEASUREMENT ─────────────────────────────────────────────────────────
 *
 *   PAYMENT_STATUS is introduced as "Canonical payment status values used
 *   across all modules. Use these constants everywhere instead of raw strings."
 *   It held six: pending, paid, completed, failed, unpaid, processing.
 *
 *   A derived sweep — every literal this application writes into a
 *   `paymentStatus` field, comments stripped — found ten more write sites
 *   carrying seven values that were not in it:
 *
 *       escrow_held           payments/service, marketplace/_payment_verify
 *       paid_to_seller        marketplace/_escrow_actions, cron/release-escrow
 *       paid_awaiting_refund  marketplace/_payment_verify, export-order-fulfilment
 *       refunded              export-admin
 *       pending_verification  marketplace/_payment_orders
 *       pending_review        payments/service
 *       cancelled             marketplace/_buyer
 *
 *   Not one is a second spelling of something already on the list. Each is a
 *   distinct thing that happened to somebody's money, and four of the seven are
 *   the states where the platform is holding it or owes it back.
 *
 * ── WHAT THE OMISSION COST, AT TWO PLACES ───────────────────────────────────
 *
 *   1. THE WRITE GUARD COULD NOT BE USED ON THE WRITES THAT MATTER.
 *
 *      write-guard builds `PaymentStatusWriteSchema` as
 *      `z.enum(Object.values(PAYMENT_STATUS))`, and writeGuard THROWS on a
 *      violation. So all ten writes had to stay bare, and the guard is applied
 *      at exactly two sites — export-payment and export-order-fulfilment —
 *      BOTH writing `completed`, the one value never in doubt.
 *
 *      A validator applied only where it cannot fail has never constrained
 *      anything. And it was a loaded trap: in export-order-fulfilment the
 *      guarded `completed` write sits twenty lines below the unguarded
 *      `paid_awaiting_refund` one, so the obvious tidy-up — make the second
 *      match the first — throws at the moment a buyer has paid for stock that
 *      is not there. The order is never marked, the reconcile-fulfilment cron's
 *      `where("paymentStatus", "==", "paid_awaiting_refund")` never finds it,
 *      refundExportOrderAction's `!== "paid_awaiting_refund"` gate refuses it,
 *      and the money sits there with nothing pointing at it.
 *
 *   2. normalisePaymentStatus ANSWERED "pending" WHERE THE MONEY HAD MOVED.
 *
 *      Every one of the seven fell through to its final
 *      `return PAYMENT_STATUS.PENDING`. So the function exported beside the
 *      constant, named for normalising "any payment status variant", answered
 *      `pending` for escrow_held, paid_to_seller, paid_awaiting_refund and
 *      refunded: "we owe this buyer a refund" and "the seller has been paid"
 *      both read back as "payment not made yet".
 *
 *      MEASURED: nothing imports that function — `grep -rln
 *      normalisePaymentStatus src` returns only its own file — so it is a trap
 *      rather than a leak, and it is recorded as a trap. It is the shape of
 *      #349 and #773 all the same: a reader narrower than its writers,
 *      answering confidently.
 *
 * ── AND THE TEST THAT PINNED IT ─────────────────────────────────────────────
 *
 *   lib/__tests__/payment-status.test.ts already covered that function —
 *   eighteen cases, all green. Its first case is "maps canonical values to
 *   themselves" and it lists the six. It asserts that `banana` and `xyz123`
 *   answer `pending` — correctly — and never asks what `paid_awaiting_refund`
 *   answers.
 *
 *   IT ENUMERATED THE CONSTANT INSTEAD OF THE APPLICATION. That is why the
 *   sweep below is derived from the source rather than from a list: a list
 *   written beside the thing it checks agrees with it by construction. Same
 *   argument as the-files-no-test-had-named's denominator, and #436's before it.
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { stripComments } from '@/lib/testing/strip-comments';
import { ledgerVerdict, LEDGER_HELD } from '@/lib/testing/ledger';
import { PAYMENT_STATUS, normalisePaymentStatus } from '@/lib/types/firestore';
import { writeGuard, PaymentStatusWriteSchema } from '@/lib/write-guard';

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            if (entry !== 'node_modules') walk(full, out);
        } else if (/\.tsx?$/.test(full)) {
            out.push(full);
        }
    }
    return out;
}

const isTest = (f: string) => /__tests__|\.test\./.test(f);

/**
 * Every `paymentStatus: "literal"` this application writes, by file.
 *
 * COMMENTS ARE STRIPPED FIRST, and that is not ceremony. write-guard's own
 * header contains
 *
 *     paymentStatus: 'successful' }
 *
 * as the example of a bad write, and _payment_verify's header names
 * `"paid_awaiting_refund"` in prose. A sweep that reads comments counts the
 * explanation as an instance — this repo has recorded that trap twice, and I
 * hit it once more during this same audit.
 */
function paymentStatusWrites(): { value: string; file: string }[] {
    const out: { value: string; file: string }[] = [];

    for (const file of walk(join(ROOT, 'src'))) {
        if (isTest(file)) continue;
        const raw = readFileSync(file, 'utf8');
        if (!raw.includes('paymentStatus')) continue;

        //   No minRetainedRatio here, deliberately. Several small pages in this
        //   repo are four lines of code under nineteen lines of comment — they
        //   are SUPPOSED to strip to almost nothing, and a per-file floor
        //   rejects them (it rejected cooperatives/onboarding/pending-payment on
        //   the first run). failOnRunawayString covers the trap that actually
        //   matters, the `//*` inside a string literal, and the corpus-wide
        //   control above proves the stripper is not eating the application.
        const code = stripComments(raw, { label: relative(ROOT, file), failOnRunawayString: true });
        const re = /paymentStatus\s*:\s*['"]([a-z_]+)['"]/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(code)) !== null) {
            out.push({ value: m[1], file: relative(ROOT, file) });
        }
    }

    return out;
}

let cached: { value: string; file: string }[] | null = null;
const writes = () => (cached ??= paymentStatusWrites());

/** The seven the sweep found, which the vocabulary now holds. */
const THE_SEVEN = [
    'escrow_held',
    'paid_to_seller',
    'paid_awaiting_refund',
    'refunded',
    'pending_verification',
    'pending_review',
    'cancelled',
] as const;

describe('#911 — the sweep is reading the application', () => {
    it('THE CONTROL: it finds the writes that are obviously there', () => {
        //   First, because every assertion below is about a list and an empty
        //   list agrees with almost any expectation. `completed` is written
        //   everywhere; a sweep that cannot see it is broken, and a broken
        //   sweep reports the orphan count as zero.
        const found = writes();

        expect(found.length).toBeGreaterThan(50);
        expect(found.filter((w) => w.value === 'completed').length).toBeGreaterThan(30);
    });

    it('AND THE COMMENTS ARE REALLY STRIPPED (control)', () => {
        //   write-guard's header carries `paymentStatus: 'successful' }` as its
        //   example of the defect. If that is counted, the sweep reports an
        //   orphan that no code writes — and I would then have "fixed" a
        //   comment by adding `successful` to the canonical list, which is a
        //   duplicate spelling of `paid` and exactly what should NOT be there.
        const fromWriteGuard = writes().filter((w) => w.file === 'src/lib/write-guard.ts');

        expect(fromWriteGuard).toEqual([]);
        expect(writes().some((w) => w.value === 'successful')).toBe(false);
    });
});

describe('#911 — every value the application writes is in the vocabulary', () => {
    it('THE LEDGER — paymentStatus literals with no canonical constant', () => {
        const known = new Set(Object.values(PAYMENT_STATUS) as string[]);
        const orphans = [...new Set(writes().filter((w) => !known.has(w.value)).map((w) => w.value))].sort();

        //   Zero, and a ledger rather than a ceiling so a re-introduction is
        //   reported instead of absorbed. The message names the offenders,
        //   because "there are 3" sends the next reader back to the sweep.
        expect(
            orphans.length === 0
                ? LEDGER_HELD
                : `${ledgerVerdict(orphans.length, 0)} — ${orphans.join(', ')}`,
        ).toBe(LEDGER_HELD);
    });

    it('and the seven the sweep found are each present, by name', () => {
        //   Named individually rather than counted. A count is satisfied by any
        //   seven additions; this asserts THESE seven, which is what the ten
        //   write sites actually need.
        for (const value of THE_SEVEN) {
            expect(Object.values(PAYMENT_STATUS)).toContain(value);
        }
    });

    it('POSITIVE CONTROL: the check can still find an orphan', () => {
        //   The guard on the assertion above. If `known` somehow contained
        //   everything — a widened type, a Set built from the wrong thing — the
        //   ledger would read zero forever.
        const known = new Set(Object.values(PAYMENT_STATUS) as string[]);

        expect(known.has('escrow_held')).toBe(true);
        expect(known.has('paid_awaiting_the_third_moon')).toBe(false);
    });
});

describe('#911 — normalisePaymentStatus stops calling a moved payment "pending"', () => {
    it('ANSWERS FOR EACH OF THE SEVEN, INSTEAD OF pending', () => {
        //   The defect, directly. Before the fix every one of these returned
        //   'pending' through the fallthrough — including the two that mean the
        //   platform is holding the money and the one that means it owes it
        //   back.
        for (const value of THE_SEVEN) {
            expect(normalisePaymentStatus(value)).toBe(value);
        }
    });

    it('SPELLED OUT for the four where money has actually moved', () => {
        //   The loop above would pass if normalisePaymentStatus became the
        //   identity function. These four are the ones whose wrong answer was
        //   a lie about money, so they are asserted against the constants
        //   rather than against their own input.
        expect(normalisePaymentStatus('escrow_held')).toBe(PAYMENT_STATUS.ESCROW_HELD);
        expect(normalisePaymentStatus('paid_to_seller')).toBe(PAYMENT_STATUS.PAID_TO_SELLER);
        expect(normalisePaymentStatus('paid_awaiting_refund')).toBe(PAYMENT_STATUS.PAID_AWAITING_REFUND);
        expect(normalisePaymentStatus('refunded')).toBe(PAYMENT_STATUS.REFUNDED);

        //   None of them is pending, which is what each one used to be.
        for (const value of ['escrow_held', 'paid_to_seller', 'paid_awaiting_refund', 'refunded']) {
            expect(normalisePaymentStatus(value)).not.toBe(PAYMENT_STATUS.PENDING);
        }
    });

    it('and case-folds them like every other value', () => {
        expect(normalisePaymentStatus('PAID_AWAITING_REFUND')).toBe(PAYMENT_STATUS.PAID_AWAITING_REFUND);
        expect(normalisePaymentStatus('  Escrow_Held  ')).toBe(PAYMENT_STATUS.ESCROW_HELD);
    });

    it('THE LEGACY FOLDS ARE UNTOUCHED', () => {
        //   `successful` and `success` are real historical spellings of `paid`
        //   and must keep folding. Adding them to the canonical list would have
        //   made this pass for the wrong reason — a second spelling blessed —
        //   which is why the sweep control above insists no code writes it.
        expect(normalisePaymentStatus('successful')).toBe(PAYMENT_STATUS.PAID);
        expect(normalisePaymentStatus('success')).toBe(PAYMENT_STATUS.PAID);
        expect(normalisePaymentStatus('successful_payment')).toBe(PAYMENT_STATUS.COMPLETED);
        expect(normalisePaymentStatus('paid_completed')).toBe(PAYMENT_STATUS.COMPLETED);
        expect(normalisePaymentStatus('declined')).toBe(PAYMENT_STATUS.FAILED);
        expect(normalisePaymentStatus('pending_payment')).toBe(PAYMENT_STATUS.PENDING);
    });

    it('a value nobody writes still answers pending — AND SAYS SO', () => {
        //   The fallthrough stays. A string the platform has never written is a
        //   different question from the seven it writes daily, and `pending`
        //   claims nothing about money having moved, so it remains the safest
        //   answer. What changes is that it is no longer SILENT: answering
        //   confidently without a basis is the mechanism this whole finding is
        //   about.
        const warn = jest.spyOn(require('@/lib/logger').logger, 'warn').mockImplementation(() => {});

        try {
            expect(normalisePaymentStatus('banana')).toBe(PAYMENT_STATUS.PENDING);
            expect(warn).toHaveBeenCalledTimes(1);
            expect(String((warn.mock.calls[0] as unknown[])[0])).toContain('banana');
        } finally {
            warn.mockRestore();
        }
    });

    it('and null/undefined/empty do NOT warn — they are answered, not guessed', () => {
        //   An absent status is a legitimate state of a row that has never been
        //   paid. Warning on it would make the log useless for finding the case
        //   that matters.
        const warn = jest.spyOn(require('@/lib/logger').logger, 'warn').mockImplementation(() => {});

        try {
            expect(normalisePaymentStatus(null)).toBe(PAYMENT_STATUS.PENDING);
            expect(normalisePaymentStatus(undefined)).toBe(PAYMENT_STATUS.PENDING);
            expect(normalisePaymentStatus('')).toBe(PAYMENT_STATUS.PENDING);
            expect(warn).not.toHaveBeenCalled();
        } finally {
            warn.mockRestore();
        }
    });
});

describe('#911 — the write guard can now describe the writes that matter', () => {
    it('ACCEPTS paid_awaiting_refund, which it used to throw on', () => {
        const write = () => writeGuard(
            PaymentStatusWriteSchema.partial(),
            { paymentStatus: PAYMENT_STATUS.PAID_AWAITING_REFUND, status: 'cancelled_out_of_stock' },
            'test',
        );

        expect(write).not.toThrow();
        //   And it is a validator, not a filter — the fields the schema says
        //   nothing about survive. That property is load-bearing at both call
        //   sites, which write four and eight fields respectively.
        expect(write()).toEqual({
            paymentStatus: 'paid_awaiting_refund',
            status: 'cancelled_out_of_stock',
        });
    });

    it('accepts all seven', () => {
        for (const value of THE_SEVEN) {
            expect(() => writeGuard(
                PaymentStatusWriteSchema.partial(),
                { paymentStatus: value },
                'test',
            )).not.toThrow();
        }
    });

    it('AND HAS NOT BECOME A RUBBER STAMP', () => {
        //   The risk of the fix. Widening an enum until it accepts everything
        //   is not a fix, it is deleting the check — and it would read as a
        //   pass on every assertion above.
        expect(() => writeGuard(
            PaymentStatusWriteSchema.partial(),
            { paymentStatus: 'banana' },
            'test',
        )).toThrow(/writeGuard/);

        expect(() => writeGuard(
            PaymentStatusWriteSchema.partial(),
            { paymentStatus: 'successful' },
            'test',
        )).toThrow(/writeGuard/);
    });
});

describe('#911 — both out-of-stock refund writes are guarded', () => {
    /**
     * Source assertions, comments stripped.
     *
     * The comment I added at each site NAMES the thing being asserted
     * ("paymentStatus: paid_awaiting_refund", "writeGuard"), so an unstripped
     * read is satisfied by my own explanation. That is the trap this repo
     * records and the one I hit earlier in this same audit; it is cheap to
     * avoid and it makes the assertion worthless if you don't.
     */
    const code = (rel: string) =>
        stripComments(readFileSync(join(ROOT, rel), 'utf8'), { label: rel, minRetainedRatio: 0.3 });

    it('export-order-fulfilment guards it, like its `completed` write', () => {
        const src = code('src/lib/export-order-fulfilment.ts');

        //   Two guarded writes now, where there was one.
        expect(src.match(/writeGuard\(/g)?.length).toBe(2);
        expect(src).toContain('PAYMENT_STATUS.PAID_AWAITING_REFUND');
        //   And the bare literal is gone from the code, so the value is written
        //   through the vocabulary rather than beside it.
        expect(src).not.toContain('"paid_awaiting_refund"');
    });

    it('marketplace/_payment_verify guards it too', () => {
        const src = code('src/app/actions/marketplace/_payment_verify.ts');

        expect(src).toContain('writeGuard(');
        expect(src).toContain('PAYMENT_STATUS.PAID_AWAITING_REFUND');
        expect(src).not.toContain('"paid_awaiting_refund"');
    });

    it('POSITIVE CONTROL: the stripper left real code behind', () => {
        //   A `not.toContain` passes on an empty string. Both assertions above
        //   are one, and strip-comments' own header records a case where the
        //   naive stripper returned essentially an empty file — so this insists
        //   the source is still there to have been searched.
        const src = code('src/lib/export-order-fulfilment.ts');

        expect(src.length).toBeGreaterThan(2_000);
        expect(src).toContain('fulfilExportBuyerOrder');
        expect(src).toContain('cancelled_out_of_stock');
    });
});

/**
 *   RECORDED, NOT FIXED — src/lib/record-export.ts, the other unnamed file this
 *   audit reached in the same pass.
 *
 *   The wrapper itself is sound: thirteen call sites, one promise handled once,
 *   a failure to record logged loudly rather than swallowed, and it cannot block
 *   a download that has already happened. Tested below.
 *
 *   What the sweep found beside it is that #309's guarantee has one screen still
 *   on a private path. /admin/academy/applications — the screen #309's own table
 *   lists as the single one that was ALREADY logged — still calls
 *   logAcademyExportAction rather than recordExport, so the platform has two
 *   ways of recording the same kind of event:
 *
 *       recordExport            metadata { dataset, count, filters }
 *       logAcademyExportAction  metadata { count, filters }   — no dataset
 *
 *   MEASURED before calling it a defect: nothing reads `metadata.dataset`
 *   (`grep -rn 'metadata.dataset' src` finds only the writer), both rows carry
 *   `action: "data_export"` and `targetType: "export"`, and `academy_applications`
 *   is in EXPORTABLE_DATASETS — so no reader misses the academy export today.
 *   It is a second vocabulary for one contract, this audit's other repeated
 *   finding, and the honest severity is that.
 *
 *   The one real difference is worth writing down: the academy screen `await`s
 *   its audit call and ignores a `{ success: false }` answer, then shows
 *   "Exported N applications". recordExport logs. So an academy export that
 *   failed to record tells the admin it succeeded and leaves nothing anywhere;
 *   every other screen's leaves a console error. Not fixed here because pointing
 *   that screen at recordExport retires an exported server action and changes an
 *   awaited call into a fire-and-forget one — a behaviour change to an audit path
 *   bundled into a vocabulary fix, which is the thing export-order-fulfilment's
 *   own header refuses to do about amounts.
 */
describe('#309/#911 — recordExport makes a failed audit row visible', () => {
    const ACTION = '@/app/actions/data-export-audit';

    beforeEach(() => {
        jest.resetModules();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    /**
     * Collect this test's own console.error lines.
     *
     * NOT `expect(spy).toHaveBeenCalledTimes(1)`. That was the first draft and it
     * reported 3, then 4, then 4 — the spy accumulated across the tests in this
     * describe, so every case after the first was asserting the whole file's
     * output. A shared counter is not a measurement of one call.
     *
     * Collecting the lines and filtering to this module's prefix also asserts the
     * thing worth asserting: WHAT the operator is told, not how many times
     * something was told to somebody.
     */
    function captureExportErrors(): { lines: string[] } {
        const lines: string[] = [];
        jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
            lines.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(' '));
        });
        return { lines };
    }

    const exportLines = (lines: string[]) => lines.filter((l) => l.includes('[export]'));

    async function load(recordDataExportAction: (...args: any[]) => Promise<any>) {
        jest.doMock(ACTION, () => ({ recordDataExportAction }));
        return (await import('@/lib/record-export')) as typeof import('@/lib/record-export');
    }

    it('says so, loudly, when the row is REFUSED', async () => {
        const { lines } = captureExportErrors();
        const { recordExport } = await load(async () => ({ success: false, error: 'Unknown dataset' }));

        recordExport('marketplace_sellers', { count: 412 });
        await new Promise((resolve) => setImmediate(resolve));

        const reported = exportLines(lines);
        expect(reported).toHaveLength(1);
        expect(reported[0]).toContain('marketplace_sellers');
        expect(reported[0]).toContain('NOT recorded');
        //   The reason the action gave, not a generic sentence. An audit failure
        //   nobody can diagnose is nearly as useless as a silent one.
        expect(reported[0]).toContain('Unknown dataset');
    });

    it('names a reason even when the action gives none', async () => {
        //   `{ success: false }` with no error. The wrapper says "no reason
        //   given" rather than printing `undefined`, which is the difference
        //   between a log line somebody can act on and one they distrust.
        const { lines } = captureExportErrors();
        const { recordExport } = await load(async () => ({ success: false }));

        recordExport('wave_members', { count: 7 });
        await new Promise((resolve) => setImmediate(resolve));

        const reported = exportLines(lines);
        expect(reported).toHaveLength(1);
        expect(reported[0]).toContain('no reason given');
        expect(reported[0]).not.toContain('undefined');
    });

    it('and when the action REJECTS, rather than letting it become an unhandled rejection', async () => {
        const { lines } = captureExportErrors();
        const { recordExport } = await load(async () => {
            throw new Error('network down');
        });

        expect(() => recordExport('platform_users', { count: 9_001 })).not.toThrow();
        await new Promise((resolve) => setImmediate(resolve));

        const reported = exportLines(lines);
        expect(reported).toHaveLength(1);
        expect(reported[0]).toContain('platform_users');
        expect(reported[0]).toContain('network down');
    });

    it('says nothing when the row is written', async () => {
        const { lines } = captureExportErrors();
        const { recordExport } = await load(async () => ({ success: true }));

        recordExport('audit_logs', { count: 3 });
        await new Promise((resolve) => setImmediate(resolve));

        expect(exportLines(lines)).toEqual([]);
    });

    it('IT IS SYNCHRONOUS — the download is never waiting on the audit row', async () => {
        //   The whole reason the wrapper exists. `recordExport` returns void, so
        //   no call site can accidentally block a file that is already in the
        //   browser, and none of the thirteen can become a bare `void` that
        //   drops the failure.
        let settled = false;
        const { recordExport } = await load(
            () => new Promise((resolve) => setTimeout(() => { settled = true; resolve({ success: true }); }, 50)),
        );

        const returned = recordExport('finance_report');

        expect(returned).toBeUndefined();
        expect(settled).toBe(false);
    });

    it('and it names a dataset with no details at all', async () => {
        //   Several call sites pass only the name. A default of `{}` rather than
        //   a required argument is why, and it is asserted because a thrown
        //   TypeError here would be swallowed by the caller's own try/catch at
        //   most of the thirteen.
        const { lines } = captureExportErrors();
        const calls: unknown[][] = [];
        const { recordExport } = await load(async (...args: unknown[]) => {
            calls.push(args);
            return { success: true };
        });

        recordExport('cooperative_loans');
        await new Promise((resolve) => setImmediate(resolve));

        expect(calls).toEqual([['cooperative_loans', {}]]);
        expect(exportLines(lines)).toEqual([]);
    });
});
