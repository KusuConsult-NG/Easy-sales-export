/**
 * Repair cooperative savings balances understated by the client-verify defect.
 *
 * Run (report only, writes nothing):   npm run repair:savings
 * Run (applies the corrections):       npm run repair:savings -- --apply
 *
 * WHAT WENT WRONG
 * ---------------
 * A cooperative contribution has two confirmation paths, and until now they
 * credited different fields:
 *
 *   processCooperativeContribution (infrastructure/payments/service.ts) — the
 *     Paystack webhook — incremented totalContributions AND savingsBalance.
 *   verifyContributionPaymentAction (cooperative/_payment.ts) — the browser
 *     redirect after checkout — incremented ONLY totalContributions.
 *
 * They are mutually exclusive: claim_payment_once is keyed on the reference
 * alone, so whichever arrived first claimed the payment and the other returned
 * early. Whether a member's SPENDABLE balance went up was therefore decided by
 * a race between their browser and Paystack's webhook.
 *
 * savingsBalance is what withdrawals debit, what loan-repayment-from-savings
 * debits, what the member dashboard shows, and what the borrowing limit is a
 * multiple of. A member who lost that race has money recorded in their lifetime
 * total, in the unified ledger, in the cooperative ledger and in every admin
 * report, that they cannot withdraw and that earns them no borrowing headroom.
 *
 * The code defect is fixed. This repairs the records the defect already made.
 *
 * WHY THIS CAN BE PRECISE RATHER THAN A RECONCILIATION
 * ---------------------------------------------------
 * claim_payment_once stamps `source` onto processed_payments.raw_data. The
 * affected payments are therefore EXACTLY:
 *
 *     source = 'client_verify'
 *
 * No estimation, no ledger-vs-balance diffing, no judgement call about which
 * side is right. Every such row credited totalContributions and not
 * savingsBalance, and every other row credited both.
 *
 * `source` alone is the discriminator, and the query narrows on `type` only as a
 * secondary filter accepting BOTH spellings. The two confirmation paths once
 * passed different type literals for this one event — "contribution" from the
 * webhook, "cooperative_contribution" from the browser — and they have since
 * been unified onto CLAIM_TYPE. Historical rows carry the old name and new rows
 * carry the new one, so matching a single value would miss half of them and
 * report "nothing to do" for exactly the rows this exists to fix.
 *
 * THE ONE CASE THAT IS NOT REPAIRED AUTOMATICALLY
 * ----------------------------------------------
 * The claim is taken BEFORE the credit, deliberately — migration 009 documents
 * the trade — so a fulfilment that failed after claiming leaves a claim row
 * with NEITHER field credited. Repairing savingsBalance there would leave
 * totalContributions short and quietly convert one inconsistency into another.
 *
 * Those are told apart by the ledger. The unified `transactions` row is written
 * with id = reference INSIDE the same block as the totalContributions
 * increment, and AFTER it, so the row existing proves the increment ran. Rows
 * with no ledger entry are reported under STRANDED and left alone — they need a
 * person, not a script.
 *
 * SAFETY
 * ------
 *   - Report-only unless --apply is passed. The report is the same work; only
 *     the write is withheld.
 *   - Idempotent. Each repaired payment is stamped
 *     raw_data.savingsBalanceRepairedAt, and stamped rows are skipped on any
 *     later run. Running twice cannot double-credit.
 *   - Atomic per member. Uses apply_increments (migration 010), the same RPC
 *     the application uses, so a concurrent contribution cannot be lost.
 *   - Credits only. It never reduces a balance. If the correct value is
 *     somehow already present, the worst case is an over-credit that the
 *     stamping prevents on re-run — which is why --apply should follow a
 *     report that has been read.
 *   - Prints the target host before doing anything. This is intended to run
 *     against production; that is stated rather than hidden.
 */

