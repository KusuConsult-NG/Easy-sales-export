/**
 * Two adapter methods that the application called and the adapter did not have.
 *
 * WHAT WAS WRONG
 * --------------
 * `db` was exported from firebase-admin.ts as `any`. supabaseDb itself is fully
 * typed, but that one annotation threw the types away before they reached a
 * single call site, so calling a method the adapter has never implemented
 * type-checked cleanly and threw at runtime instead.
 *
 * Two were being called:
 *
 *   .stream()          in-app-broadcast.ts:238, sms-broadcast.ts:353/637/656,
 *                      broadcast-logic.ts:849
 *   .collectionGroup() backfill_versions.ts:46
 *
 * `typeof supabaseDb.collection("users").select("name").stream` was `undefined`
 * — checked by calling it, not by reading the file. Every admin broadcast to
 * the audiences "marketplace_onboarded", "active_users", "pending_users",
 * "stalled_users", "ghost_users" or "active_last_30_days" died on
 * `TypeError: query.stream is not a function`.
 *
 * WHY THESE ASSERTIONS
 * --------------------
 * That the methods now exist is the trivial part — any implementation passes
 * that. What is actually worth guaranteeing is the behaviour the callers depend
 * on and would not notice being wrong:
 *
 *   - stream() must cross the 1,000-row PostgREST page boundary. The broadcast
 *     code streams precisely because the users table is ~41,000 rows. An
 *     implementation that stopped at one page would pass a naive test and
 *     silently address a broadcast to the first 1,000 users.
 *   - stream() must not apply DEFAULT_QUERY_LIMIT the way get() does, for the
 *     same reason.
 *   - a streamed doc.data() must equal a fetched one, so nothing depends on
 *     which read path it came through.
 *   - collectionGroup()'s doc.ref must point at the row's OWN subcollection.
 *     backfill_versions.ts writes through that ref; if it pointed at the group
 *     name, the backfill would write 500 documents into the wrong collection.
 *     That is the assertion that turns this from a smoke test into a guard.
 */

import { supabaseAdmin } from "@/lib/supabase";
import { supabaseDb } from "@/lib/supabase-db";

declare const maybeDescribe: jest.Describe;

const STREAM_COLLECTION = "jest_stream_docs";
/** Above PostgREST's 1,000-row page cap, so pagination is actually exercised. */
const STREAM_ROWS = 1050;

const GROUP_PARENT_A = "jest_group/parent-a/lessons";
const GROUP_PARENT_B = "jest_group/parent-b/lessons";
/** Deliberately NOT a subcollection — a top-level collection of the same name. */
const GROUP_TOP_LEVEL = "lessons";
/** Ends in the group name as a SUBSTRING, not as a path segment. Must not match. */
const GROUP_DECOY = "jest_group/parent-c/extralessons";

async function cleanup() {
    for (const name of [STREAM_COLLECTION, GROUP_PARENT_A, GROUP_PARENT_B, GROUP_TOP_LEVEL, GROUP_DECOY]) {
        await supabaseAdmin.from("document_collections").delete().eq("collection_name", name);
    }
}

maybeDescribe("SupabaseQuery.stream()", () => {
    beforeAll(async () => {
        await cleanup();
        // Insert in chunks — a single 1,050-row insert exceeds what PostgREST
        // will accept in one request body comfortably.
        for (let start = 0; start < STREAM_ROWS; start += 500) {
            const rows = [];
            for (let i = start; i < Math.min(start + 500, STREAM_ROWS); i++) {
                const id = `jest-stream-${String(i).padStart(5, "0")}`;
                rows.push({
                    id,
                    collection_name: STREAM_COLLECTION,
                    raw_data: { id, seq: i, group: i % 2 === 0 ? "even" : "odd" },
                });
            }
            const { error } = await supabaseAdmin.from("document_collections").insert(rows);
            if (error) throw new Error(`seed failed: ${error.message}`);
        }
    }, 60000);

    afterAll(cleanup);

    it("streams EVERY row, across the 1,000-row page boundary", async () => {
        // The assertion this file exists for. 1,050 > 1,000, so a single-page
        // implementation returns 1,000 and fails here.
        const seen: string[] = [];
        for await (const doc of supabaseDb.collection(STREAM_COLLECTION).stream()) {
            seen.push((doc as any).id);
        }

        expect(seen).toHaveLength(STREAM_ROWS);
        // No duplicates — a range/offset error would show up as repeats
        // totalling the right count.
        expect(new Set(seen).size).toBe(STREAM_ROWS);
    }, 60000);

    it("supports the .on('data') form used by broadcast-logic.ts", async () => {
        // broadcast-logic.ts:849 uses the event-emitter shape, not `for await`.
        // Both must work or that call site is still broken.
        const ids: string[] = [];
        await new Promise<void>((resolve, reject) => {
            supabaseDb.collection(STREAM_COLLECTION).stream()
                .on("data", (doc: any) => { ids.push(doc.id); })
                .on("end", () => resolve())
                .on("error", reject);
        });

        expect(ids).toHaveLength(STREAM_ROWS);
    }, 60000);

    it("honours where() and limit()", async () => {
        const evens: any[] = [];
        for await (const doc of supabaseDb.collection(STREAM_COLLECTION).where("group", "==", "even").stream()) {
            evens.push(doc);
        }
        expect(evens).toHaveLength(STREAM_ROWS / 2);
        expect(evens.every(d => d.data().group === "even")).toBe(true);

        const limited: any[] = [];
        for await (const doc of supabaseDb.collection(STREAM_COLLECTION).limit(7).stream()) {
            limited.push(doc);
        }
        expect(limited).toHaveLength(7);
    }, 60000);

    it("produces documents identical to get()'s", async () => {
        // If the two read paths disagreed about doc.data(), the difference
        // would surface as a broadcast audience that silently mismatched — the
        // hardest kind of bug to attribute.
        const fetched = await supabaseDb.collection(STREAM_COLLECTION).limit(5).orderBy("seq", "asc").get();

        const streamed: any[] = [];
        for await (const doc of supabaseDb.collection(STREAM_COLLECTION).limit(5).orderBy("seq", "asc").stream()) {
            streamed.push(doc);
        }

        expect(streamed.map(d => d.id)).toEqual(fetched.docs.map(d => d.id));
        expect(streamed.map(d => d.data())).toEqual(fetched.docs.map(d => d.data()));
        expect(streamed[0].ref.id).toBe(fetched.docs[0].ref.id);
    }, 60000);
});

