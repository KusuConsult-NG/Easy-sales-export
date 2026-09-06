/**
 * Every declared filter operator, against real PostgREST and real Postgres.
 *
 * WHY THIS SUITE EXISTS
 * ---------------------
 * #434 found `not-in` missing from the adapter's JSONB switch, so it fell
 * through to an equality and "everything except these" returned nothing; and
 * `array-contains-any` on a JSONB field emitting PostgREST's `ov`, which is SQL
 * `&&`, which Postgres does not have for jsonb.
 *
 * Neither could be caught where the rest of the adapter's operator behaviour is
 * tested. The unit suites spy on the query builder, so they can assert which
 * filter was BUILT and nothing about what it returns; and lib/testing/fake-db,
 * which the whole unit suite runs against, implements both operators correctly
 * in memory — so a test could be green on a query that returns the wrong rows.
 *
 * The only place that distinction can fail is here, so this is where the
 * operator table belongs. Every case below was first run by hand against the
 * stack `scripts/local-stack/up.sh` brings up — real PostgreSQL 16.13 and real
 * PostgREST v12.2.3, no Docker anywhere — and the observed answers are what the
 * expectations say.
 */

import { supabaseAdmin } from "@/lib/supabase";
import { supabaseDb as db } from "@/lib/supabase-db";

declare const maybeDescribe: jest.Describe;

const COLLECTION = "jest_db_filter_ops";

/**
 * Rows chosen for the edges, not for realism.
 *
 *   `d` has NO status  — a legacy document missing the field, which is what
 *                        makes `!=` and `not-in` interesting.
 *   `e` and `f`        — a value with a quote and a value with a comma, the two
 *                        characters that end a filter member early when it is
 *                        interpolated into the wire format unescaped.
 */
const ROWS: Record<string, Record<string, unknown>> = {
    a: { status: "active", tags: ["red", "blue"] },
    b: { status: "cancelled", tags: ["blue"] },
    c: { status: "refunded", tags: ["green"] },
    d: { tags: ["red"] },
    e: { status: 'say "no"', tags: ['say "no"'] },
    f: { status: "a,b", tags: ["a,b"] },
};

async function cleanup() {
    await supabaseAdmin
        .from("document_collections")
        .delete()
        .eq("collection_name", COLLECTION);
}

/** Matching ids, sorted, as a string — so a failure names the rows. */
async function ids(query: any): Promise<string> {
    const snap = await query.get();
    return snap.docs.map((d: { id: string }) => d.id).sort().join(",") || "<none>";
}

maybeDescribe("filter operators, against real PostgREST", () => {
    beforeAll(async () => {
        await cleanup();
        for (const [id, data] of Object.entries(ROWS)) {
            await db.collection(COLLECTION).doc(id).set(data);
        }
    });
    afterAll(cleanup);

    // ─────────────────────────────────────────────────────────────────────────
    describe("not-in", () => {
        it("RETURNS EVERYTHING EXCEPT THE LISTED VALUES", async () => {
            // The defect: no `not-in` case, so this became
            // `raw_data->>'status' = 'cancelled,refunded'` and returned nothing.
            expect(await ids(db.collection(COLLECTION).where("status", "not-in", ["cancelled", "refunded"])))
                .toBe("a,e,f");
        });

        it("and EXCLUDES a document with no such field, like Firestore", async () => {
            // `raw_data->>'status'` is NULL for row d, and NULL NOT IN (…) is
            // NULL rather than true. Firestore's not-in drops a missing field
            // too, so the adapter and the model agree.
            const out = await ids(db.collection(COLLECTION).where("status", "not-in", ["cancelled"]));
            expect(out.split(",")).not.toContain("d");
        });

        it("and a value carrying a QUOTE excludes exactly that row", async () => {
            // Unescaped, `"say "no""` ends at the second quote and the rest
            // becomes separate list members — so row e came back.
            expect(await ids(db.collection(COLLECTION).where("status", "not-in", ['say "no"'])))
                .toBe("a,b,c,f");
        });

        it("and a value carrying a COMMA excludes exactly that row", async () => {
            expect(await ids(db.collection(COLLECTION).where("status", "not-in", ["a,b"])))
                .toBe("a,b,c,e");
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    describe("array-contains-any on a JSONB array", () => {
        it("MATCHES A DOCUMENT HOLDING ANY OF THE VALUES", async () => {
            // The defect: `ov` is `&&`, and PostgREST answered 42883
            // "operator does not exist: jsonb && unknown". An OR of `@>`
            // containments asks the same question in an operator jsonb has.
            // a holds red, c holds green, d holds red.
            expect(await ids(db.collection(COLLECTION).where("tags", "array-contains-any", ["red", "green"])))
                .toBe("a,c,d");
        });

        it("and a single value behaves like array-contains", async () => {
            expect(await ids(db.collection(COLLECTION).where("tags", "array-contains-any", ["blue"])))
                .toBe(await ids(db.collection(COLLECTION).where("tags", "array-contains", "blue")));
        });

        it("and values carrying a quote or a comma match exactly", async () => {
            // The logic-tree parser splits on commas, so the JSON payload has
            // to be quoted whole; unquoted, `cs.["a,b"]` is a parse error.
            expect(await ids(db.collection(COLLECTION).where("tags", "array-contains-any", ["a,b"]))).toBe("f");
            expect(await ids(db.collection(COLLECTION).where("tags", "array-contains-any", ['say "no"']))).toBe("e");
            expect(await ids(db.collection(COLLECTION).where("tags", "array-contains-any", ["a,b", "green"]))).toBe("c,f");
        });

        it("and an EMPTY list matches nothing, as the native column branch does", async () => {
            // Measured: `roles=ov.{}` on the native TEXT[] column returns no
            // rows. A caller passing a computed list that came back empty must
            // get the same answer whichever column shape the field has — a
            // difference there is the defect this finding is about.
            expect(await ids(db.collection(COLLECTION).where("tags", "array-contains-any", []))).toBe("<none>");
        });

        it("and an unmatched value returns nothing rather than everything", async () => {
            expect(await ids(db.collection(COLLECTION).where("tags", "array-contains-any", ["nope"]))).toBe("<none>");
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    describe("the operators that were already right", () => {
        it("!= excludes the value AND a document missing the field", async () => {
            expect(await ids(db.collection(COLLECTION).where("status", "!=", "cancelled"))).toBe("a,c,e,f");
        });

        it("in returns only the listed values", async () => {
            expect(await ids(db.collection(COLLECTION).where("status", "in", ["cancelled", "refunded"]))).toBe("b,c");
        });

        it("== finds one, and array-contains finds the arrays holding a value", async () => {
            expect(await ids(db.collection(COLLECTION).where("status", "==", "active"))).toBe("a");
            expect(await ids(db.collection(COLLECTION).where("tags", "array-contains", "red"))).toBe("a,d");
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    it("AN OPERATOR THE ADAPTER CANNOT EXPRESS THROWS — it does not return everything", async () => {
        // Both switches used to end in `default: query.eq(...)`, so an
        // unrecognised operator became an equality and the caller got a
        // confident wrong answer instead of an error.
        await expect(
            db.collection(COLLECTION).where("status", "like" as any, "act%").get(),
        ).rejects.toThrow(/Unsupported query operator "like"/);
    });
});
