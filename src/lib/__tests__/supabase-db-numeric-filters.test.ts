export {}; // module scope: supabase-db.test.ts declares the same names

/**
 * Numeric comparisons on raw_data fields.
 *
 * `raw_data->>'amount'` yields TEXT, so an ordering comparison against a number
 * was done lexicographically: '1000' > '900' is false. Any range filter on a
 * field not promoted to a native column silently skipped rows — including
 * money. where("amount", ">", 900) missed every amount beginning with a digit
 * below 9.
 *
 * The database does the comparing, so what is testable here is that the query
 * carries the cast. Whether Postgres then orders correctly is covered by the
 * integration suite.
 */

const CALLS: Array<{ method: string; column: string; value: any }> = [];

jest.mock("@/lib/supabase", () => {
    const record = (method: string) => (column: string, value: any) => {
        CALLS.push({ method, column, value });
        return chain;
    };
    const chain: any = {
        select: jest.fn(() => chain),
        eq: record("eq"),
        neq: record("neq"),
        lt: record("lt"),
        lte: record("lte"),
        gt: record("gt"),
        gte: record("gte"),
        in: record("in"),
        is: record("is"),
        not: jest.fn(() => chain),
        filter: jest.fn(() => chain),
        contains: jest.fn(() => chain),
        overlaps: jest.fn(() => chain),
        order: jest.fn(() => chain),
        limit: jest.fn(() => chain),
        range: jest.fn(() => Promise.resolve({ data: [], error: null })),
    };
    return { supabaseAdmin: { from: jest.fn(() => chain), rpc: jest.fn() } };
});

jest.mock("@/lib/cache-map", () => ({ invalidateCacheForCollection: jest.fn() }));

const { supabaseDb } =
    jest.requireActual<typeof import("@/lib/supabase-db")>("@/lib/supabase-db");

beforeEach(() => {
    CALLS.length = 0;
});

/** The filter call for a given method, if one was made. */
function callFor(method: string) {
    return CALLS.find((c) => c.method === method);
}

describe("ordering comparisons on numbers", () => {
    it("casts to numeric for >", async () => {
        // 'jest_numeric' is not a dedicated table, so amount lives in raw_data.
        await supabaseDb.collection("jest_numeric").where("amount", ">", 900).get();

        const call = callFor("gt");
        expect(call).toBeDefined();
        // Without ::numeric this compares '1000' > '900' as text and excludes it.
        expect(call!.column).toContain("::numeric");
        expect(call!.column).toContain("amount");
    });

    it("casts for <, <= and >= too", async () => {
        await supabaseDb.collection("jest_numeric").where("amount", "<", 100).get();
        expect(callFor("lt")!.column).toContain("::numeric");

        CALLS.length = 0;
        await supabaseDb.collection("jest_numeric").where("amount", "<=", 100).get();
        expect(callFor("lte")!.column).toContain("::numeric");

        CALLS.length = 0;
        await supabaseDb.collection("jest_numeric").where("amount", ">=", 100).get();
        expect(callFor("gte")!.column).toContain("::numeric");
    });

    it("casts a dotted path", async () => {
        await supabaseDb
            .collection("jest_numeric")
            .where("stats.totalPaid", ">", 500)
            .get();

        expect(callFor("gt")!.column).toContain("::numeric");
    });
});

describe("comparisons that must NOT be cast", () => {
    it("leaves a date comparison alone", async () => {
        // ISO-8601 strings already sort correctly as text, and ::numeric on one
        // would fail outright — turning a wrong answer into a broken query.
        await supabaseDb
            .collection("jest_numeric")
            .where("createdAt", ">=", new Date("2026-01-01"))
            .get();

        expect(callFor("gte")!.column).not.toContain("::numeric");
    });

    it("leaves a string comparison alone", async () => {
        await supabaseDb.collection("jest_numeric").where("name", ">", "M").get();

        expect(callFor("gt")!.column).not.toContain("::numeric");
    });

    it("leaves equality alone", async () => {
        // Equality on text is correct as-is, and casting would change which
        // rows match for fields holding numeric-looking strings.
        await supabaseDb.collection("jest_numeric").where("amount", "==", 900).get();

        expect(callFor("eq")!.column).not.toContain("::numeric");
    });

    it("does not cast a non-finite number", async () => {
        // An invalid cast would make the query error rather than return a
        // wrong answer; neither is useful, but erroring is worse.
        await supabaseDb.collection("jest_numeric").where("amount", ">", NaN).get();

        expect(callFor("gt")!.column).not.toContain("::numeric");
    });
});
