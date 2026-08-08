export {}; // module scope: supabase-db.test.ts declares the same names

/**
 * Tests for whole-collection reads in src/lib/supabase-db.ts.
 *
 * The 5,000-row default cap is right for screens and wrong for sweeps. A repair
 * script that silently processes the first 5,000 of ~41,000 users and reports
 * success is how a fixed bug appears to come back: it was only ever fixed for
 * 12% of people.
 *
 * `.all()` says the whole collection is genuinely meant. `snapshot.truncated`
 * lets any caller detect a short result rather than trusting the length.
 */

const RANGE_CALLS: Array<[number, number]> = [];
let TOTAL_ROWS = 0;

jest.mock("@/lib/supabase", () => ({
    supabaseAdmin: {
        rpc: jest.fn().mockResolvedValue({ data: null, error: null }),
        from: jest.fn(() => {
            const chain: any = {
                select: jest.fn(() => chain),
                eq: jest.fn(() => chain),
                is: jest.fn(() => chain),
                not: jest.fn(() => chain),
                order: jest.fn(() => chain),
                limit: jest.fn(() => chain),
                // Serve rows from a synthetic table of TOTAL_ROWS.
                range: jest.fn((start: number, end: number) => {
                    RANGE_CALLS.push([start, end]);
                    const rows = [];
                    for (let i = start; i <= end && i < TOTAL_ROWS; i++) {
                        rows.push({ id: `row-${i}`, raw_data: { id: `row-${i}`, n: i } });
                    }
                    return Promise.resolve({ data: rows, error: null });
                }),
            };
            return chain;
        }),
    },
}));

jest.mock("@/lib/cache-map", () => ({ invalidateCacheForCollection: jest.fn() }));

const { supabaseDb } =
    jest.requireActual<typeof import("@/lib/supabase-db")>("@/lib/supabase-db");

beforeAll(() => {
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
});
afterAll(() => {
    (console.warn as jest.Mock).mockRestore();
    (console.error as jest.Mock).mockRestore();
});

beforeEach(() => {
    RANGE_CALLS.length = 0;
});

describe("default cap", () => {
    it("stops at 5,000 rows and marks the result truncated", async () => {
        TOTAL_ROWS = 41_000;

        const snap = await supabaseDb.collection("users").get();

        expect(snap.docs.length).toBe(5_000);
        // Without this flag a caller sees 5,000 rows and cannot tell whether
        // that is the whole table.
        expect(snap.truncated).toBe(true);
    });

    it("is not marked truncated when the data simply runs out", async () => {
        TOTAL_ROWS = 120;

        const snap = await supabaseDb.collection("users").get();

        expect(snap.docs.length).toBe(120);
        expect(snap.truncated).toBe(false);
    });

    it("is not marked truncated when an explicit limit is reached", async () => {
        TOTAL_ROWS = 41_000;

        const snap = await supabaseDb.collection("users").limit(10).get();

        expect(snap.docs.length).toBe(10);
        // The caller asked for 10 and got 10 — nothing was lost.
        expect(snap.truncated).toBe(false);
    });
});

describe(".all()", () => {
    it("reads past the cap, to every row", async () => {
        TOTAL_ROWS = 41_000;

        const snap = await supabaseDb.collection("users").all().get();

        // The whole point: 41,000, not 5,000.
        expect(snap.docs.length).toBe(41_000);
        expect(snap.truncated).toBe(false);
    });

    it("still batches rather than asking for everything at once", async () => {
        TOTAL_ROWS = 41_000;

        await supabaseDb.collection("users").all().get();

        // 41 batches of 1,000, plus one empty read: when the total divides
        // exactly by the batch size the loop cannot know it is finished until a
        // batch comes back short. One extra round trip, not a defect.
        expect(RANGE_CALLS.length).toBe(42);
        for (const [start, end] of RANGE_CALLS) {
            expect(end - start + 1).toBeLessThanOrEqual(1_000);
        }
    });

    it("needs no extra read when the total is not a multiple of the batch size", async () => {
        TOTAL_ROWS = 41_500;

        await supabaseDb.collection("users").all().get();

        // The 42nd batch returns 500 — short, so the loop stops there.
        expect(RANGE_CALLS.length).toBe(42);
    });

    it("survives being combined with other builder calls", async () => {
        TOTAL_ROWS = 7_500;

        const snap = await supabaseDb
            .collection("users")
            .where("status", "==", "active")
            .select("name")
            .all()
            .get();

        // .all() must not be dropped by the clone that each builder call makes.
        expect(snap.docs.length).toBe(7_500);
    });

    it("works when .all() comes before the other calls", async () => {
        TOTAL_ROWS = 7_500;

        const snap = await supabaseDb
            .collection("users")
            .all()
            .where("status", "==", "active")
            .get();

        expect(snap.docs.length).toBe(7_500);
    });
});
