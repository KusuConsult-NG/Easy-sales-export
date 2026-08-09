/**
 * Targeted document writes, against a real Postgres.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The unit tests prove the SHAPE of the write — that only changed fields are
 * sent, that a dotted path stays a path, that a delete is a delete. They cannot
 * prove the consequence, which is that two concurrent writers to unrelated
 * fields both survive. That needs real concurrent sessions.
 *
 * The delete tests matter for a different reason: FieldValue.delete() was a
 * silent no-op on this path. The patch simply omitted the key, and
 * `raw_data || patch` only adds and replaces. A test asserting the field is
 * gone is the only thing that would have caught it.
 *
 * Requires migration 017.
 */

import { supabaseAdmin } from "@/lib/supabase";
import { supabaseDb as db } from "@/lib/supabase-db";
import { FieldValue } from "@/lib/firestore-compat";
import { COLLECTIONS } from "@/lib/types/firestore";

declare const maybeDescribe: jest.Describe;

const TEST_PREFIX = "jest-db-";
const userId = `${TEST_PREFIX}patch-user`;

async function cleanup() {
    await supabaseAdmin.from("users").delete().like("id", `${TEST_PREFIX}%`);
}

async function seed(extra: Record<string, any> = {}) {
    const raw = {
        id: userId,
        email: `${userId}@example.com`,
        keep: 1,
        doomed: "x",
        profile: { name: "Ada", city: "Jos" },
        ...extra,
    };
    await supabaseAdmin.from("users").upsert({
        id: userId,
        email: raw.email,
        raw_data: raw,
    });
}

/** Reads the way the APPLICATION does, through the adapter. */
async function readAsApp(): Promise<Record<string, any>> {
    const snap = await db.collection(COLLECTIONS.USERS).doc(userId).get();
    return snap.data() ?? {};
}

maybeDescribe("targeted document writes, against real Postgres", () => {
    beforeEach(cleanup);
    afterAll(cleanup);

    describe("concurrent writes to unrelated fields", () => {
        it("keeps both changes", async () => {
            // THE test. Each writer used to send the whole document, so the one
            // that committed second reverted the other's field. Nothing errored,
            // and the reverted value looked like a fix that stopped working.
            await seed();
            const ref = db.collection(COLLECTIONS.USERS).doc(userId);

            await Promise.all([
                ref.update({ fieldA: "from-A" }),
                ref.update({ fieldB: "from-B" }),
            ]);

            const doc = await readAsApp();
            expect(doc.fieldA).toBe("from-A");
            expect(doc.fieldB).toBe("from-B");
        });

        it("keeps every change under a burst", async () => {
            await seed();
            const ref = db.collection(COLLECTIONS.USERS).doc(userId);
            const fields = ["f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8"];

            await Promise.all(fields.map(f => ref.update({ [f]: f })));

            const doc = await readAsApp();
            for (const f of fields) expect(doc[f]).toBe(f);
        });

        it("does not revert an untouched field", async () => {
            await seed();
            const ref = db.collection(COLLECTIONS.USERS).doc(userId);

            await ref.update({ keep: 2 });

            const doc = await readAsApp();
            expect(doc.doomed).toBe("x");
            expect(doc.profile).toEqual({ name: "Ada", city: "Jos" });
            expect(doc.email).toBe(`${userId}@example.com`);
        });
    });

    describe("dotted paths", () => {
        it("changes one key and leaves its siblings alone", async () => {
            await seed();

            await db.collection(COLLECTIONS.USERS).doc(userId).update({
                "profile.city": "Abuja",
            });

            expect((await readAsApp()).profile).toEqual({ name: "Ada", city: "Abuja" });
        });

        it("keeps concurrent changes to two keys of the same object", async () => {
            // The case that made the whole-document write so damaging: both
            // writers carried the entire `profile` object.
            await seed();
            const ref = db.collection(COLLECTIONS.USERS).doc(userId);

            await Promise.all([
                ref.update({ "profile.city": "Abuja" }),
                ref.update({ "profile.name": "Grace" }),
            ]);

            expect((await readAsApp()).profile).toEqual({ name: "Grace", city: "Abuja" });
        });

        it("creates a path whose parent does not exist yet", async () => {
            await seed();

            await db.collection(COLLECTIONS.USERS).doc(userId).update({
                "settings.notifications.email": true,
            });

            expect((await readAsApp()).settings).toEqual({ notifications: { email: true } });
        });

        it("replaces the whole object on a top-level assignment", async () => {
            // Firestore semantics. Assigning an object replaces it; this must
            // not have quietly become a merge.
            await seed();

            await db.collection(COLLECTIONS.USERS).doc(userId).update({
                profile: { name: "Grace" },
            });

            expect((await readAsApp()).profile).toEqual({ name: "Grace" });
        });
    });

    describe("FieldValue.delete", () => {
        it("actually removes a field", async () => {
            // This never worked. `raw_data || patch` cannot remove a key, so the
            // field survived every delete.
            await seed();

            await db.collection(COLLECTIONS.USERS).doc(userId).update({
                doomed: FieldValue.delete(),
            });

            const doc = await readAsApp();
            expect(doc.doomed).toBeUndefined();
            expect(doc.keep).toBe(1);
        });

        it("removes a nested field without touching its siblings", async () => {
            await seed();

            await db.collection(COLLECTIONS.USERS).doc(userId).update({
                "profile.city": FieldValue.delete(),
            });

            expect((await readAsApp()).profile).toEqual({ name: "Ada" });
        });

        it("deletes and updates in the same write", async () => {
            await seed();

            await db.collection(COLLECTIONS.USERS).doc(userId).update({
                keep: 3,
                doomed: FieldValue.delete(),
            });

            const doc = await readAsApp();
            expect(doc.keep).toBe(3);
            expect(doc.doomed).toBeUndefined();
        });
    });

    describe("alongside the atomic functions", () => {
        it("does not revert a concurrent counter or role change", async () => {
            // 010 and 016 were being undermined by the stale copy riding along
            // in the patch. This is the end-to-end check that they are not.
            await seed({ loginCount: 0 });
            await supabaseAdmin.from("users").update({ roles: ["buyer"] }).eq("id", userId);
            await supabaseAdmin.rpc("apply_document_patch", {
                p_table: "users", p_id: userId, p_collection: null,
                p_patch: { roles: ["buyer"] }, p_paths: {}, p_deletes: [],
            });

            const ref = db.collection(COLLECTIONS.USERS).doc(userId);
            await Promise.all([
                ref.update({ keep: 99 }),
                ref.update({ loginCount: FieldValue.increment(1) }),
                ref.update({ roles: FieldValue.arrayUnion("seller") }),
            ]);

            const doc = await readAsApp();
            expect(doc.keep).toBe(99);
            expect(Number(doc.loginCount)).toBe(1);
            expect(doc.roles).toContain("seller");
            expect(doc.roles).toContain("buyer");
        });
    });
});

