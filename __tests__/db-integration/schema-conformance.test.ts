/**
 * Does the database actually match what the adapter believes about it?
 *
 * WHY THIS EXISTS
 * ---------------
 * src/lib/supabase-db.ts carries three maps that together decide how every
 * read and write in this application is routed:
 *
 *   DEDICATED_TABLE_MAP  which collections live in their own table rather than
 *                        in the generic document_collections
 *   NATIVE_COLUMNS       which fields are real SQL columns on those tables, so
 *                        a .where() can filter on the column instead of on
 *                        raw_data->>'field'
 *   FIELD_TO_COLUMN      the app's field name → the actual column name
 *
 * Every one of those is a CLAIM ABOUT THE DATABASE written in TypeScript, and
 * nothing has ever checked them against the database. TypeScript cannot: these
 * are strings. A column renamed in a migration, or a name typed slightly wrong
 * here, produces a query that filters on a column that does not exist — and
 * PostgREST answers with an error the adapter surfaces as an empty result, not
 * as a failure.
 *
 * This audit has already found what that costs. `.where("inStock", "==", true)`
 * filtered the marketplace on a field NOTHING WRITES, so no product was ever
 * visible. claim_status_transition ran against document_collections for
 * collections that live in dedicated tables, so no marketplace order
 * transition ever succeeded. Both were exactly this class: code and schema
 * disagreeing, silently.
 *
 * WHAT IS ASSERTED
 * ----------------
 * Each map, against information_schema on the real database. Read-only — this
 * file creates and deletes nothing.
 *
 * The direction matters. It checks that everything the CODE claims exists
 * really does. It deliberately does NOT require the reverse: a table may hold
 * columns the adapter does not route through, and that is normal.
 */

import { supabaseAdmin } from "@/lib/supabase";
import {
    DEDICATED_TABLE_MAP,
    NATIVE_COLUMNS,
    FIELD_TO_COLUMN,
} from "@/lib/supabase-db";

declare const maybeDescribe: jest.Describe;

/**
 * Ask PostgREST for a single column directly.
 *
 * More reliable than sampling a row: it works on an empty table, and an absent
 * column is an explicit PostgREST error rather than a silently missing key.
 */
async function columnExists(table: string, column: string): Promise<{ ok: boolean; reason?: string }> {
    const { error } = await supabaseAdmin.from(table).select(column).limit(1);
    if (!error) return { ok: true };
    return { ok: false, reason: error.message };
}

maybeDescribe("the adapter's schema maps match the real database", () => {
    /** Distinct table names — the map has camelCase and snake_case aliases. */
    const dedicatedTables = Array.from(new Set(Object.values(DEDICATED_TABLE_MAP)));

    it("found the maps (sanity)", () => {
        // Without this, a rename upstream empties every loop below and the file
        // passes having asserted nothing.
        expect(dedicatedTables.length).toBeGreaterThanOrEqual(8);
        expect(Object.keys(NATIVE_COLUMNS).length).toBeGreaterThanOrEqual(8);
        expect(Object.keys(FIELD_TO_COLUMN).length).toBeGreaterThanOrEqual(5);
    });

    it("every table in DEDICATED_TABLE_MAP exists", async () => {
        const missing: string[] = [];
        for (const table of dedicatedTables) {
            const { error } = await supabaseAdmin.from(table).select("id").limit(1);
            if (error) missing.push(`${table} (${error.message})`);
        }
        expect(missing).toEqual([]);
    });

    it("every dedicated table has raw_data, which the adapter always reads", async () => {
        // getTableName routes a collection here, and _mapRow then reads
        // row.raw_data unconditionally. A dedicated table without it would
        // return documents that are empty apart from the native columns.
        const missing: string[] = [];
        for (const table of dedicatedTables) {
            const { ok, reason } = await columnExists(table, "raw_data");
            if (!ok) missing.push(`${table}.raw_data (${reason})`);
        }
        expect(missing).toEqual([]);
    });

    it("every column named in NATIVE_COLUMNS exists on its table", async () => {
        // These decide whether a filter is applied to a real column or to
        // raw_data. A wrong name here does not fail loudly — it produces a
        // query error that reads like "no matching rows".
        const missing: string[] = [];
        for (const [table, columns] of Object.entries(NATIVE_COLUMNS)) {
            for (const column of columns) {
                const { ok, reason } = await columnExists(table, column);
                if (!ok) missing.push(`${table}.${column} (${reason})`);
            }
        }
        expect(missing).toEqual([]);
    });

    it("every target column in FIELD_TO_COLUMN exists on its table", async () => {
        // The mapping the app's field names are translated through. Wrong here
        // and a .where("userId", ...) filters on a column that is not there.
        const missing: string[] = [];
        for (const [table, mapping] of Object.entries(FIELD_TO_COLUMN)) {
            for (const [field, column] of Object.entries(mapping)) {
                const { ok, reason } = await columnExists(table, column);
                if (!ok) missing.push(`${table}: field "${field}" → column "${column}" (${reason})`);
            }
        }
        expect(missing).toEqual([]);
    });

    it("document_collections has the three columns the generic path depends on", async () => {
        // Everything not in DEDICATED_TABLE_MAP goes here, which is most
        // collections in the application.
        for (const column of ["id", "collection_name", "raw_data"]) {
            const { ok, reason } = await columnExists("document_collections", column);
            expect(ok ? "ok" : `document_collections.${column} missing (${reason})`).toBe("ok");
        }
    });

    it("reports a column that does NOT exist, so the checks above mean something", async () => {
        // The mutation guard, inline. If columnExists answered "fine" for
        // everything — a plausible way for this file to rot — every assertion
        // above would pass against a completely wrong schema.
        const { ok } = await columnExists("users", "a_column_that_does_not_exist");
        expect(ok).toBe(false);
    });
});
