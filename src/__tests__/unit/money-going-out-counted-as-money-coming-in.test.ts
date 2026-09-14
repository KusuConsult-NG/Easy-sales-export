/**
 * @jest-environment node
 */

/**
 *   #746 A MEMBER'S OWN MONEY COMING BACK WAS SUMMED AS PLATFORM REVENUE.
 *
 *   `creditWalletOnce` carries a `status` that decides whether the credit is
 *   counted as income. Its own header says so, and names the two values that
 *   are not:
 *
 *       "platform_revenue_totals() sums rows whose raw_data->>'status' is
 *        'completed':
 *          - 'refund'       — money returned to a user
 *          - 'disbursement' — platform money paid OUT to a user"
 *
 *   The migration agrees, on both figures the owner reads:
 *
 *       WHERE p.raw_data ->> 'status' = 'completed'
 *
 *   The field was OPTIONAL and defaulted to "completed". Thirteen of fourteen
 *   callers passed the right thing. The fourteenth is the reversal that returns
 *   a member's money when their bank account cannot be resolved — it passed
 *   nothing, so every reversed withdrawal added its own amount to total_revenue
 *   and one to transaction_count.
 *
 * ── THE RULE WAS WRITTEN TWO HUNDRED LINES BELOW IT, IN THE SAME FILE ───────
 *
 *   actions/wallet.ts has TWO withdrawal reversals. The other one — a
 *   withdrawal an admin rejected — carries the reasoning in place:
 *
 *       "Recorded as 'refund' rather than 'completed': global-aggregation sums
 *        completed rows as revenue, and money going back out is not revenue."
 *
 *   One of the two had it. This audit's most common shape, at its shortest
 *   distance yet: same file, same function name, same money, one of two.
 *
 * ── REQUIRED, NOT DEFAULTED ─────────────────────────────────────────────────
 *
 *   `status` is a required field now rather than an optional one with a
 *   revenue-shaped default. The safe answer to "did the platform earn this?" is
 *   not "yes", and a caller who has not thought about it should not compile.
 *
 *   That is what makes the fix hold for the fifteenth caller as well as these
 *   fourteen — a ratchet the type system runs, not one a sweep has to
 *   remember. The sweep below still exists, because a required field can be
 *   satisfied with the wrong value and only the sweep can say the population
 *   is still sane.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file. The table
 *   was written BEFORE the sweep ran, which is the wrong order and is recorded
 *   rather than tidied away; the sweep was then run in full and every row below
 *   is its actual result.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

const ROOT = process.cwd();
const code = (rel: string) => stripComments(readFileSync(join(ROOT, rel), 'utf-8'), { label: rel });

interface CreditCall { file: string; status: string | null; reference: string | null; }

/**
 * Every `creditWalletOnce({ … })` in the source, with the status it passes.
 *
 *   BRACE-BALANCED, NOT A FIXED WINDOW. My first pass at this read twelve lines
 *   after each call and reported FOUR sites as passing no status. Two of them
 *   pass one on a later line — a ternary on `resolution` — so the window cut
 *   the answer off and the finding was twice the size it really is. Counting by
 *   proximity is guessing; the call object has an end and this finds it.
 */