maybeDescribe("supabaseDb.collectionGroup()", () => {
    beforeAll(async () => {
        await cleanup();
        const { error } = await supabaseAdmin.from("document_collections").insert([
            { id: "l-a1", collection_name: GROUP_PARENT_A,   raw_data: { id: "l-a1", title: "A1" } },
            { id: "l-a2", collection_name: GROUP_PARENT_A,   raw_data: { id: "l-a2", title: "A2" } },
            { id: "l-b1", collection_name: GROUP_PARENT_B,   raw_data: { id: "l-b1", title: "B1" } },
            { id: "l-t1", collection_name: GROUP_TOP_LEVEL,  raw_data: { id: "l-t1", title: "T1" } },
            { id: "l-d1", collection_name: GROUP_DECOY,      raw_data: { id: "l-d1", title: "D1" } },
        ]);
        if (error) throw new Error(`seed failed: ${error.message}`);
    });

    afterAll(cleanup);

    it("finds documents under every parent, and the top-level collection too", async () => {
        const snap = await supabaseDb.collectionGroup("lessons").get();
        const ids = snap.docs.map(d => d.id).sort();

        expect(ids).toEqual(["l-a1", "l-a2", "l-b1", "l-t1"]);
    });

    it("matches the name as a PATH SEGMENT, not as a substring", async () => {
        // "jest_group/parent-c/extralessons" ends with the letters "lessons".
        // A LIKE '%lessons' would wrongly include it; the implementation must
        // require the '/' separator.
        const snap = await supabaseDb.collectionGroup("lessons").get();
        expect(snap.docs.map(d => d.id)).not.toContain("l-d1");
    });

    it("gives each document a ref pointing at its OWN subcollection", async () => {
        // backfill_versions.ts does `batch.update(doc.ref, {...})` over the
        // result of a collection group. If every ref carried the group name,
        // that update would write into a collection called "lessons" and leave
        // the real documents untouched — a backfill that reports success and
        // changes nothing.
        const snap = await supabaseDb.collectionGroup("lessons").get();
        const byId = new Map(snap.docs.map(d => [d.id, d.ref]));

        expect((byId.get("l-a1") as any)._collection).toBe(GROUP_PARENT_A);
        expect((byId.get("l-b1") as any)._collection).toBe(GROUP_PARENT_B);
        expect((byId.get("l-t1") as any)._collection).toBe(GROUP_TOP_LEVEL);
    });

    it("writes through that ref land in the right subcollection", async () => {
        // The proof of the assertion above, done rather than inspected: this is
        // exactly what the backfill script performs.
        const snap = await supabaseDb.collectionGroup("lessons").get();
        const target = snap.docs.find(d => d.id === "l-a1")!;
        await target.ref.update({ _version: 1 });

        const { data } = await supabaseAdmin
            .from("document_collections")
            .select("raw_data")
            .eq("id", "l-a1")
            .eq("collection_name", GROUP_PARENT_A)
            .single();

        expect((data?.raw_data as any)?._version).toBe(1);
    });

    it("refuses a dedicated table instead of silently returning nothing", async () => {
        // users lives in its own table and has no subcollections. An empty
        // result would read as "no data"; an error says "wrong question".
        expect(() => supabaseDb.collectionGroup("users")).toThrow(/own table/i);
    });
});
