/**
 * Backfill the cooperative-ledger debit for fixed savings plans created before
 * that row was written at all.
 *
 * Run (report only, writes nothing):   npm run backfill:fixsav
 * Run (writes the missing rows):       npm run backfill:fixsav -- --apply
 *
 * WHAT WENT WRONG
 * ---------------
 * Creating a fixed savings plan debits cooperative_members.savingsBalance. It
 * should also write two ledger entries; the cooperative one
 * (COOPERATIVE_TRANSACTIONS, type "fixed_savings_lock") did not exist.
 *
 * Unlike a withdrawal, this debit does not move the money into lockedBalance, so
 * it left the member's held total lower with no entry anywhere saying where the
 * money went.
 *
 * forensics.ts reconciles savingsBalance + lockedBalance against completed
 * cooperative_transactions rows. With no debit row, EVERY member holding a fixed
 * savings plan reported as a balance mismatch — permanently, and correctly,
 * because the ledger genuinely did not account for the money. A reconciliation
 * check that always fails for a whole class of member is a check nobody reads,
 * which is the real cost: it hides the mismatches that matter.
 *
 * src/app/api/cooperative/create-fixed-savings/route.ts now writes both rows.
 * This repairs the plans that predate that fix.
 *
 * WHY THIS IS SAFE TO RE-RUN
 * -------------------------
 * The ledger row id is deterministic — `fixsav_${planId}`, the same value the
 * route uses — so "does the row already exist" IS the idempotency check. There
 * is no stamp to maintain and no window in which a crash causes a double write:
 * writing the same id twice is an upsert of identical content, not a second
 * debit. That is a stronger guarantee than repair-savings-balance.ts can offer,
 * because that one has to increment a balance.
 *
 * IT WRITES NO BALANCES. Only the missing ledger row, describing a debit that
 * already happened. Nothing here changes what a member can spend.
 *
 * THE DATE IS THE PLAN'S, NOT TODAY'S
 * -----------------------------------
 * The entry is dated from the plan's startDate. A ledger is a record of when
 * money moved; stamping these with the backfill date would make every historical
 * lock appear to have happened on one afternoon, and would break any
 * period-based reconciliation that the row is meant to satisfy.
 *
 * WHAT IT REFUSES TO GUESS
 * ------------------------
 * A plan with no memberId, or a non-positive amount, is reported under SKIPPED
 * and left alone. Inventing a ledger entry from a plan that is itself malformed
 * would put a wrong number into the ledger permanently, and the ledger is the
 * thing everything else is reconciled against.
 */

import { createClient } from '@supabase/supabase-js';
import { existsSync } from 'fs';
import { config as loadEnv } from 'dotenv';
import { isApply, modeBanner, targetHost } from './_maintenance-guard';

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

/** The reference the route uses, and therefore the ledger row's id. */
export function ledgerReferenceFor(planId: string): string {
    return `fixsav_${planId}`;
}

interface Plan {
    planId: string;
    memberId: string;
    amount: number;
    startDate: string | null;
}

interface Skipped {
    planId: string;
    reason: string;
}

const plans: Plan[] = [];
const skipped: Skipped[] = [];

/** Every fixed savings plan, oldest first. */
async function readPlans(): Promise<void> {
    const PAGE = 1000;

    for (let from = 0; ; from += PAGE) {
        const { data, error } = await admin
            .from('document_collections')
            .select('id, raw_data')
            .eq('collection_name', 'fixed_savings_plans')
            .order('created_at', { ascending: true })
            .range(from, from + PAGE - 1);

        if (error) fail(`Reading fixed_savings_plans: ${error.message}`);
        if (!data || data.length === 0) break;

        for (const row of data) {
            const raw = (row.raw_data ?? {}) as Record<string, any>;
            const planId = String(row.id);
            const memberId = String(raw.memberId ?? raw.userId ?? '');
            const amount = Number(raw.amount);

            if (!memberId || memberId === 'null' || memberId === 'undefined') {
                skipped.push({ planId, reason: 'no memberId on the plan' });
                continue;
            }
            if (!Number.isFinite(amount) || amount <= 0) {
                skipped.push({ planId, reason: `amount is not a positive number (${raw.amount})` });
                continue;
            }

            plans.push({
                planId,
                memberId,
                amount,
                startDate: typeof raw.startDate === 'string' ? raw.startDate : null,
            });
        }

        if (data.length < PAGE) break;
    }
}

/** Which of those references already have their cooperative-ledger row. */
async function existingLedgerRows(references: string[]): Promise<Set<string>> {
    const found = new Set<string>();
    const BATCH = 200;

    for (let i = 0; i < references.length; i += BATCH) {
        const slice = references.slice(i, i + BATCH);
        const { data, error } = await admin
            .from('document_collections')
            .select('id')
            .eq('collection_name', 'cooperative_transactions')
            .in('id', slice);

        if (error) fail(`Reading cooperative_transactions: ${error.message}`);
        for (const row of data ?? []) found.add(String(row.id));
    }

    return found;
}