function creditCalls(): CreditCall[] {
    const out: CreditCall[] = [];
    const files: string[] = [];
    const walk = (d: string) => {
        for (const e of readdirSync(d)) {
            const f = join(d, e);
            if (statSync(f).isDirectory()) {
                if (e !== '__tests__' && e !== 'node_modules') walk(f);
                continue;
            }
            if (/\.tsx?$/.test(e)) files.push(f);
        }
    };
    walk(join(ROOT, 'src'));

    for (const f of files) {
        if (f.endsWith('wallet-ledger.ts')) continue;   // the definition, not a caller
        const src = code(f.slice(ROOT.length + 1));
        let at = src.indexOf('creditWalletOnce({');
        while (at !== -1) {
            const open = src.indexOf('{', at + 'creditWalletOnce('.length - 1);
            let depth = 0, end = open;
            for (; end < src.length; end++) {
                if (src[end] === '{') depth++;
                else if (src[end] === '}') { depth--; if (depth === 0) break; }
            }
            const call = src.slice(open, end + 1);
            out.push({
                file: f.slice(ROOT.length + 1),
                status: call.match(/status:\s*([^,\n]+)/)?.[1].trim() ?? null,
                reference: call.match(/reference:\s*([^,\n]+)/)?.[1].trim() ?? null,
            });
            at = src.indexOf('creditWalletOnce({', end);
        }
    }
    return out;
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#746 — every wallet credit states whether it is revenue', () => {
    it('NOT ONE OF THEM LEAVES IT TO THE DEFAULT', () => {
        const silent = creditCalls().filter((c) => c.status === null).map((c) => c.file);
        expect(silent).toEqual([]);
    });

    it('AND THE SWEEP FOUND THE CALLS, SO [] MEANS CLEAN', () => {
        //   #741's lesson: at zero, a sweep pointed at nothing is
        //   indistinguishable from a clean tree.
        const calls = creditCalls();

        expect(calls.length).toBeGreaterThanOrEqual(12);
        expect(calls.map((c) => c.file)).toContain('src/app/actions/wallet.ts');
        expect(calls.map((c) => c.file)).toContain('src/app/actions/loan-actions.ts');
    });

    it('AND ONLY MONEY ACTUALLY ARRIVING IS MARKED completed', () => {
        /*
         *   The substance. A required field can be satisfied with the wrong
         *   value, so the population is checked rather than merely its
         *   completeness.
         *
         *   Exactly one credit on the platform is revenue: a member funding
         *   their wallet through the gateway. Everything else — an escrow
         *   release, a loan disbursement, a dispute payout, a refund, a
         *   reversal — is the platform paying money OUT.
         */
        const revenue = creditCalls().filter((c) => c.status === '"completed"');

        expect(revenue).toHaveLength(1);
        expect(revenue[0].file).toBe('src/app/actions/wallet.ts');
    });

    it('AND NO REVERSAL OR REFUND IS AMONG THEM', () => {
        //   Stated by what the reference says the credit IS, independently of
        //   the status it claims — so a reversal relabelled "completed" fails
        //   here even though the assertion above counts one either way.
        const mislabelled = creditCalls()
            .filter((c) => /REVERSAL|refund/i.test(c.reference ?? ''))
            .filter((c) => c.status === '"completed"');

        expect(mislabelled).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#746 — the reversal that was counted, and its sibling that was not', () => {
    const WALLET = 'src/app/actions/wallet.ts';

    it('BOTH WITHDRAWAL REVERSALS ARE NOW MARKED refund', () => {
        const both = creditCalls()
            .filter((c) => c.file === WALLET)
            .filter((c) => /WITHDRAW-REVERSAL|withdrawal-refund/.test(c.reference ?? ''));

        expect(both).toHaveLength(2);
        for (const c of both) expect(c.status).toBe('"refund"');
    });

    it('AND THE ONE THAT WAS ALREADY RIGHT STILL CARRIES ITS REASONING', () => {
        //   Not deleted or reworded while fixing its neighbour: the sentence is
        //   how this finding was recognisable at all.
        const raw = readFileSync(join(ROOT, WALLET), 'utf-8');
        expect(raw).toContain('money going back out is not revenue');
    });

    it('AND THE REPAIRED ONE SAYS WHAT IT IS, NOT ONLY WHAT IT IS NOT', () => {
        //   The sibling records paymentType and source; this one recorded
        //   neither, so the ledger row was anonymous as well as miscounted.
        const src = code(WALLET);
        const at = src.indexOf('WITHDRAW-REVERSAL-');
        const call = src.slice(at, at + 300);

        expect(call).toContain('paymentType: "withdrawal_reversal"');
        expect(call).toContain('source: "wallet_withdrawal_unresolved_account"');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#746 — and the figure this feeds really is keyed on that status', () => {
    it('THE MIGRATION SUMS ONLY completed ROWS', () => {
        /*
         *   The premise, read from the migration rather than asserted. If the
         *   aggregate ever stops filtering on status, every `status` above
         *   becomes decoration and this is where a reader finds out.
         */
        const sql = readFileSync(join(ROOT, 'supabase/migrations/012_platform_metrics.sql'), 'utf-8');
        expect(sql).toContain("raw_data ->> 'status' = 'completed'");
    });

    it('AND THE TYPE NO LONGER LETS A CALLER SKIP THE QUESTION', () => {
        //   Required, not optional-with-a-revenue-shaped-default. This is the
        //   half that reaches the fifteenth caller.
        const ledger = code('src/lib/wallet-ledger.ts');
        expect(ledger).toContain('status: "completed" | "refund" | "disbursement";');
        expect(ledger).not.toContain('status?: "completed" | "refund" | "disbursement";');
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored from a snapshot copy
 *   keyed by full path, each mutant proving its edit landed by a unique string
 *   on disk.
 *
 *     MUTANT                                                        RESULT
 *     the reversal goes back to no status                            KILLED
 *     the reversal is marked completed instead                       KILLED
 *     the reversal loses its paymentType and source                  KILLED
 *     a second call site is marked completed                         KILLED
 *     the status field becomes optional again                        KILLED
 *     the sweep's brace matching is replaced by a fixed window       KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                             SURVIVED ✓
 */
