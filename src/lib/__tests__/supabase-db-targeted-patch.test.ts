/**
 * Tests that a write sends only the fields it changes.
 *
 * WHY THIS MATTERS
 * ----------------
 * `processWriteData(data, existing, true)` started from `{ ...existingData }`,
 * so every update() sent the WHOLE document back. Two concurrent updates to
 * completely unrelated fields therefore clobbered one another — whoever wrote
 * second reverted the other, using a snapshot taken moments earlier, and
 * nothing errored.
 *
 * That is not a money bug or an array bug. It is every field in every
 * collection, and it is the most plausible general mechanism behind fixes that
 * "keep breaking": a value is corrected and an unrelated concurrent write
 * reverts it.
 *
 * It also silently undermined migrations 010 and 016, because the stale copy of
 * a counter or array rode along in that patch.
 *
 * The three shapes below are separate because Firestore distinguishes them and
 * a shallow merge cannot express all three. See migration 017.
 */

export {}; // module scope: other adapter tests declare the same names

const mockRpc = jest.fn();

const EXISTING = {
    id: "user-1",
    email: "ada@example.com",
    keep: 1,
    doomed: "x",
    profile: { name: "Ada", city: "Jos" },
};

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
                    email: "ada@example.com",
                    raw_data: {
                        id: "user-1",
                        email: "ada@example.com",
                        keep: 1,
                        doomed: "x",
                        profile: { name: "Ada", city: "Jos" },
                    },
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

function patchCall() {
    return mockRpc.mock.calls.find((c) => c[0] === "apply_document_patch");
}

describe("only changed fields are sent", () => {
    it("does not carry along the fields it is not changing", async () => {
        // THE test. `doomed` and `profile` were in the patch before, so a
        // concurrent change to either was reverted by an update to `keep`.
        const ref = new SupabaseDocumentReference("users", "user-1");
        await ref.update({ keep: 2 });

        const call = patchCall();
        expect(call).toBeDefined();
        expect(call![1].p_patch).toEqual({ keep: 2 });
        expect(call![1].p_patch).not.toHaveProperty("doomed");
        expect(call![1].p_patch).not.toHaveProperty("profile");
        expect(call![1].p_patch).not.toHaveProperty("email");
    });

    it("sends several changed fields together and nothing else", async () => {
        const ref = new SupabaseDocumentReference("users", "user-1");
        await ref.update({ keep: 2, status: "active" });

        expect(patchCall()![1].p_patch).toEqual({ keep: 2, status: "active" });
    });

    it("resolves a server timestamp to a value without carrying the document", async () => {
        const ref = new SupabaseDocumentReference("users", "user-1");
        await ref.update({ updatedAt: FieldValue.serverTimestamp() });

        const patch = patchCall()![1].p_patch;
        expect(Object.keys(patch)).toEqual(["updatedAt"]);
        expect(typeof patch.updatedAt).toBe("string");
    });
});

describe("dotted paths", () => {
    it("sends a path rather than its whole parent object", async () => {
        // Carrying `profile` wholesale is what reverted a concurrent change to
        // profile.name while setting profile.city.
        const ref = new SupabaseDocumentReference("users", "user-1");
        await ref.update({ "profile.city": "Abuja" });

        const call = patchCall();
        expect(call![1].p_paths).toEqual({ "profile.city": "Abuja" });
        expect(call![1].p_patch).not.toHaveProperty("profile");
    });

    it("keeps a top-level object assignment as a replacement", async () => {
        // Firestore semantics: assigning an object REPLACES it. This must not
        // quietly become a merge.
        const ref = new SupabaseDocumentReference("users", "user-1");
        await ref.update({ profile: { name: "Grace" } });

        const call = patchCall();
        expect(call![1].p_patch).toEqual({ profile: { name: "Grace" } });
        expect(call![1].p_paths).toEqual({});
    });
});

describe("FieldValue.delete", () => {
    it("actually removes the field", async () => {
        // This never worked. The patch simply omitted the key, and
        // `raw_data || patch` only adds and replaces — it never removes. So
        // FieldValue.delete() was a silent no-op on this path.
        const ref = new SupabaseDocumentReference("users", "user-1");
        await ref.update({ doomed: FieldValue.delete() });

        const call = patchCall();
        expect(call![1].p_deletes).toEqual(["doomed"]);
        expect(call![1].p_patch).toEqual({});
    });

    it("removes a nested field by path", async () => {
        const ref = new SupabaseDocumentReference("users", "user-1");
        await ref.update({ "profile.city": FieldValue.delete() });

        expect(patchCall()![1].p_deletes).toEqual(["profile.city"]);
    });

    it("deletes and updates in the same write", async () => {
        const ref = new SupabaseDocumentReference("users", "user-1");
        await ref.update({ keep: 3, doomed: FieldValue.delete() });

        const call = patchCall();
        expect(call![1].p_patch).toEqual({ keep: 3 });
        expect(call![1].p_deletes).toEqual(["doomed"]);
    });
});

describe("interaction with the atomic functions", () => {
    it("never sends a counter or an array in the patch", async () => {
        // Both must reach the database exactly once, from their own function.
        const ref = new SupabaseDocumentReference("users", "user-1");
        await ref.update({
            keep: 2,
            loginCount: FieldValue.increment(1),
            roles: FieldValue.arrayUnion("seller"),
        });

        const patch = patchCall()![1].p_patch;
        expect(patch).toEqual({ keep: 2 });
        expect(patch).not.toHaveProperty("loginCount");
        expect(patch).not.toHaveProperty("roles");

        expect(mockRpc.mock.calls.find((c) => c[0] === "apply_increments")).toBeDefined();
        expect(mockRpc.mock.calls.find((c) => c[0] === "apply_array_ops")).toBeDefined();
    });

    it("makes no patch call when the write is only atomic operations", async () => {
        const ref = new SupabaseDocumentReference("users", "user-1");
        await ref.update({ loginCount: FieldValue.increment(1) });

        expect(patchCall()).toBeUndefined();
    });
});

describe("fallback when migration 017 is not applied", () => {
    it("uses merge_raw_data for a plain patch", async () => {
        // The common case still avoids reading the document first.
        mockRpc.mockImplementation((fn: string) =>
            fn === "apply_document_patch"
                ? Promise.resolve({ data: null, error: { message: "function does not exist" } })
                : Promise.resolve({ data: null, error: null })
        );

        const ref = new SupabaseDocumentReference("users", "user-1");
        await ref.update({ keep: 2 });

        const legacy = mockRpc.mock.calls.find((c) => c[0] === "merge_raw_data");
        expect(legacy).toBeDefined();
        expect(legacy![1].p_patch).toEqual({ keep: 2 });
    });

    it("does not send a delete through merge_raw_data, which cannot express it", async () => {
        // Passing a delete to merge_raw_data would report success and remove
        // nothing — exactly the silent no-op being fixed. It must take the
        // JavaScript path instead.
        mockRpc.mockImplementation((fn: string) =>
            fn === "apply_document_patch"
                ? Promise.resolve({ data: null, error: { message: "function does not exist" } })
                : Promise.resolve({ data: null, error: null })
        );

        const ref = new SupabaseDocumentReference("users", "user-1");
        await ref.update({ doomed: FieldValue.delete() });

        expect(mockRpc.mock.calls.find((c) => c[0] === "merge_raw_data")).toBeUndefined();
    });
});
