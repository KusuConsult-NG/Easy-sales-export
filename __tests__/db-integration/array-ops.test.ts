/**
 * Atomic array operations, against a real Postgres.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The unit tests prove the ROUTING — that a role grant reaches
 * `apply_array_ops` rather than being resolved in JavaScript. They cannot prove
 * the thing that actually matters, which is that two concurrent grants both
 * survive. That needs real concurrent sessions.
 *
 * It also guards the trap that made the wallet fix invisible: `roles` is a
 * native TEXT[] column AND a raw_data key, and the application reads raw_data.
 * Asserting on one of them alone would let a half-applied fix pass.
 *
 * Requires migration 016.
 */

import { supabaseAdmin } from "@/lib/supabase";
import { supabaseDb as db } from "@/lib/supabase-db";
import { FieldValue } from "@/lib/firestore-compat";
import { COLLECTIONS } from "@/lib/types/firestore";

declare const maybeDescribe: jest.Describe;

const TEST_PREFIX = "jest-db-";
const userId = `${TEST_PREFIX}arr-user`;

async function cleanup() {
    await supabaseAdmin.from("users").delete().like("id", `${TEST_PREFIX}%`);
    await supabaseAdmin.from("document_collections").delete().like("id", `${TEST_PREFIX}%`);
}

/** Seeds a user the way the adapter does — roles in BOTH places. */
async function seedUser(roles: string[]) {
    await supabaseAdmin.from("users").upsert({
        id: userId,
        email: `${userId}@example.com`,
        roles,
        raw_data: { id: userId, email: `${userId}@example.com`, roles },
    });
}

/** Reads roles the way the APPLICATION does, through the adapter. */
async function readRolesAsApp(): Promise<string[]> {
    const snap = await db.collection(COLLECTIONS.USERS).doc(userId).get();
    return (snap.data()?.roles ?? []) as string[];
}

/** Reads the native column directly. */
async function readRolesNative(): Promise<string[]> {
    const { data } = await supabaseAdmin.from("users").select("roles").eq("id", userId).single();
    return (data?.roles ?? []) as string[];
}

