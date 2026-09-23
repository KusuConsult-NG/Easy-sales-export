import { readFileSync, readdirSync } from "fs";
import { join } from "path";

/**
 * Every index and function the migration files create, parsed from the SQL.
 *
 * TEST-ONLY, AND THAT IS THE POINT. lib/migration-manifest is a checked-in
 * constant because the migration directory is not shipped — a Next standalone
 * build carries `.next` output and nothing else, so nothing at runtime can
 * read these files. The manifest would therefore rot silently, which is the
 * failure this whole check exists to stop happening one level down.
 *
 * So the ratchet parses the files and compares. Add a migration without
 * listing what it creates and CI says so.
 */

export interface MigrationObject {
    name: string;
    kind: "index" | "function";
    /** The first migration file that creates it. */
    migration: string;
}

const INDEX_RE = /^\s*CREATE\s+INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_]+)/gim;
const FUNCTION_RE = /^\s*CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?([a-zA-Z0-9_]+)\s*\(/gim;

/**
 * SQL comments removed, both forms, so that a migration HEADER quoting its own
 * DDL is read as the prose it is.
 *
 *   These files are mostly explanation. 027 walks through the lock costs of
 *   `CREATE INDEX idx_probe ON public.users (created_at DESC);`, 008 quotes the
 *   `CREATE OR REPLACE FUNCTION` it is replacing, 048 quotes the statement that
 *   would not deploy. None of those creates anything.
 *
 *   THE DIRECTION THE MISTAKE RUNS MATTERS. A parser that counted prose would
 *   invent objects no migration creates; the manifest ratchet would fail, and
 *   the obvious way to make it pass again is to add the invented name to
 *   lib/migration-manifest — at which point the audit reports a healthy
 *   database as BEHIND for ever, naming a file that fixes nothing. A check
 *   nobody believes is the failure this whole thing exists to stop.
 *
 *   The first version filtered whole `--` lines, which the `^\s*` anchors on
 *   the patterns below already did for free — it was dead code that read like
 *   a guard. A block comment is the case that actually gets through: `/*` ...
 *   `*` + `/` says nothing about column 1, and 030 and 046 already use them.
 *   Postgres nests block comments, so depth is counted rather than matched.
 *
 *   String literals are walked rather than skipped, so an apostrophe inside a
 *   function body cannot swallow the statements after it.
 */
function withoutComments(sql: string): string {
    let out = "";
    let i = 0;
    let blockDepth = 0;

    while (i < sql.length) {
        const two = sql.slice(i, i + 2);

        if (blockDepth > 0) {
            if (two === "/*") { blockDepth++; i += 2; continue; }
            if (two === "*/") { blockDepth--; i += 2; continue; }
            //   Newlines survive: the patterns are line-anchored, and folding a
            //   comment away would join the next statement onto a live line.
            if (sql[i] === "\n") out += "\n";
            i++;
            continue;
        }

        if (two === "/*") { blockDepth++; i += 2; continue; }

        if (two === "--") {
            while (i < sql.length && sql[i] !== "\n") i++;
            continue;
        }

        if (sql[i] === "'") {
            out += sql[i++];
            while (i < sql.length) {
                if (sql[i] === "'") {
                    //   '' is an escaped quote, not the end of the literal.
                    if (sql[i + 1] === "'") { out += "''"; i += 2; continue; }
                    out += sql[i++];
                    break;
                }
                out += sql[i++];
            }
            continue;
        }

        out += sql[i++];
    }

    return out;
}

export function migrationObjects(root = process.cwd()): MigrationObject[] {
    const dir = join(root, "supabase", "migrations");
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

    const seen = new Map<string, MigrationObject>();

    for (const file of files) {
        const sql = withoutComments(readFileSync(join(dir, file), "utf8"));

        for (const [, name] of sql.matchAll(INDEX_RE)) {
            //   FIRST WINS. 048 re-creates what 022 declared with CONCURRENTLY,
            //   under the same names — one object, named once.
            if (!seen.has(`index:${name}`)) {
                seen.set(`index:${name}`, { name, kind: "index", migration: file });
            }
        }
        for (const [, name] of sql.matchAll(FUNCTION_RE)) {
            if (!seen.has(`function:${name}`)) {
                seen.set(`function:${name}`, { name, kind: "function", migration: file });
            }
        }
    }

    return [...seen.values()].sort((a, b) =>
        a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind.localeCompare(b.kind));
}
