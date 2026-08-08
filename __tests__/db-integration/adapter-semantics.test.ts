/**
 * Adapter behaviour that only a real database can demonstrate.
 *
 * The unit suite mocks the adapter, so it verifies the mock. These check the
 * things that mock cannot model: whether an increment is atomic, whether a
 * write is visible through the read path, and whether the default row cap
 * actually truncates.
 *
 * Requires migration 010.
 */

import { supabaseAdmin } from "@/lib/supabase";
import { supabaseDb as db } from "@/lib/supabase-db";
import { FieldValue } from "@/lib/firestore-compat";

declare const maybeDescribe: jest.Describe;

const TEST_PREFIX = "jest-db-";
const COLLECTION = "jest_db_counters";

async function cleanup() {
    await supabaseAdmin
        .from("document_collections")
        .delete()
        .eq("collection_name", COLLECTION)
        .like("id", `${TEST_PREFIX}%`);
}

maybeDescribe("adapter semantics, against real Postgres", () => {
    beforeEach(cleanup);
    afterAll(cleanup);

    it("an increment is visible through the read path", async () => {
        const id = `${TEST_PREFIX}counter-1`;
        await db.collection(COLLECTION).doc(id).set({ views: 10, label: "test" });

        await db.collection(COLLECTION).doc(id).update({ views: FieldValue.increment(5) });

        const snap = await db.collection(COLLECTION).doc(id).get();
        expect(snap.data()?.views).toBe(15);
        // Unrelated fields must survive a partial update.
        expect(snap.data()?.label).toBe("test");
    });

    it("concurrent increments all land", async () => {
        const id = `${TEST_PREFIX}counter-2`;
        await db.collection(COLLECTION).doc(id).set({ views: 0 });

        // THE TEST FOR THE 142-CALL-SITE BUG.
        // FieldValue.increment used to resolve in JavaScript against a value the
        // adapter had just read, so ten concurrent increments landed on 1, not
        // 10. Nothing in the mocked suite could show that.
        await Promise.all(
            Array.from({ length: 10 }, () =>
                db.collection(COLLECTION).doc(id).update({ views: FieldValue.increment(1) })
            )
        );

        const snap = await db.collection(COLLECTION).doc(id).get();
        expect(snap.data()?.views).toBe(10);
    });

    it("handles a negative increment", async () => {
        const id = `${TEST_PREFIX}counter-3`;
        await db.collection(COLLECTION).doc(id).set({ stock: 100 });

        await db.collection(COLLECTION).doc(id).update({ stock: FieldValue.increment(-30) });

        const snap = await db.collection(COLLECTION).doc(id).get();
        expect(snap.data()?.stock).toBe(70);
    });

    it("starts a counter that does not exist yet from zero", async () => {
        const id = `${TEST_PREFIX}counter-4`;
        await db.collection(COLLECTION).doc(id).set({ label: "no counter yet" });

        await db.collection(COLLECTION).doc(id).update({ fresh: FieldValue.increment(7) });

        const snap = await db.collection(COLLECTION).doc(id).get();
        expect(snap.data()?.fresh).toBe(7);
    });

    it("truncates an unbounded query and says so", async () => {
        // Deliberately small so the test stays quick; the property is that
        // truncation is reported, not the specific number.
        const previous = process.env.SUPABASE_DEFAULT_QUERY_LIMIT;
        process.env.SUPABASE_DEFAULT_QUERY_LIMIT = "5";

        try {
            jest.resetModules();
            const freshDb = (await import("@/lib/supabase-db")).supabaseDb;

            for (let i = 0; i < 8; i++) {
                await freshDb.collection(COLLECTION).doc(`${TEST_PREFIX}row-${i}`).set({ n: i });
            }

            const capped = await freshDb.collection(COLLECTION).get();
            expect(capped.docs.length).toBe(5);
            // Without this flag a caller sees 5 rows and cannot tell whether
            // that is everything — which is how a repair script covered 12% of
            // users and reported success.
            expect(capped.truncated).toBe(true);

            const complete = await freshDb.collection(COLLECTION).all().get();
            expect(complete.docs.length).toBe(8);
            expect(complete.truncated).toBe(false);
        } finally {
            if (previous === undefined) delete process.env.SUPABASE_DEFAULT_QUERY_LIMIT;
            else process.env.SUPABASE_DEFAULT_QUERY_LIMIT = previous;
        }
    });
});