maybeDescribe("atomic array ops, against real Postgres", () => {
    beforeEach(cleanup);
    afterAll(cleanup);

    it("a granted role is visible to the application, not just to the column", async () => {
        // The wallet lesson. 005/006 wrote the native column only and the fix
        // was invisible, because reads prefer raw_data.
        await seedUser(["buyer"]);

        await db.collection(COLLECTIONS.USERS).doc(userId).update({
            roles: FieldValue.arrayUnion("seller"),
        });

        expect((await readRolesAsApp()).sort()).toEqual(["buyer", "seller"]);
        expect((await readRolesNative()).sort()).toEqual(["buyer", "seller"]);
    });

    it("keeps both roles when two modules are joined at once", async () => {
        // THE test. Each writer read ["buyer"], appended its own role, and wrote
        // back — so whoever committed second erased the other's grant. A user
        // paid for cooperative and academy and ended up with one of them.
        await seedUser(["buyer"]);

        const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
        await Promise.all([
            userRef.update({ roles: FieldValue.arrayUnion("cooperative_member") }),
            userRef.update({ roles: FieldValue.arrayUnion("academy_participant") }),
        ]);

        const roles = await readRolesAsApp();
        expect(roles).toContain("cooperative_member");
        expect(roles).toContain("academy_participant");
        expect(roles).toContain("buyer");
        expect((await readRolesNative()).sort()).toEqual(roles.slice().sort());
    });

    it("keeps every role under a burst of concurrent grants", async () => {
        await seedUser([]);

        const granted = ["seller", "farmer", "wave_participant", "export_participant",
                         "academy_participant", "cooperative_member", "land_owner"];
        const userRef = db.collection(COLLECTIONS.USERS).doc(userId);

        await Promise.all(granted.map(role =>
            userRef.update({ roles: FieldValue.arrayUnion(role) })
        ));

        expect((await readRolesAsApp()).sort()).toEqual(granted.slice().sort());
    });

    it("does not duplicate a role granted twice", async () => {
        // Webhook and server action both grant on the same payment.
        await seedUser(["buyer"]);
        const userRef = db.collection(COLLECTIONS.USERS).doc(userId);

        await Promise.all([
            userRef.update({ roles: FieldValue.arrayUnion("seller") }),
            userRef.update({ roles: FieldValue.arrayUnion("seller") }),
        ]);

        expect((await readRolesAsApp()).sort()).toEqual(["buyer", "seller"]);
    });

    it("removes a role from both places", async () => {
        await seedUser(["buyer", "farmer"]);

        await db.collection(COLLECTIONS.USERS).doc(userId).update({
            roles: FieldValue.arrayRemove("farmer"),
        });

        expect(await readRolesAsApp()).toEqual(["buyer"]);
        expect(await readRolesNative()).toEqual(["buyer"]);
    });

    it("does not revert a concurrent field change while granting a role", async () => {
        // The stale-value clobber. The write carries the whole document, so a
        // grant that also set another field used to write back everything it
        // had read — undoing whatever landed in between.
        await seedUser(["buyer"]);
        const userRef = db.collection(COLLECTIONS.USERS).doc(userId);

        await Promise.all([
            userRef.update({ roles: FieldValue.arrayUnion("seller"), isVerified: true }),
            userRef.update({ roles: FieldValue.arrayUnion("farmer") }),
        ]);

        const roles = await readRolesAsApp();
        expect(roles).toContain("seller");
        expect(roles).toContain("farmer");
    });

    it("grants a role through set(..., { merge: true }) too", async () => {
        // The cooperative membership grant uses this path, not update().
        await seedUser(["buyer"]);
        const userRef = db.collection(COLLECTIONS.USERS).doc(userId);

        await Promise.all([
            userRef.set({ roles: FieldValue.arrayUnion("cooperative_member") }, { merge: true }),
            userRef.set({ roles: FieldValue.arrayUnion("academy_participant") }, { merge: true }),
        ]);

        const roles = await readRolesAsApp();
        expect(roles).toContain("cooperative_member");
        expect(roles).toContain("academy_participant");
    });

    it("handles object elements in a raw_data array", async () => {
        // export-admin appends document objects, not strings.
        const orderId = `${TEST_PREFIX}order-1`;
        await supabaseAdmin.from("document_collections").upsert({
            id: orderId,
            collection_name: "export_orders",
            raw_data: { id: orderId, documents: [] },
        });

        const ref = db.collection("export_orders").doc(orderId);
        await Promise.all([
            ref.update({ documents: FieldValue.arrayUnion({ url: "a.pdf", type: "invoice" }) }),
            ref.update({ documents: FieldValue.arrayUnion({ url: "b.pdf", type: "packing" }) }),
        ]);

        const snap = await ref.get();
        const docs = (snap.data()?.documents ?? []) as any[];
        expect(docs).toHaveLength(2);
        expect(docs.map(d => d.url).sort()).toEqual(["a.pdf", "b.pdf"]);
    });

    it("treats objects with the same keys in a different order as one element", async () => {
        // JSONB normalises key order; the old JSON.stringify comparison did not.
        // This is a behaviour change, and the more correct one.
        const orderId = `${TEST_PREFIX}order-2`;
        await supabaseAdmin.from("document_collections").upsert({
            id: orderId,
            collection_name: "export_orders",
            raw_data: { id: orderId, documents: [{ url: "a.pdf", type: "invoice" }] },
        });

        const ref = db.collection("export_orders").doc(orderId);
        await ref.update({ documents: FieldValue.arrayUnion({ type: "invoice", url: "a.pdf" }) });

        const snap = await ref.get();
        expect((snap.data()?.documents ?? []) as any[]).toHaveLength(1);
    });
});