/**
 * set(..., { merge: true }) must deep-merge nested maps.
 *
 * Appended after the fact because this is the failure that mattered most in
 * production: a cooperative payment writes
 *
 *   { serviceRegistrations: { cooperatives: {...} } }
 *
 * through set(merge). Replacing that object rather than merging into it wiped
 * the same user's `wave` and `academy` registrations — so paying for one module
 * silently revoked access to another.
 */
maybeDescribe("set(merge) preserves sibling registrations", () => {
    const uid = `${TEST_PREFIX}merge-user`;

    async function seedUser() {
        await supabaseAdmin.from("users").upsert({
            id: uid,
            email: `${uid}@example.com`,
            raw_data: {
                id: uid,
                email: `${uid}@example.com`,
                serviceRegistrations: {
                    wave: { status: "approved" },
                    academy: { status: "approved" },
                },
            },
        });
    }

    afterAll(async () => {
        await supabaseAdmin.from("users").delete().like("id", `${TEST_PREFIX}%`);
    });

    it("does not wipe wave and academy when cooperative is written", async () => {
        await seedUser();

        await db.collection(COLLECTIONS.USERS).doc(uid).set(
            { serviceRegistrations: { cooperatives: { status: "active" } } },
            { merge: true },
        );

        const snap = await db.collection(COLLECTIONS.USERS).doc(uid).get();
        const sr = snap.data()?.serviceRegistrations ?? {};

        expect(sr.cooperatives?.status).toBe("active");
        expect(sr.wave?.status).toBe("approved");      // must survive
        expect(sr.academy?.status).toBe("approved");   // must survive
    });

    it("still replaces on update(), which is the other half of the contract", async () => {
        await seedUser();

        await db.collection(COLLECTIONS.USERS).doc(uid).update({
            serviceRegistrations: { cooperatives: { status: "active" } },
        });

        const snap = await db.collection(COLLECTIONS.USERS).doc(uid).get();
        expect(Object.keys(snap.data()?.serviceRegistrations ?? {})).toEqual(["cooperatives"]);
    });
});
