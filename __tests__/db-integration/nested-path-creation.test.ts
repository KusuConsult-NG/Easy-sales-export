/**
 * Writing a nested path whose parent does not exist yet.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `jsonb_set(target, path, value, create_missing => true)` creates the LEAF of
 * a path but NOT its intermediate parents. Given a missing parent it returns the
 * target unchanged — no error, no warning:
 *
 *   jsonb_set('{}', '{documents,passportPhoto}', '{"url":"x"}', true)  ->  {}
 *
 * Migrations 010, 016 and 017 all wrote dotted paths that way, so a write to a
 * nested field whose parent did not exist was discarded while the call reported
 * success. Migration 018 adds jsonb_set_deep and routes all three through it.
 *
 * These tests exist because NOTHING ELSE COULD HAVE CAUGHT IT. The unit suites
 * mock the RPC layer, so they verify the arguments sent and never the effect. A
 * write that silently does nothing looks identical to a write that worked, from
 * every vantage point except a real database.
 *
 * That is exactly how it reached production: 14 restore calls returned success
 * and 9 of them wrote nothing.
 *
 * Requires migrations 010, 016, 017 and 018.
 */

import { supabaseAdmin } from "@/lib/supabase";
import { supabaseDb as db } from "@/lib/supabase-db";
import { FieldValue } from "@/lib/firestore-compat";

declare const maybeDescribe: jest.Describe;

const TEST_PREFIX = "jest-db-";
const COLL = "nested_path_probe";

async function cleanup() {
    await supabaseAdmin.from("document_collections").delete().like("id", `${TEST_PREFIX}%`);
}

async function seed(id: string, raw: Record<string, any>) {
    await supabaseAdmin.from("document_collections").upsert({
        id, collection_name: COLL, raw_data: { id, ...raw },
    });
}

async function read(id: string): Promise<Record<string, any>> {
    const snap = await db.collection(COLL).doc(id).get();
    return snap.data() ?? {};
}

maybeDescribe("nested path creation, against real Postgres", () => {
    beforeEach(cleanup);
    afterAll(cleanup);

    describe("jsonb_set_deep", () => {
        it("creates the parent object that jsonb_set would not", async () => {
            const { data, error } = await supabaseAdmin.rpc("jsonb_set_deep", {
                p_target: {},
                p_path: ["documents", "passportPhoto"],
                p_value: { url: "x" },
            });
            expect(error).toBeNull();
            expect(data).toEqual({ documents: { passportPhoto: { url: "x" } } });
        });

        it("leaves siblings alone", async () => {
            const { data } = await supabaseAdmin.rpc("jsonb_set_deep", {
                p_target: { documents: { validId: { url: "v" } } },
                p_path: ["documents", "passportPhoto"],
                p_value: { url: "x" },
            });
            expect(data).toEqual({
                documents: { validId: { url: "v" }, passportPhoto: { url: "x" } },
            });
        });

        it("replaces a scalar parent with an object, as setNestedValue did", async () => {
            const { data } = await supabaseAdmin.rpc("jsonb_set_deep", {
                p_target: { a: 1 }, p_path: ["a", "b"], p_value: 2,
            });
            expect(data).toEqual({ a: { b: 2 } });
        });
    });

    describe("a document write to a missing parent", () => {
        it("lands rather than silently vanishing", async () => {
            // The production failure, reproduced: a record with no `documents`
            // object at all. Nine restores were lost exactly here.
            await seed(`${TEST_PREFIX}np-1`, {});

            await db.collection(COLL).doc(`${TEST_PREFIX}np-1`).update({
                "documents.passportPhoto": { url: "https://example.test/p.jpg" },
            });

            const doc = await read(`${TEST_PREFIX}np-1`);
            expect(doc.documents?.passportPhoto?.url).toBe("https://example.test/p.jpg");
        });

        it("creates several missing levels at once", async () => {
            await seed(`${TEST_PREFIX}np-2`, {});

            await db.collection(COLL).doc(`${TEST_PREFIX}np-2`).update({
                "serviceRegistrations.wave.status": "approved",
            });

            expect((await read(`${TEST_PREFIX}np-2`)).serviceRegistrations)
                .toEqual({ wave: { status: "approved" } });
        });
    });

    describe("an increment to a missing parent", () => {
        it("credits the balance instead of discarding it", async () => {
            // The money case. WAVE earnings are held at
            // serviceRegistrations.wave.waveEarningsBalance; a user whose
            // serviceRegistrations object did not exist had credits vanish.
            await seed(`${TEST_PREFIX}np-3`, {});

            await db.collection(COLL).doc(`${TEST_PREFIX}np-3`).update({
                "serviceRegistrations.wave.waveEarningsBalance": FieldValue.increment(2_500),
            });

            const doc = await read(`${TEST_PREFIX}np-3`);
            expect(Number(doc.serviceRegistrations?.wave?.waveEarningsBalance)).toBe(2_500);
        });

        it("keeps accumulating once the parent exists", async () => {
            await seed(`${TEST_PREFIX}np-4`, {});
            const ref = db.collection(COLL).doc(`${TEST_PREFIX}np-4`);

            await ref.update({ "stats.count": FieldValue.increment(1) });
            await ref.update({ "stats.count": FieldValue.increment(1) });

            expect(Number((await read(`${TEST_PREFIX}np-4`)).stats?.count)).toBe(2);
        });
    });

    describe("an array op on a missing parent", () => {
        it("creates the array rather than discarding the element", async () => {
            await seed(`${TEST_PREFIX}np-5`, {});

            await db.collection(COLL).doc(`${TEST_PREFIX}np-5`).update({
                "profile.badges": FieldValue.arrayUnion("early"),
            });

            expect((await read(`${TEST_PREFIX}np-5`)).profile?.badges).toEqual(["early"]);
        });
    });
});
