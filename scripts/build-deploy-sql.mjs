#!/usr/bin/env node
/**
 * Builds a single, ordered SQL file to apply every migration to a database.
 *
 * WHY THIS EXISTS
 * ---------------
 * There are now fourteen migrations, applied by pasting into the Supabase SQL
 * Editor because neither psql nor the Supabase CLI is installed. Three facts
 * make pasting them by hand risky:
 *
 *   1. 014 REPLACES the function 013 creates, to add nested-path support.
 *      Applying 013 after 014 silently reverts that.
 *
 *   2. 011 corrects the wallet functions from 005/006, which as written update
 *      a column the application never reads. Skipping it leaves wallet credits
 *      invisible.
 *
 *   3. 010 (atomic increments) makes several unguarded checks WORSE until the
 *      code guarding them is deployed. It belongs with that code, not ahead of
 *      it. See docs/audit/atomic-money-migration.md.
 *
 * Generating the file from the directory means the script cannot drift from the
 * migrations, and a missing one is an error rather than a silent gap.
 *
 * Usage:
 *   node scripts/build-deploy-sql.mjs                 # write to stdout
 *   node scripts/build-deploy-sql.mjs --out deploy.sql
 *   node scripts/build-deploy-sql.mjs --skip-rls      # omit 004
 */

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = "supabase/migrations";

/**
 * Every migration expected in a complete deployment, in application order.
 *
 * The order is the numeric order — but it is written out explicitly rather than
 * sorted, so that a dependency between two of them is visible here rather than
 * implied by a filename.
 */
const EXPECTED = [
    { n: "002", why: "jsonb merge helper used by the adapter's partial updates" },
    { n: "003", why: "atomic profile sync" },
    { n: "018", why: "jsonb_set_deep — MUST come before 010/016/017, which call it" },
    { n: "005", why: "wallet credit/debit — superseded in part by 011" },
    { n: "006", why: "keeps wallet debits out of the revenue total" },
    { n: "007", why: "compare-and-swap for status transitions" },
    { n: "008", why: "narrows the member-status trigger that blocked signups" },
    { n: "009", why: "claim a payment reference without moving money" },
    { n: "010", why: "atomic FieldValue.increment — MUST ship with the code that guards it" },
    { n: "011", why: "corrects 005/006 to write the value the app actually reads" },
    { n: "012", why: "platform revenue totals" },
    { n: "013", why: "locked debit for raw_data balances" },
    { n: "014", why: "extends 013 to nested paths — MUST come after 013" },
    { n: "015", why: "bounded counters — MUST ship with the code that guards stock and capacity" },
    { n: "016", why: "atomic arrayUnion/arrayRemove — MUST ship with the adapter change that calls it" },
    { n: "017", why: "targeted patches — makes every write send only changed fields; also the first working FieldValue.delete" },
    { n: "019", why: "claim an idempotency key — platform.ts and export.ts throw without it" },
    { n: "020", why: "floored debit + versioned CAS — the withdrawal floor and every versionedUpdate caller" },
    { n: "021", why: "one open loan application per borrower (advisory lock)" },
    { n: "004", why: "row-level security — LAST, and in a low-traffic window" },
];

/**
 * Migrations deliberately NOT in the consolidated file, and why.
 *
 * This list exists so that "not in EXPECTED" can mean "somebody forgot" rather
 * than "it is handled elsewhere". Without it the check below could not tell the
 * two apart, and would have to let both through.
 */
const EXCLUDED = [
    {
        n: "022",
        why: "CREATE INDEX CONCURRENTLY cannot run inside a transaction block, and " +
             "every other migration here opens one. Concatenating it would fail — or " +
             "worse, take an ACCESS EXCLUSIVE lock on live tables if the CONCURRENTLY " +
             "were dropped to make it fit. Apply it on its own, and only after the " +
             "EXPLAIN ANALYZE in its header shows the indexes are worth having.",
    },
];

const args = process.argv.slice(2);
const outIdx = args.indexOf("--out");
const outFile = outIdx >= 0 ? args[outIdx + 1] : null;
const skipRls = args.includes("--skip-rls");

const available = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));

function findMigration(prefix) {
    return available.find((f) => f.startsWith(`${prefix}_`)) ?? null;
}

const missing = [];
const chosen = [];

for (const step of EXPECTED) {
    if (skipRls && step.n === "004") continue;
    const file = findMigration(step.n);
    if (!file) {
        missing.push(step);
        continue;
    }
    chosen.push({ ...step, file });
}

// The check that was not here.
//
// The loop above finds migrations EXPECTED but absent. It could not find the
// opposite — a migration present on disk that nobody added to EXPECTED — so
// four of them (019-022) were silently dropped from the consolidated file while
// the code on main called the functions they create. A guard that checks one
// direction only is how that happens.
const accountedFor = new Set([
    ...EXPECTED.map((e) => e.n),
    ...EXCLUDED.map((e) => e.n),
]);
const unaccounted = available
    .map((f) => f.slice(0, f.indexOf("_")))
    .filter((n) => /^\d+$/.test(n) && !accountedFor.has(n))
    .sort();

if (unaccounted.length > 0) {
    console.error("\n[build-deploy-sql] REFUSING TO BUILD — migrations on disk that this script does not know about:\n");
    for (const n of unaccounted) {
        console.error(`  ${n}  ${findMigration(n)}`);
    }
    console.error(
        "\nAdd each to EXPECTED (with its ordering reason) or to EXCLUDED (with why\n" +
        "it is applied separately). Dropping it silently is what this check exists\n" +
        "to prevent: the generated file would look complete and be missing the\n" +
        "functions the application calls.\n"
    );
    process.exit(1);
}

