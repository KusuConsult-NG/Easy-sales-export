#!/usr/bin/env node
/**
 * Apply one .sql file to a Postgres, as ONE statement, over a direct connection.
 *
 *   #808 THE SUPABASE SQL EDITOR CANNOT APPLY A PLPGSQL FUNCTION OF THIS SIZE,
 *        AND THERE WAS NO OTHER DOOR IN THIS REPOSITORY.
 *
 *        Migration 046 was refused three times by that editor, on three
 *        materially different encodings of the same function:
 *
 *          dollar-quoted `$fn$`   ERROR: unterminated dollar-quoted string,
 *                                 with four ALTER TABLE statements appended for
 *                                 tables that do not exist — the editor had
 *                                 read `SELECT … INTO v_x FROM …` in the body
 *                                 as `CREATE TABLE AS`, which is what it means
 *                                 outside a plpgsql block.
 *
 *          reads rewritten as     ERROR: syntax error at or near "RETURN",
 *          `v_x := (SELECT …)`    reported as LINE 1 of a line that is not
 *                                 line 1 — a fragment of the body run alone.
 *
 *          body as a single       The same error, and the echoed fragment came
 *          quoted string literal  back carrying DOUBLED quotes
 *                                 (`''no_source_wallet''`) — so the split
 *                                 happened INSIDE a string literal.
 *
 *        That last one settles it. A splitter that cuts inside a quoted string
 *        respects neither dollar quoting nor standard quoting, and no encoding
 *        of a 200-line body will survive it. The editor is the wrong tool, and
 *        every further attempt to satisfy it is a guess.
 *
 * ── WHY THIS SCRIPT IS SAFE WHERE THAT IS NOT ───────────────────────────────
 *
 *   It sends the file's bytes as ONE query. `pg` does not split statements —
 *   the SERVER parses them, which is the only parser that has ever been
 *   correct about this file. A multi-statement query is then wrapped by
 *   Postgres in a single implicit transaction, so a failure part-way leaves
 *   nothing behind; 046 opens `BEGIN` and closes `COMMIT` of its own besides.
 *
 *   `pg` is already a dependency of this repository, so this needs `node` and
 *   nothing else — no psql, no Supabase CLI, no install.
 *
 * ── THE #329 SHAPE, BECAUSE THIS WRITES TO A REAL DATABASE ──────────────────
 *
 *   Report-only by default. It prints the target host and what it would run,
 *   and writes nothing until a human re-runs with --apply. The host comes from
 *   the connection string the writes actually travel through, per #304: a
 *   guard that inspects a system the script does not touch is not a guard.
 *
 *   Usage:
 *
 *     export DATABASE_URL="postgresql://postgres:PASSWORD@db.<ref>.supabase.co:5432/postgres"
 *
 *     node scripts/apply-sql.mjs supabase/migrations/046_consolidate_wallet_to_live_profile.sql
 *     node scripts/apply-sql.mjs supabase/migrations/046_… --apply
 *
 *   The connection string is in the Supabase dashboard under
 *   Project Settings → Database → Connection string → URI.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const file = argv.find((a) => !a.startsWith("--"));

if (!file) {
    console.error("usage: node scripts/apply-sql.mjs <file.sql> [--apply]");
    process.exit(2);
}

const url = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || process.env.PROD_URL;
if (!url) {
    console.error(
        "Refusing to run without knowing the target database.\n" +
        "  Set DATABASE_URL to the connection string from\n" +
        "  Project Settings → Database → Connection string → URI.",
    );
    process.exit(2);
}

/**
 * The host, and never the password.
 *
 * A connection string is the one argument on this script that must not reach a
 * log, a terminal scrollback or a screenshot, and the banner is the thing most
 * likely to be pasted back to somebody.
 */
function describeTarget(connectionString) {
    try {
        const u = new URL(connectionString);
        return `${u.hostname}${u.port ? `:${u.port}` : ""}${u.pathname}`;
    } catch {
        return "(unparseable connection string)";
    }
}

const path = resolve(process.cwd(), file);
const sql = readFileSync(path, "utf8");
const statements = sql.split("\n").filter((l) => l.trim() && !l.trim().startsWith("--")).length;

console.log("─".repeat(70));
console.log(`  FILE    ${file}`);
console.log(`  TARGET  ${describeTarget(url)}`);
console.log(`  SIZE    ${sql.length} bytes, ${statements} non-comment lines`);
console.log(`  MODE    ${APPLY ? "APPLY — this will write" : "report only (pass --apply to write)"}`);
console.log("─".repeat(70));

if (!APPLY) {
    console.log("\nNothing was sent. Re-run with --apply once the target above is right.");
    process.exit(0);
}

const client = new pg.Client({
    connectionString: url,
    //   Supabase terminates TLS with its own chain; `pg` otherwise refuses it.
    //   This is the same posture the platform's own client takes, and the
    //   connection is still encrypted — it is the chain that is not verified,
    //   not the transport that is dropped.
    ssl: /supabase\.(co|com)/.test(url) ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: 15_000,
    statement_timeout: 120_000,
});

try {
    await client.connect();
    //   ONE query. The server splits it, which is the whole point of this file.
    await client.query(sql);
    console.log("\n✓ Applied.");
} catch (error) {
    //   Loud and non-zero. #329's note: three scripts ended `.catch(console.error)`
    //   and exited 0 after the work had failed.
    console.error(`\n✗ FAILED: ${error instanceof Error ? error.message : String(error)}`);
    if (error?.position) console.error(`  at character ${error.position}`);
    process.exitCode = 1;
} finally {
    await client.end().catch(() => {});
}
