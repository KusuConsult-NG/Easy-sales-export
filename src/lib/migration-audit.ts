import "server-only";

import { supabaseAdmin } from "@/lib/supabase";
import { logger } from "@/lib/logger";
import { whyRpcUnavailable, type RpcUnavailableCause } from "@/lib/rpc-unavailable";
import {
    EXPECTED_INDEXES,
    EXPECTED_FUNCTIONS,
    EXPECTED_SCHEMA_OBJECTS,
    migrationFor,
} from "@/lib/migration-manifest";

/**
 * Is the schema this code was written against the schema it is running against?
 *
 *   See lib/migration-manifest for why this question had no answer, and what
 *   the last time it went unanswered cost: 050 and 051 unapplied for a day
 *   while the screen 051 repairs read "could not be read".
 *
 * ── THREE ANSWERS, NOT TWO ──────────────────────────────────────────────────
 *
 *   in-sync      every object this code expects is on the database
 *   behind       named objects are missing, and the migrations that create them
 *   cannot-tell  the check itself did not run
 *
 *   THE THIRD IS THE ONE THAT MATTERS. A check that reports "fine" when it
 *   could not look is worse than no check, because it is believed. #316 is the
 *   same rule on money — "not knowing reported as a fact, in the direction that
 *   harms" — and #786's is the same on lists. A failed read is not an empty
 *   result.
 *
 *   The commonest reason for `cannot-tell` is the most informative one: 052
 *   itself has not been applied, so the function does not exist. That is not an
 *   error to shrug at, it is the answer — this database is behind by at least
 *   one migration, and the caller says so by name.
 */

export type MigrationAuditVerdict = "in-sync" | "behind" | "cannot-tell";

export interface MissingObject {
    name: string;
    kind: string;
    migration: string | null;
}

export interface MigrationAudit {
    verdict: MigrationAuditVerdict;
    /** How many objects were checked. */
    expected: number;
    missing: MissingObject[];
    /** The migration files to apply, oldest first, each named once. */
    applyThese: string[];
    /** One sentence an operator can act on. */
    detail: string;
    /** Set when the check could not run. */
    cause?: RpcUnavailableCause;
}

const AUDIT_FN = "missing_schema_objects";
const AUDIT_MIGRATION = "052_missing_schema_objects.sql";

export async function auditMigrations(): Promise<MigrationAudit> {
    const expected = EXPECTED_SCHEMA_OBJECTS.length;

    let data: Array<{ object_name: string; object_kind: string }> | null = null;
    let error: { code?: string | null; message?: string | null } | null = null;

    try {
        const result = await supabaseAdmin.rpc(AUDIT_FN, {
            expected_indexes: [...EXPECTED_INDEXES],
            expected_functions: [...EXPECTED_FUNCTIONS],
        });
        data = (result.data as any) ?? null;
        error = (result.error as any) ?? null;
    } catch (thrown: any) {
        error = { message: thrown?.message ?? String(thrown) };
    }

    if (error) {
        const cause = whyRpcUnavailable(error);
        /*
         *   NAMED, AND THE MISSING CASE NAMED HARDEST. If 052 is not there,
         *   this database is behind by at least that one — and saying "the
         *   audit could not run" without saying which migration to apply would
         *   leave an operator exactly where they were before it existed.
         */
        const detail = cause === "missing"
            ? `The audit function public.${AUDIT_FN} does not exist, so this database is behind by at `
              + `least one migration. Apply supabase/migrations/${AUDIT_MIGRATION}, then run this again.`
            : cause === "timed-out"
                ? `The audit query timed out. Nothing is known about which migrations are applied; run again.`
                : `The audit could not run (${error.message ?? "no detail"}). Nothing is known about which `
                  + `migrations are applied.`;

        return {
            verdict: "cannot-tell",
            expected,
            missing: [],
            applyThese: cause === "missing" ? [AUDIT_MIGRATION] : [],
            detail,
            cause,
        };
    }

    const missing: MissingObject[] = (data ?? []).map((row) => ({
        name: row.object_name,
        kind: row.object_kind,
        migration: migrationFor(row.object_name),
    }));

    if (missing.length === 0) {
        return {
            verdict: "in-sync",
            expected,
            missing: [],
            applyThese: [],
            detail: `All ${expected} expected indexes and functions are present.`,
        };
    }

    //   Oldest first, because migrations are written to be applied in order and
    //   a later one can depend on an earlier one's table.
    const applyThese = [...new Set(
        missing.map((m) => m.migration).filter((m): m is string => Boolean(m)),
    )].sort();

    return {
        verdict: "behind",
        expected,
        missing,
        applyThese,
        detail: `${missing.length} of ${expected} expected objects are missing. `
            + `Apply, in this order: ${applyThese.join(", ")}.`,
    };
}

/** Say it once, at the level the verdict deserves. */
export function reportMigrationAudit(audit: MigrationAudit, where: string): void {
    if (audit.verdict === "in-sync") {
        logger.info(`[${where}] schema in sync — ${audit.detail}`);
        return;
    }
    logger.error(`[${where}] ${audit.detail}`, {
        verdict: audit.verdict,
        cause: audit.cause,
        missing: audit.missing.map((m) => `${m.kind}:${m.name}`),
        applyThese: audit.applyThese,
    });
}