if (missing.length > 0) {
    console.error("\n[build-deploy-sql] REFUSING TO BUILD — migrations are missing:\n");
    for (const m of missing) {
        console.error(`  ${m.n}  ${m.why}`);
    }
    console.error(
        "\nA partial deployment is worse than none: the code on main calls functions\n" +
        "these files create. Merge the branch that carries them, then run this again.\n"
    );
    process.exit(1);
}

const stamp = new Date().toISOString().slice(0, 19).replace("T", " ");

const header = `-- ============================================================================
-- CONSOLIDATED DEPLOY — generated ${stamp} UTC
-- by scripts/build-deploy-sql.mjs. Do not edit this file; regenerate it.
--
-- Apply by pasting into the Supabase SQL Editor of the TARGET project.
-- Run it ONCE, top to bottom. Every migration is idempotent (CREATE OR REPLACE
-- / IF NOT EXISTS), so a re-run is safe, but the ORDER is not optional:
--
--   013 then 014   — 014 replaces the function 013 creates. Reversed, the
--                    nested-path support disappears.
--   005/006 then 011 — 011 corrects both to write the value the application
--                    actually reads. Without it, wallet credits are invisible.
--   004 LAST       — row-level security. Failures are silent (empty rows, not
--                    errors), so apply it in a low-traffic window with the
--                    rollback at the bottom of that file to hand.
--
-- BEFORE YOU RUN THIS
--   Confirm the project. These statements create functions and enable RLS on
--   the database they are pasted into. There is no undo button.
--
-- AFTER YOU RUN THIS
--   The verification block at the end lists what should exist. Run it.
--   Then run \`npm run test:db\` against the same database.
-- ============================================================================

`;

const sections = chosen
    .map(({ n, why, file }) => {
        const body = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
        return `
-- ============================================================================
-- ${n} — ${file}
-- ${why}
-- ============================================================================

${body.trim()}
`;
    })
    .join("\n");

const verification = `

-- ============================================================================
-- VERIFICATION — run this after the statements above.
-- ============================================================================

-- 1. Every function should be listed. Expect 19 rows.
--
--    The count said 9 while the list held 16, and the list itself was missing
--    everything from 019 onward — so a database lacking the functions the
--    application calls would still have "passed" this step.
SELECT proname
  FROM pg_proc
 WHERE proname IN (
    'merge_raw_data',
    'atomic_profile_sync',
    'credit_wallet_once',
    'debit_wallet_once',
    'debit_wallet_locked',
    'claim_status_transition',
    'claim_payment_once',
    'apply_increments',
    'platform_revenue_totals',
    'debit_jsonb_balance',
    'decrement_many_or_fail',
    'apply_array_ops',
    'apply_document_patch',
    'jsonb_set_deep',
    'increment_within_ceiling',
    'enforce_member_active_on_paid',
    'claim_idempotency_key',
    'debit_jsonb_balance_with_floor',
    'claim_versioned_update',
    'claim_single_open_loan_application'
 )
 ORDER BY proname;

-- 2. debit_jsonb_balance must be the NESTED-path version from 014.
--    Expect: t, 4000  — if this errors or returns the wrong balance, 013 was
--    applied after 014 and the nested-path support was reverted.
--
--   INSERT INTO users (id, email, raw_data)
--   VALUES ('deploy-check-1', 'deploy-check-1@example.com',
--           '{"serviceRegistrations":{"wave":{"waveEarningsBalance":10000}}}'::jsonb)
--   ON CONFLICT (id) DO UPDATE SET raw_data = EXCLUDED.raw_data;
--
--   SELECT * FROM debit_jsonb_balance(
--       'users', 'deploy-check-1', 'serviceRegistrations.wave.waveEarningsBalance', 6000);
--
--   DELETE FROM users WHERE id = 'deploy-check-1';

-- 3. Wallet functions must move BOTH copies of the balance (011).
--    Expect both columns equal. If native_col moves and shown_to_user does not,
--    011 was not applied and wallet credits are invisible to the application.
--
--   INSERT INTO wallets (id, balance, raw_data)
--   VALUES ('deploy-check-2', 100, '{"id":"deploy-check-2","balance":100}'::jsonb)
--   ON CONFLICT (id) DO UPDATE SET balance = 100, raw_data = EXCLUDED.raw_data;
--
--   SELECT * FROM credit_wallet_once('deploy-check-ref', 'deploy-check-2', 50);
--
--   SELECT balance AS native_col, (raw_data->>'balance')::numeric AS shown_to_user
--     FROM wallets WHERE id = 'deploy-check-2';
--
--   DELETE FROM processed_payments WHERE id = 'deploy-check-ref';
--   DELETE FROM wallets WHERE id = 'deploy-check-2';

-- 4. RLS: every table on, no policies (Option A).
SELECT tablename, rowsecurity
  FROM pg_tables
 WHERE schemaname = 'public'
 ORDER BY tablename;

SELECT count(*) AS policies_attached
  FROM pg_policies
 WHERE schemaname = 'public';

-- 5. The check the SQL Editor CANNOT make: it runs as service_role, which
--    bypasses RLS. Run this in a terminal with the ANON key. Expect [].
--
--   curl "$SUPABASE_URL/rest/v1/users?select=*" -H "apikey: $ANON_KEY"
`;

const output = header + sections + verification;

if (outFile) {
    writeFileSync(outFile, output);
    console.error(`[build-deploy-sql] wrote ${outFile}`);
    console.error(`[build-deploy-sql] ${chosen.length} migrations, in order:`);
    for (const c of chosen) console.error(`  ${c.n}  ${c.file}`);
} else {
    process.stdout.write(output);
}
