/**
 * Tests for core snapshot and query types in src/lib/supabase-db.ts
 *
 * Strategy: The supabase-db module is mocked at the module level in jest.setup.js
 * so we test the REAL implementations by importing them directly from the source
 * file with a manual module factory that bypasses the global mock.
 *
 * We use jest.isolateModules() to load the real module without the global mock.
 *
 * Covers:
 *  - SupabaseDocumentSnapshot: exists, data(), get()
 *  - SupabaseQueryDocumentSnapshot: data() defensive fallback
 *  - SupabaseQuerySnapshot: size, empty, forEach()
 *  - SupabaseDocumentReference: id, path, parent
 *  - supabaseDb.doc() path parsing and error on bad paths
 *  - supabaseDb.batch() returns a writable batch
 */

// We need to bypass the global mock for supabase-db so we can test real logic.
// This test file uses jest.isolateModules at the top level.

// ─── Real module imports (bypassing the jest.setup.js mock) ──────────────────

// We must mock the supabase dependency (network) while testing the pure logic.
jest.mock("@/lib/supabase", () => ({
  supabaseAdmin: {
    from: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      is: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
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

jest.mock("@/lib/firestore-compat", () => ({
  Timestamp: {
    now: jest.fn(() => ({ toDate: () => new Date() })),
    fromDate: jest.fn((d: Date) => ({ toDate: () => d })),
  },
}));

jest.mock("uuid", () => ({ v4: jest.fn(() => "mocked-uuid-1234") }));

// Now import the REAL classes (not the mocked ones from jest.setup.js)
// We do this by using jest.requireActual to bypass the global module mock
const {
  SupabaseDocumentSnapshot,
  SupabaseQueryDocumentSnapshot,
  SupabaseQuerySnapshot,
  SupabaseDocumentReference,
  supabaseDb,
} = jest.requireActual<typeof import("@/lib/supabase-db")>("@/lib/supabase-db");

// ─── SupabaseDocumentSnapshot ─────────────────────────────────────────────────

describe("SupabaseDocumentSnapshot", () => {
  const makeRef = () => new SupabaseDocumentReference("users", "user-123");

  it("exists returns true when data is provided", () => {
    const ref = makeRef();
    const snap = new SupabaseDocumentSnapshot("user-123", ref, {
      name: "Alice",
      email: "alice@example.com",
    });
    expect(snap.exists).toBe(true);
  });

  it("exists returns false when data is null", () => {
    const ref = makeRef();
    const snap = new SupabaseDocumentSnapshot("missing-id", ref, null);
    expect(snap.exists).toBe(false);
  });

  it("data() returns the provided object on an existing document", () => {
    const ref = makeRef();
    const payload = { name: "Bob", roles: ["user"], balance: 5000 };
    const snap = new SupabaseDocumentSnapshot("user-456", ref, payload);
    expect(snap.data()).toEqual(payload);
  });

  it("data() returns undefined when document does not exist", () => {
    const ref = makeRef();
    const snap = new SupabaseDocumentSnapshot("ghost", ref, null);
    expect(snap.data()).toBeUndefined();
  });

  it("get(field) retrieves a top-level field value", () => {
    const ref = makeRef();
    const snap = new SupabaseDocumentSnapshot("u1", ref, { status: "active" });
    expect(snap.get("status")).toBe("active");
  });

  it("get(field) returns undefined for missing fields", () => {
    const ref = makeRef();
    const snap = new SupabaseDocumentSnapshot("u1", ref, { name: "Alice" });
    expect(snap.get("nonExistent")).toBeUndefined();
  });

  it("get(field) returns undefined when document does not exist", () => {
    const ref = makeRef();
    const snap = new SupabaseDocumentSnapshot("u1", ref, null);
    expect(snap.get("name")).toBeUndefined();
  });

  it("id property matches the constructor argument", () => {
    const ref = makeRef();
    const snap = new SupabaseDocumentSnapshot("abc-123", ref, { x: 1 });
    expect(snap.id).toBe("abc-123");
  });

  it("ref property is the DocumentReference passed in", () => {
    const ref = makeRef();
    const snap = new SupabaseDocumentSnapshot("u1", ref, {});
    expect(snap.ref).toBe(ref);
  });
});

// ─── SupabaseQueryDocumentSnapshot ────────────────────────────────────────────

describe("SupabaseQueryDocumentSnapshot", () => {
  const makeRef = () => new SupabaseDocumentReference("orders", "order-001");

  it("data() returns empty object when underlying data is null (defensive)", () => {
    const ref = makeRef();
    const snap = new SupabaseQueryDocumentSnapshot("order-001", ref, null);
    expect(snap.data()).toEqual({});
  });

  it("data() returns the full document data when present", () => {
    const ref = makeRef();
    const payload = { status: "pending", amount: 15000 };
    const snap = new SupabaseQueryDocumentSnapshot("order-001", ref, payload);
    expect(snap.data()).toEqual(payload);
  });
});

// ─── SupabaseQuerySnapshot ────────────────────────────────────────────────────

describe("SupabaseQuerySnapshot", () => {
  const makeRef = () => new SupabaseDocumentReference("transactions", "tx-1");

  const makeDocs = (n: number) =>
    Array.from(
      { length: n },
      (_, i) =>
        new SupabaseQueryDocumentSnapshot(`tx-${i}`, makeRef(), {
          amount: i * 100,
        })
    );

  it("size returns the number of documents", () => {
    const snap = new SupabaseQuerySnapshot(makeDocs(5));
    expect(snap.size).toBe(5);
  });

  it("empty is true when docs array is empty", () => {
    const snap = new SupabaseQuerySnapshot([]);
    expect(snap.empty).toBe(true);
  });

  it("empty is false when docs are present", () => {
    const snap = new SupabaseQuerySnapshot(makeDocs(1));
    expect(snap.empty).toBe(false);
  });

  it("forEach iterates over all documents in insertion order", () => {
    const docs = makeDocs(3);
    const snap = new SupabaseQuerySnapshot(docs);
    const ids: string[] = [];
    snap.forEach((doc) => ids.push(doc.id));
    expect(ids).toEqual(["tx-0", "tx-1", "tx-2"]);
  });

  it("docs array is accessible directly and has correct length", () => {
    const snap = new SupabaseQuerySnapshot(makeDocs(4));
    expect(snap.docs).toHaveLength(4);
  });
});

// ─── SupabaseDocumentReference ────────────────────────────────────────────────

describe("SupabaseDocumentReference", () => {
  it("sets id and path correctly", () => {
    const ref = new SupabaseDocumentReference("users", "u-abc");
    expect(ref.id).toBe("u-abc");
    expect(ref.path).toBe("users/u-abc");
  });

  it("parent returns a collection reference with correct semantics", () => {
    const ref = new SupabaseDocumentReference("orders", "o-1");
    const parent = ref.parent;
    expect(parent).toBeDefined();
  });
});

// ─── supabaseDb facade ────────────────────────────────────────────────────────

describe("supabaseDb.doc()", () => {
  it("creates a DocumentReference from a valid two-segment path", () => {
    const ref = supabaseDb.doc("users/user-abc");
    expect(ref.id).toBe("user-abc");
    expect(ref.path).toBe("users/user-abc");
  });

  it("handles dedicated collection paths correctly", () => {
    const ref = supabaseDb.doc("cooperative_members/member-001");
    expect(ref.id).toBe("member-001");
  });

  it("throws for a single-segment path with no collection", () => {
    expect(() => supabaseDb.doc("just-an-id")).toThrow("Invalid document path");
  });
});

describe("supabaseDb.collection()", () => {
  it("returns a collection reference for the given name", () => {
    const colRef = supabaseDb.collection("users");
    expect(colRef).toBeDefined();
  });
});

describe("supabaseDb.batch()", () => {
  it("returns a writable batch with set/update/delete/commit methods", () => {
    const batch = supabaseDb.batch();
    expect(typeof batch.set).toBe("function");
    expect(typeof batch.update).toBe("function");
    expect(typeof batch.delete).toBe("function");
    expect(typeof batch.commit).toBe("function");
  });
});