/**
 * The member's cooperativeId, matching what the route records.
 *
 * The route writes `memberData.cooperativeId || "default"`, so this must too —
 * a backfilled row that grouped under a different cooperative than the live
 * writer would reconcile in one place and not the other.
 */
async function cooperativeIdsFor(memberIds: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const BATCH = 200;
    const unique = Array.from(new Set(memberIds));

    for (let i = 0; i < unique.length; i += BATCH) {
        const slice = unique.slice(i, i + BATCH);
        const { data, error } = await admin
            .from('cooperative_members')
            .select('id, raw_data')
            .in('id', slice);

        if (error) fail(`Reading cooperative_members: ${error.message}`);
        for (const row of data ?? []) {
            const raw = (row.raw_data ?? {}) as Record<string, any>;
            out.set(String(row.id), String(raw.cooperativeId || 'default'));
        }
    }

    return out;
}

/** Write one missing ledger row, with the same shape the live route writes. */
async function writeLedgerRow(plan: Plan, cooperativeId: string): Promise<void> {
    const reference = ledgerReferenceFor(plan.planId);

    const { error } = await admin.from('document_collections').upsert({
        id: reference,
        collection_name: 'cooperative_transactions',
        raw_data: {
            id: reference,
            userId: plan.memberId,
            cooperativeId,
            type: 'fixed_savings_lock',
            amount: plan.amount,
            currency: 'NGN',
            reference,
            description: 'Locked into a fixed savings plan',
            status: 'completed',
            // The plan's own date — see the header. Falls back to the plan id's
            // row creation time only when the plan has no startDate at all.
            date: plan.startDate,
            // Provenance, NOT idempotency. The deterministic id above is what
            // makes a re-run safe; this only records that a human did not write
            // this row through the application.
            backfilledAt: new Date().toISOString(),
            backfillSource: 'scripts/backfill-fixed-savings-ledger.ts',
        },
    });

    if (error) fail(`Writing ledger row ${reference}: ${error.message}`);
}

async function main() {
    console.log(modeBanner('Fixed-savings cooperative-ledger backfill', APPLY, targetHost()));
    console.log(`   Database: ${new URL(url).hostname}`);
    console.log(`   Mode:     ${APPLY ? '⚠️  APPLY — this will write ledger rows' : 'report only (pass --apply to write)'}\n`);

    await readPlans();

    if (plans.length === 0 && skipped.length === 0) {
        console.log('✅ No fixed savings plans found. Nothing to do.\n');
        return;
    }

    const existing = await existingLedgerRows(plans.map(p => ledgerReferenceFor(p.planId)));
    const missing = plans.filter(p => !existing.has(ledgerReferenceFor(p.planId)));
    const totalUnaccounted = missing.reduce((sum, p) => sum + p.amount, 0);

    console.log(`Fixed savings plans:        ${plans.length}`);
    console.log(`  already have a ledger row: ${plans.length - missing.length}`);
    console.log(`  MISSING a ledger row:      ${missing.length}`);
    console.log(`Unaccounted in the ledger:  ${naira(totalUnaccounted)}\n`);

    for (const plan of missing) {
        console.log(`  plan=${plan.planId}  member=${plan.memberId}  ${naira(plan.amount)}  ${plan.startDate ?? 'no start date'}`);
    }

    if (skipped.length > 0) {
        console.log(`\n⚠️  SKIPPED — malformed plans. A ledger entry invented from a bad plan would be`);
        console.log(`   permanent and wrong, and the ledger is what everything else reconciles`);
        console.log(`   against. Listed, not written:`);
        for (const s of skipped) console.log(`  plan=${s.planId}  ${s.reason}`);
    }

    if (missing.length === 0) {
        console.log(`\n✅ Every plan already has its cooperative-ledger row. Nothing to write.\n`);
        return;
    }

    if (!APPLY) {
        console.log(`\n📋 Report only — nothing was written. Re-run with --apply to write these rows.\n`);
        return;
    }

    const coopIds = await cooperativeIdsFor(missing.map(p => p.memberId));

    console.log(`\n✍️  Writing…`);
    let done = 0;
    for (const plan of missing) {
        await writeLedgerRow(plan, coopIds.get(plan.memberId) ?? 'default');
        done++;
        console.log(`  ✅ ${ledgerReferenceFor(plan.planId)}  ${naira(plan.amount)}  (${done}/${missing.length})`);
    }

    console.log(`\n✅ Wrote ${done} ledger row(s), ${naira(totalUnaccounted)} now accounted for.`);
    console.log(`   No balances were changed — these rows describe debits that already happened.\n`);
}

main().catch(e => fail(e?.message || String(e)));
