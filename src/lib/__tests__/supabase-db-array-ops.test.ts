/**
 * Tests for atomic array-op routing in src/lib/supabase-db.ts.
 *
 * FieldValue.arrayUnion and arrayRemove used to be resolved in JavaScript
 * against a value the adapter had just read — a read-modify-write. Two
 * concurrent writers each kept their own element and lost the other's. They are
 * now pushed into SQL (migration 016).
 *
 * WHY THIS ONE MATTERS MORE THAN THE INCREMENT EQUIVALENT
 * ------------------------------------------------------
 * 33 of the ~38 call sites are `roles: FieldValue.arrayUnion(...)` on users,
 * and `roles` is what every module-access check reads. A lost element is a
 * paying member with no access to the module they paid for — and re-granting
 * the role "fixes" it right up until the next concurrent write.
 *
 * The atomicity belongs to Postgres and is verified against a real database in
 * __tests__/db-integration/array-ops.test.ts. What is testable here is the
 * routing, and the routing has a specific trap: `roles` is a native TEXT[]
 * column AND a raw_data key. Sending it down one path only is exactly how the
 * wallet balance fix (005/006) ended up invisible to the application.
 */

export {}; // module scope: other adapter tests declare the same names

const mockRpc = jest.fn();

jest.mock("@/lib/supabase", () => ({
    supabaseAdmin: {
        rpc: (...args: any[]) => mockRpc(...args),
        from: jest.fn(() => ({
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            is: jest.fn().mockReturnThis(),
            maybeSingle: jest.fn().mockResolvedValue({
                data: {
                    id: "user-1",
                    roles: ["buyer"],
                    raw_data: { id: "user-1", roles: ["buyer"], tags: ["a"] },
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

/** The apply_array_ops call, if one was made. */
function arrayCall() {
    return mockRpc.mock.calls.find((c) => c[0] === "apply_array_ops");
}

describe("array-op routing", () => {
    it("sends a role grant to the database rather than resolving it here", async () => {
        // The whole point. If this ever stops being called, the 33 role-grant
        // sites are silently back to losing writes.
        const ref = new SupabaseDocumentReference("users", "user-1");
        await ref.update({ roles: FieldValue.arrayUnion("seller") });

        const call = arrayCall();
        expect(call).toBeDefined();
        expect(call![1].p_table).toBe("users");
        expect(call![1].p_native).toEqual({ roles: { union: ["seller"] } });
        expect(call![1].p_json).toEqual({});
    });

    it("routes roles as a native column, because it is one", async () => {
        // roles is TEXT[] on users AND a raw_data key. Migration 016 writes
        // both from one expression; sending it down the JSON path alone would
        // leave the column stale and break every .where() filter on it.
        const ref = new SupabaseDocumentReference("users", "user-1");
        await ref.update({ roles: FieldValue.arrayRemove("buyer") });

        const call = arrayCall();
        expect(call![1].p_native).toEqual({ roles: { remove: ["buyer"] } });
        expect(call![1].p_json).toEqual({});
    });

    it("sends a non-native array field to raw_data", async () => {
        const ref = new SupabaseDocumentReference("users", "user-1");
        await ref.update({ tags: FieldValue.arrayUnion("vip") });

        const call = arrayCall();
        expect(call![1].p_native).toEqual({});
        expect(call![1].p_json).toEqual({ tags: { union: ["vip"] } });
    });

    it("sends a dotted path to raw_data, never to a column", async () => {
        const ref = new SupabaseDocumentReference("users", "user-1");
        await ref.update({ "profile.badges": FieldValue.arrayUnion("early") });

        const call = arrayCall();
        expect(call![1].p_native).toEqual({});
        expect(call![1].p_json).toEqual({ "profile.badges": { union: ["early"] } });
    });

    it("keeps object elements out of a native TEXT[] column", async () => {
        // A native array column cannot hold an object. Routing it there would
        // make the database reject the whole write; raw_data holds it fine.
        const doc = { url: "https://example.com/a.pdf", type: "invoice" };
        const ref = new SupabaseDocumentReference("users", "user-1");
        await ref.update({ roles: FieldValue.arrayUnion(doc) });

        const call = arrayCall();
        expect(call![1].p_native).toEqual({});
        expect(call![1].p_json).toEqual({ roles: { union: [doc] } });
    });

    it("carries every element of a multi-element union", async () => {
        // FieldValue.arrayUnion(...roles) is spread at two call sites. Dropping
        // all but the first would be invisible until someone lost a role.
        const ref = new SupabaseDocumentReference("users", "user-1");
        await ref.update({ roles: FieldValue.arrayUnion("farmer", "land_owner") });

        const call = arrayCall();
        expect(call![1].p_native).toEqual({ roles: { union: ["farmer", "land_owner"] } });
    });

    it("passes ordinary fields through the normal write path untouched", async () => {
        const ref = new SupabaseDocumentReference("users", "user-1");
        await ref.update({
            roles: FieldValue.arrayUnion("seller"),
            isVerified: true,
        });

        // The array op goes to the RPC; isVerified goes through merge_raw_data.
        expect(arrayCall()![1].p_native).toEqual({ roles: { union: ["seller"] } });

        const mergeCall = mockRpc.mock.calls.find((c) => c[0] === "apply_document_patch");
        expect(mergeCall![1].p_patch).toHaveProperty("isVerified", true);
        expect(mergeCall![1].p_patch).not.toHaveProperty("roles");
    });

    it("leaves increments to their own path", async () => {
        // Both sentinels in one write must each reach their own function.
        const ref = new SupabaseDocumentReference("users", "user-1");
        await ref.update({
            roles: FieldValue.arrayUnion("seller"),
            loginCount: FieldValue.increment(1),
        });

        expect(arrayCall()![1].p_native).toEqual({ roles: { union: ["seller"] } });

        const incCall = mockRpc.mock.calls.find((c) => c[0] === "apply_increments");
        expect(incCall![1].p_json).toEqual({ loginCount: 1 });
    });

    it("makes no array call when the write has no array ops", async () => {
        const ref = new SupabaseDocumentReference("users", "user-1");
        await ref.update({ isVerified: true });

        expect(arrayCall()).toBeUndefined();
    });
});

describe("the stale-value clobber", () => {
    // The write used to carry the WHOLE document, so it also carried a stale
    // copy of the field the atomic function was about to change: write the
    // stale document, undoing a concurrent writer, then apply our own change on
    // top. The SQL function is only atomic if the value reaches the database
    // once. buildWritePatch now sends only what changed (migration 017).

    it("does not write a stale array back alongside the atomic op", async () => {
        const ref = new SupabaseDocumentReference("users", "user-1");
        await ref.update({ roles: FieldValue.arrayUnion("seller"), isVerified: true });

        const mergeCall = mockRpc.mock.calls.find((c) => c[0] === "apply_document_patch");
        expect(mergeCall![1].p_patch).not.toHaveProperty("roles");
    });

    it("does not write a stale counter back alongside the atomic op", async () => {
        // Same defect on the increment path, which migration 010 left behind.
        const ref = new SupabaseDocumentReference("users", "user-1");
        await ref.update({ loginCount: FieldValue.increment(1), isVerified: true });

        const mergeCall = mockRpc.mock.calls.find((c) => c[0] === "apply_document_patch");
        expect(mergeCall![1].p_patch).not.toHaveProperty("loginCount");
    });

    it("sends a dotted path as a path, not as its whole parent object", async () => {
        // The sibling that must survive. Carrying the whole `profile` object
        // would revert a concurrent change to any other field inside it.
        const ref = new SupabaseDocumentReference("users", "user-1");
        await ref.update({
            "profile.badges": FieldValue.arrayUnion("early"),
            "profile.displayName": "Ada",
        });

        const call = mockRpc.mock.calls.find((c) => c[0] === "apply_document_patch");
        expect(call![1].p_paths).toEqual({ "profile.displayName": "Ada" });
        expect(call![1].p_patch).not.toHaveProperty("profile");
    });
});

describe("set(..., { merge: true })", () => {
    it("routes a role grant through the database on an existing document", async () => {
        // The cooperative membership grant uses transaction.set(..., merge),
        // not update(). Fixing update() alone would have left the paid-member
        // role still dropping under concurrency.
        const ref = new SupabaseDocumentReference("users", "user-1");
        await ref.set({ roles: FieldValue.arrayUnion("cooperative_member") }, { merge: true });

        const call = arrayCall();
        expect(call).toBeDefined();
        expect(call![1].p_native).toEqual({ roles: { union: ["cooperative_member"] } });
    });

    it("routes an increment through the database too", async () => {
        // Migration 010 fixed update() only; set(merge) kept resolving
        // increments in JavaScript.
        const ref = new SupabaseDocumentReference("users", "user-1");
        await ref.set({ loginCount: FieldValue.increment(1) }, { merge: true });

        const incCall = mockRpc.mock.calls.find((c) => c[0] === "apply_increments");
        expect(incCall).toBeDefined();
        expect(incCall![1].p_json).toEqual({ loginCount: 1 });
    });

    it("still resolves in JavaScript when the document does not exist", async () => {
        // Nothing to race against, and the upsert needs concrete values rather
        // than a sentinel it cannot store.
        const { supabaseAdmin } = jest.requireMock("@/lib/supabase");
        supabaseAdmin.from.mockReturnValueOnce({
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            is: jest.fn().mockReturnThis(),
            maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
        });

        const ref = new SupabaseDocumentReference("users", "new-user");
        await ref.set({ roles: FieldValue.arrayUnion("buyer") }, { merge: true });

        expect(arrayCall()).toBeUndefined();
    });
});