import { createClient } from '@supabase/supabase-js';
import {
    parseAffectedRow,
    buildRepairPlan,
    type AffectedPayment,
} from '../src/lib/savings-repair-plan';
import {
    CLAIM_TYPE,
    LEGACY_COOPERATIVE_CONTRIBUTION_CLAIM_TYPE,
} from '../src/lib/wallet-ledger';
import { existsSync } from 'fs';
import { config as loadEnv } from 'dotenv';
import { isApply, modeBanner, targetHost } from './_maintenance-guard';

// Unlike seed-local.ts, this script is MEANT for the real database, so
// .env.local is loaded. .env.development.local wins if a local stack is up.
if (existsSync('.env.development.local')) loadEnv({ path: '.env.development.local' });
loadEnv({ path: '.env.local' });


/**
 *   #448 THIS SCRIPT DID NOT SAY WHICH DATABASE IT WAS ABOUT TO WRITE TO.
 *
 *        Eight of the eleven writing scripts print `modeBanner(name, apply,
 *        targetHost())` before doing anything — the name, the mode, and the
 *        HOSTNAME the writes travel to. Three did not, and all three are the
 *        ones an operator reaches for when repairing live data.
 *
 *        They survived #329's ratchet because it accepts either `isApply(` or
 *        a literal `'--apply'`, and these hand-rolled the second. The check was
 *        satisfied by an equivalent that skipped the half that matters here:
 *        an operator with the wrong .env loaded got a report identical to the
 *        right one.
 *
 *        Both halves now come from scripts/_maintenance-guard.ts, and targetHost
 *        REFUSES rather than defaulting when the URL is unset — an unknown
 *        target must stop a script, not be waved through.
 */
const APPLY = isApply();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function fail(msg: string): never {
    console.error(`\n❌ ${msg}\n`);
    process.exit(1);
}

