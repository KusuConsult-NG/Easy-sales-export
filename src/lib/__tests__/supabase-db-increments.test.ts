/**
 * Tests for atomic increment routing in src/lib/supabase-db.ts.
 *
 * FieldValue.increment used to be resolved in JavaScript against a value the
 * adapter had just read, which is a read-modify-write: two concurrent
 * increments computed the same result and one was silently lost. It is now
 * pushed into SQL (migration 010).
 *
 * The atomicity itself belongs to Postgres and is verified on staging with two
 * concurrent sessions. What is testable here is the routing, which is the part
 * that is easy to get wrong: `balance` is a real column on `wallets`, while
 * most counters live inside the raw_data JSONB blob. Sending a native column
 * down the JSONB path would write to the wrong place entirely.
 */

export {}; // module scope: supabase-db.test.ts declares the same names

const mockRpc = jest.fn();

jest.mock("@/lib/supabase", () => ({
    supabaseAdmin: {
        rpc: (...args: any[]) => mockRpc(...args),
        from: jest.fn(() => ({
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            is: jest.fn().mockReturnThis(),
            // The shape the adapter actually writes: buildDedicatedRow puts the
            // whole document in raw_data AND copies mapped fields to native
            // columns, so balance appears twice. Reads prefer raw_data.
            maybeSingle: jest.fn().mockResolvedValue({
                data: {
                    id: "acct-1",
                    balance: 100,
                    raw_data: { id: "acct-1", balance: 100, seen: 5 },
                },
                error: null,
            }),
            single: jest.fn().mockResolvedValue({ data: null, error: null }),
            insert: jest.fn().mockResolvedValue({ error: null }),
            update: jest.fn().mockReturnThis(),
            upsert: jest.fn().mockResolvedValue({ error: null }),
            delete: jest.fn().mockReturnThis(),
            match: jest.fn().mockResolvedValue({ error: null }),
            not: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            order: jest.fn().mockResolvedValue({ data: [], error: null }),
        })),
    },
}));

jest.mock("@/lib/cache-invalidation", () => ({
    invalidateUserCache: jest.fn(),
    invalidateAdminGlobalStats: jest.fn(),
    invalidateServiceCache: jest.fn(),
}));

const { SupabaseDocumentReference } =
    jest.requireActual<typeof import("@/lib/supabase-db")>("@/lib/supabase-db");
const { FieldValue } =
    jest.requireActual<typeof import("@/lib/firestore-compat")>("@/lib/firestore-compat");

beforeAll(() => {
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
});
afterAll(() => {
    (console.warn as jest.Mock).mockRestore();
    (console.error as jest.Mock).mockRestore();
});

beforeEach(() => {
    jest.clearAllMocks();
    mockRpc.mockResolvedValue({ data: null, error: null });
});

/** The apply_increments call, if one was made. */
function incrementCall() {
    return mockRpc.mock.calls.find((c) => c[0] === "apply_increments");
}

describe("increment routing", () => {
    it("sends a wallet balance to the native column, not raw_data", async () => {
        const ref = new SupabaseDocumentReference("wallets", "acct-1");
        await ref.update({ balance: FieldValue.increment(500) });

        const call = incrementCall();
        expect(call).toBeDefined();
        expect(call![1].p_table).toBe("wallets");
        expect(call![1].p_native).toEqual({ balance: 500 });
        expect(call![1].p_json).toEqual({});
    });

    it("sends a non-native field to raw_data", async () => {
        const ref = new SupabaseDocumentReference("wallets", "acct-1");
        await ref.update({ loginCount: FieldValue.increment(1) });

        const call = incrementCall();
        expect(call![1].p_native).toEqual({});
        expect(call![1].p_json).toEqual({ loginCount: 1 });
    });

    it("sends a dotted path to raw_data, never to a column", async () => {
        const ref = new SupabaseDocumentReference("users", "user-1");
        await ref.update({
            "serviceRegistrations.wave.waveEarningsBalance": FieldValue.increment(2_500),
        });

        const call = incrementCall();
        expect(call![1].p_native).toEqual({});
        expect(call![1].p_json).toEqual({
            "serviceRegistrations.wave.waveEarningsBalance": 2_500,
        });
    });

    it("passes the collection name for document_collections tables", async () => {
        const ref = new SupabaseDocumentReference("wallet_transactions", "txn-1");
        await ref.update({ retries: FieldValue.increment(1) });

        const call = incrementCall();
        expect(call![1].p_table).toBe("document_collections");
        expect(call![1].p_collection).toBe("wallet_transactions");
    });

    it("handles a negative increment, which is how debits are expressed", async () => {
        const ref = new SupabaseDocumentReference("wallets", "acct-1");
        await ref.update({ balance: FieldValue.increment(-250) });

        expect(incrementCall()![1].p_native).toEqual({ balance: -250 });
    });

    it("splits increments from ordinary fields in the same update", async () => {
        const ref = new SupabaseDocumentReference("wallets", "acct-1");
        await ref.update({
            balance: FieldValue.increment(100),
            status: "active",
        });

        // The increment goes to SQL; the plain field takes the normal path and
        // must not be dropped on the way.
        expect(incrementCall()![1].p_native).toEqual({ balance: 100 });
        const merge = mockRpc.mock.calls.find((c) => c[0] === "apply_document_patch");
        expect(merge).toBeDefined();
        expect(merge![1].p_patch.status).toBe("active");
        // And ONLY that field — the counter must reach the database once, from
        // apply_increments. See migration 017.
        expect(merge![1].p_patch).not.toHaveProperty("balance");
    });

    it("makes no increment call when the update has none", async () => {
        const ref = new SupabaseDocumentReference("wallets", "acct-1");
        await ref.update({ status: "active" });

        expect(incrementCall()).toBeUndefined();
    });
});

describe("fallback when the migration is not applied", () => {
    it("still writes, and warns that the result is not atomic", async () => {
        mockRpc.mockImplementation((fn: string) =>
            fn === "apply_increments"
                ? Promise.resolve({ data: null, error: { message: "function does not exist" } })
                : Promise.resolve({ data: null, error: null })
        );

        const ref = new SupabaseDocumentReference("wallets", "acct-1");
        await ref.update({ balance: FieldValue.increment(50) });

        // Falls back to the old read-modify-write: 100 read + 50 = 150.
        // Not atomic, but a write that happens beats a write that vanishes.
        const merge = mockRpc.mock.calls.find((c) => c[0] === "apply_document_patch");
        expect(merge).toBeDefined();
        expect(merge![1].p_patch.balance).toBe(150);
    });
});
