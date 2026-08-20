/**
 * Stamp `fundingGoal` and `windowKind` onto export windows created before
 * either field existed.
 *
 * Run (report only, writes nothing):   npm run backfill:exportgoals
 * Run (writes the fields):             npm run backfill:exportgoals -- --apply
 *
 * WHY IT IS NEEDED
 * ----------------
 * export_windows holds two entities. An AGGREGATION window is a crowdfunded
 * opportunity carrying targetVolume and slotPrice; a SHIPMENT window is a
 * private export request carrying orderId and quantity. Nothing ever wrote a
 * discriminator, and nothing ever wrote a funding goal.
 *
 * The goal is the one with a running cost. All three fulfilment paths guard
 * against overfunding with incrementWithinCeiling, and that function treats a
 * MISSING ceiling field as UNBOUNDED — so no window was ever capped. It reads
 * the ceiling through a Postgres function, from a stored column, which is why
 * deriving the number in JavaScript (exportWindowFundingGoal) fixes every
 * reader but caps nothing. Only a stored value caps.
 *
 * Both creators write both fields now. This repairs the rows that predate them.
 *
 * WHAT IT COMPUTES
 * ----------------
 * fundingGoal = targetVolume x slotPrice, which is what admin/_exports.ts has
 * always computed for display and thrown away:
 *
 *     calculatedAmount = Number(data.targetVolume) * Number(data.slotPrice || 1)
 *
 * It is not a new number and not an invented one — it is the figure the admin
 * screen already shows for the same window.
 *
 * WHY IT IS SAFE TO RE-RUN
 * ------------------------
 * It only ever ADDS the two fields to a row that lacks them, and the value is a
 * pure function of two fields it does not touch. A row that already carries a
 * fundingGoal is left exactly as it is — including one an admin set by hand to
 * something other than the product, which this must not overwrite.
 *
 * IT MOVES NO MONEY AND CHANGES NO STATUS. It cannot close a window or open
 * one. The worst case of a wrong value here is a window that stops accepting
 * investment earlier than intended, which is the direction an uncapped window
 * is already wrong in.
 *
 * WHAT IT REFUSES TO GUESS
 * ------------------------
 * A window whose targetVolume or slotPrice is missing, zero or unparseable is
 * reported under SKIPPED and left alone. So is one already carrying a goal.
 * Writing a fabricated ceiling onto a window that people can put money into is
 * worse than leaving it uncapped, because it would refuse investments that
 * should be accepted and there would be nothing on the row to say the number
 * was invented.
 *
 * SHIPMENT WINDOWS GET `windowKind` AND NO GOAL. A private export request has
 * no investors and nothing to overfund; a goal of 0 on one would read as
 * "already full" to everything comparing against it.
 */

import { createClient } from '@supabase/supabase-js';
import { existsSync } from 'fs';
import { config as loadEnv } from 'dotenv';
import { kindOf, goalOf } from './export-funding-goal-kind';

if (existsSync('.env.development.local')) loadEnv({ path: '.env.development.local' });
loadEnv({ path: '.env.local' });

const APPLY = process.argv.includes('--apply');

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

interface Planned {
    id: string;
    kind: 'shipment' | 'aggregation';
    goal: number | null;
    patch: Record<string, unknown>;
}

const planned: Planned[] = [];
const skipped: { id: string; reason: string }[] = [];
let alreadyDone = 0;

async function readWindows(): Promise<void> {
    const PAGE = 1000;

    for (let from = 0; ; from += PAGE) {
        const { data, error } = await admin
            .from('document_collections')
            .select('id, raw_data')
            .eq('collection_name', 'export_windows')
            .order('created_at', { ascending: true })
            .range(from, from + PAGE - 1);

        if (error) fail(`Reading export_windows: ${error.message}`);
        if (!data || data.length === 0) break;

        for (const row of data) {
            const raw = (row.raw_data ?? {}) as Record<string, any>;
            const id = String(row.id);
            const kind = kindOf(raw);

            const patch: Record<string, unknown> = {};
            if (raw.windowKind !== kind) patch.windowKind = kind;

            let goal: number | null = null;
            if (kind === 'aggregation') {
                const existing = Number(raw.fundingGoal);
                if (Number.isFinite(existing) && existing > 0) {
                    // Never overwritten: an admin may have set this by hand.
                    if (Object.keys(patch).length === 0) { alreadyDone++; continue; }
                } else {
                    goal = goalOf(raw);
                    if (goal === null) {
                        skipped.push({ id, reason: 'aggregation window with no usable targetVolume x slotPrice' });
                        if (Object.keys(patch).length === 0) continue;
                    } else {
                        patch.fundingGoal = goal;
                    }
                }
            }

            if (Object.keys(patch).length === 0) { alreadyDone++; continue; }
            planned.push({ id, kind, goal, patch });
        }

        if (data.length < PAGE) break;
    }
}

async function apply(): Promise<void> {
    let done = 0;

    for (const p of planned) {
        const { data, error: readErr } = await admin
            .from('document_collections')
            .select('raw_data')
            .eq('collection_name', 'export_windows')
            .eq('id', p.id)
            .single();

        if (readErr) { console.error(`  ! ${p.id}: re-read failed — ${readErr.message}`); continue; }

        const merged = { ...((data?.raw_data ?? {}) as Record<string, unknown>), ...p.patch };

        const { error } = await admin
            .from('document_collections')
            .update({ raw_data: merged })
            .eq('collection_name', 'export_windows')
            .eq('id', p.id);

        if (error) { console.error(`  ! ${p.id}: ${error.message}`); continue; }
        done++;
    }

    console.log(`\n✅ Updated ${done} of ${planned.length} window(s).`);
}

async function main(): Promise<void> {
    console.log(`\nExport window backfill — ${APPLY ? 'APPLY' : 'REPORT ONLY'}\n`);

    await readWindows();

    const aggregations = planned.filter((p) => p.kind === 'aggregation');
    const shipments = planned.filter((p) => p.kind === 'shipment');

    console.log(`Already correct:            ${alreadyDone}`);
    console.log(`Aggregation windows to fix: ${aggregations.length}`);
    console.log(`Shipment windows to label:  ${shipments.length}`);
    console.log(`Skipped:                    ${skipped.length}`);

    if (aggregations.length) {
        console.log('\nAggregation windows:');
        for (const p of aggregations) {
            console.log(`  ${p.id}  goal ${p.goal === null ? '(unchanged)' : naira(p.goal)}`);
        }
    }

    if (skipped.length) {
        console.log('\nSKIPPED — left exactly as they are:');
        for (const s of skipped) console.log(`  ${s.id}  ${s.reason}`);
    }

    if (!APPLY) {
        console.log('\nNothing was written. Re-run with --apply to write.\n');
        return;
    }

    await apply();
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