if (!url || !serviceKey) {
    fail('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set.');
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

const naira = (n: number) => `₦${n.toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;

/** Every contribution confirmed by the browser path, oldest first. */
async function findAffectedPayments(): Promise<AffectedPayment[]> {
    const out: AffectedPayment[] = [];
    const PAGE = 1000;

    for (let from = 0; ; from += PAGE) {
        // BOTH spellings of the type, and `source` is the real discriminator.
        //
        // This matched only 'cooperative_contribution'. That was the literal the
        // browser-redirect path passed, so it was right — until the two spellings
        // of one event were unified onto CLAIM_TYPE ("contribution", the name
        // already in the database and the one every consumer matches).
        //
        // Narrowing to either single value would now be wrong in one direction or
        // the other: rows written before the unification carry the legacy name,
        // rows written after carry the new one. A repair that recognised only one
        // would report "nothing to do" for precisely the rows it exists to fix,
        // which is the worst failure mode a money repair has.
        //
        // `source = 'client_verify'` is what actually identifies the defect —
        // only that path credited totalContributions without savingsBalance — so
        // the type filter is a secondary narrowing and is deliberately generous.
        const { data, error } = await admin
            .from('processed_payments')
            .select('id, user_id, amount, raw_data')
            .in('raw_data->>type', [
                CLAIM_TYPE.COOPERATIVE_CONTRIBUTION,
                LEGACY_COOPERATIVE_CONTRIBUTION_CLAIM_TYPE,
            ])
            .eq('raw_data->>source', 'client_verify')
            .order('created_at', { ascending: true })
            .range(from, from + PAGE - 1);

        if (error) fail(`Reading processed_payments: ${error.message}`);
        if (!data || data.length === 0) break;

        for (const row of data) {
            const parsed = parseAffectedRow(row as any);
            if (parsed) out.push(parsed);
        }

        if (data.length < PAGE) break;
    }

    return out;
}

/**
 * Which of those references have a unified-ledger row, proving the credit ran.
 * Batched, because `in` has a practical URL-length ceiling.
 */
async function referencesWithLedgerRow(references: string[]): Promise<Set<string>> {
    const found = new Set<string>();
    const BATCH = 200;

    for (let i = 0; i < references.length; i += BATCH) {
        const slice = references.slice(i, i + BATCH);
        const { data, error } = await admin
            .from('transactions')
            .select('id')
            .in('id', slice);

        if (error) fail(`Reading transactions: ${error.message}`);
        for (const row of data ?? []) found.add(String(row.id));
    }

    return found;
}

/** Credit one member, atomically, then stamp the payment so a re-run skips it. */
async function repair(userId: string, references: AffectedPayment[]): Promise<void> {
    const total = references.reduce((sum, r) => sum + r.amount, 0);

    // savingsBalance lives in raw_data — cooperative_members has no native
    // column for it — so it goes in p_json, exactly as supabase-db.ts routes it.
    const { error } = await admin.rpc('apply_increments', {
        p_table: 'cooperative_members',
        p_id: userId,
        p_collection: null,
        p_native: {},
        p_json: { savingsBalance: total },
    });
    if (error) fail(`apply_increments for member ${userId}: ${error.message}`);

    // Stamped only AFTER the credit lands. If the process dies between the two,
    // a re-run credits again — so the stamp is written immediately and the
    // ordering is stated here rather than left to be rediscovered.
    const stampedAt = new Date().toISOString();
    for (const ref of references) {
        const { error: stampErr } = await admin.rpc('apply_document_patch', {
            p_table: 'processed_payments',
            p_id: ref.reference,
            p_collection: null,
            p_patch: { savingsBalanceRepairedAt: stampedAt },
            p_paths: {},
            p_deletes: [],
        });
        if (stampErr) {
            fail(
                `Credited member ${userId} but FAILED to stamp ${ref.reference}: ${stampErr.message}\n` +
                `   Do NOT re-run --apply until this row is stamped by hand, or the member will be credited twice.`
            );
        }
    }
}

async function main() {
    const host = new URL(url).hostname;
    console.log(modeBanner('Savings-balance repair', APPLY, targetHost()));
    console.log(`   Database: ${host}`);
    console.log(`   Mode:     ${APPLY ? '⚠️  APPLY — this will change balances' : 'report only (pass --apply to write)'}\n`);

    const affected = await findAffectedPayments();
    if (affected.length === 0) {
        console.log('✅ No unrepaired client-verified contributions found. Nothing to do.\n');
        return;
    }

    const withLedger = await referencesWithLedgerRow(affected.map(a => a.reference));
    const { repairable, stranded, byMember, totalOwed } = buildRepairPlan(affected, withLedger);

    console.log(`Found ${affected.length} client-verified contribution(s) not yet repaired.`);
    console.log(`  ${repairable.length} have a ledger row — the credit ran, savingsBalance is short.`);
    console.log(`  ${stranded.length} have none — fulfilment did not complete. NOT repaired here.\n`);
    console.log(`Members affected: ${byMember.size}`);
    console.log(`Total to credit:  ${naira(totalOwed)}\n`);

    for (const [userId, payments] of byMember) {
        const sum = payments.reduce((s, p) => s + p.amount, 0);
        console.log(`  ${userId}  +${naira(sum)}  (${payments.length} payment${payments.length === 1 ? '' : 's'})`);
    }

    if (stranded.length > 0) {
        console.log(`\n⚠️  STRANDED — claimed but never fulfilled. These members were credited NOTHING,`);
        console.log(`   not just savingsBalance, so they need a person to decide. Listed, not touched:`);
        for (const s of stranded) {
            console.log(`  ${s.reference}  user=${s.userId}  ${naira(s.amount)}  ${s.processedAt ?? 'unknown date'}`);
        }
    }

    if (!APPLY) {
        console.log(`\n📋 Report only — nothing was written. Re-run with --apply to make these corrections.\n`);
        return;
    }

    console.log(`\n✍️  Applying…`);
    let done = 0;
    for (const [userId, payments] of byMember) {
        await repair(userId, payments);
        done++;
        console.log(`  ✅ ${userId} credited ${naira(payments.reduce((s, p) => s + p.amount, 0))} (${done}/${byMember.size})`);
    }

    console.log(`\n✅ Repaired ${done} member(s), ${naira(totalOwed)} total.`);
    if (stranded.length > 0) {
        console.log(`   ${stranded.length} stranded payment(s) still need attention — see above.`);
    }
    console.log('');
}

main().catch(e => fail(e?.message || String(e)));
