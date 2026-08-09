/**
 * Conditional decrement and bounded increment, against a real Postgres.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The unit tests for these helpers mock the RPC, so they prove the wrapper's
 * contract and nothing about the guarantee. The guarantee is the whole point:
 * that two callers racing for the last unit cannot both win. That needs real
 * concurrent database sessions, which is exactly what a mock cannot provide —
 * and exactly the assumption the old `if (currentQty >= item.quantity)` check
 * got wrong for as long as it existed.
 *
 * The all-or-nothing test is the other one that matters. A per-item loop passes
 * every single-item test and still corrupts a multi-item order.
 *
 * Requires migration 015.
 */

import { supabaseAdmin } from "@/lib/supabase";
import { decrementManyOrFail, incrementWithinCeiling } from "@/lib/wallet-ledger";

declare const maybeDescribe: jest.Describe;

const TEST_PREFIX = "jest-db-";
const PRODUCTS = "products";
const EVENTS = "wave_training_events";

async function cleanup() {
    await supabaseAdmin.from("document_collections").delete().like("id", `${TEST_PREFIX}%`);
}

/** Seeds a row the way the adapter does — the value lives in raw_data. */
async function seed(collection: string, id: string, raw: Record<string, any>) {
    await supabaseAdmin.from("document_collections").upsert({
        id,
        collection_name: collection,
        raw_data: { id, ...raw },
    });
}

async function readField(collection: string, id: string, field: string): Promise<number> {
    const { data } = await supabaseAdmin
        .from("document_collections")
        .select("raw_data")
        .eq("id", id)
        .eq("collection_name", collection)
        .single();
    return Number(data?.raw_data?.[field] ?? 0);
}

maybeDescribe("bounded counters, against real Postgres", () => {
    beforeEach(cleanup);
    afterAll(cleanup);

    describe("decrementManyOrFail", () => {
        it("decrements every item in the order", async () => {
            await seed(PRODUCTS, `${TEST_PREFIX}p-a`, { availableQuantity: 5 });
            await seed(PRODUCTS, `${TEST_PREFIX}p-b`, { availableQuantity: 3 });

            const result = await decrementManyOrFail([
                { collection: PRODUCTS, id: `${TEST_PREFIX}p-a`, field: "availableQuantity", amount: 2 },
                { collection: PRODUCTS, id: `${TEST_PREFIX}p-b`, field: "availableQuantity", amount: 1 },
            ]);

            expect(result.ok).toBe(true);
            expect(await readField(PRODUCTS, `${TEST_PREFIX}p-a`, "availableQuantity")).toBe(3);
            expect(await readField(PRODUCTS, `${TEST_PREFIX}p-b`, "availableQuantity")).toBe(2);
        });

        it("leaves the earlier items untouched when a later one is short", async () => {
            // The reason this function exists rather than a loop over
            // debit_jsonb_balance. A loop would have taken 2 from p-a before
            // discovering p-b could not cover 3 — and nothing would put it back.
            await seed(PRODUCTS, `${TEST_PREFIX}p-a`, { availableQuantity: 5 });
            await seed(PRODUCTS, `${TEST_PREFIX}p-b`, { availableQuantity: 1 });

            const result = await decrementManyOrFail([
                { collection: PRODUCTS, id: `${TEST_PREFIX}p-a`, field: "availableQuantity", amount: 2 },
                { collection: PRODUCTS, id: `${TEST_PREFIX}p-b`, field: "availableQuantity", amount: 3 },
            ]);

            expect(result.ok).toBe(false);
            expect(result.failedId).toBe(`${TEST_PREFIX}p-b`);
            expect(result.reason).toBe("insufficient");

            expect(await readField(PRODUCTS, `${TEST_PREFIX}p-a`, "availableQuantity")).toBe(5);
            expect(await readField(PRODUCTS, `${TEST_PREFIX}p-b`, "availableQuantity")).toBe(1);
        });

        it("writes nothing when one product no longer exists", async () => {
            await seed(PRODUCTS, `${TEST_PREFIX}p-a`, { availableQuantity: 5 });

            const result = await decrementManyOrFail([
                { collection: PRODUCTS, id: `${TEST_PREFIX}p-a`, field: "availableQuantity", amount: 1 },
                { collection: PRODUCTS, id: `${TEST_PREFIX}p-gone`, field: "availableQuantity", amount: 1 },
            ]);

            expect(result.ok).toBe(false);
            expect(result.reason).toBe("not_found");
            expect(await readField(PRODUCTS, `${TEST_PREFIX}p-a`, "availableQuantity")).toBe(5);
        });

        it("lets exactly one of two concurrent buyers take the last unit", async () => {
            // THE test. Both callers read the same quantity under the old
            // check-then-write and both passed, so stock went negative and a
            // seller owed two units they did not have.
            await seed(PRODUCTS, `${TEST_PREFIX}p-last`, { availableQuantity: 1 });

            const buy = () => decrementManyOrFail([
                { collection: PRODUCTS, id: `${TEST_PREFIX}p-last`, field: "availableQuantity", amount: 1 },
            ]);

            const [first, second] = await Promise.all([buy(), buy()]);

            const winners = [first, second].filter(r => r.ok);
            expect(winners).toHaveLength(1);
            expect(await readField(PRODUCTS, `${TEST_PREFIX}p-last`, "availableQuantity")).toBe(0);
        });

        it("never lets stock go negative under a burst of concurrent orders", async () => {
            await seed(PRODUCTS, `${TEST_PREFIX}p-burst`, { availableQuantity: 10 });

            const results = await Promise.all(
                Array.from({ length: 25 }, () => decrementManyOrFail([
                    { collection: PRODUCTS, id: `${TEST_PREFIX}p-burst`, field: "availableQuantity", amount: 1 },
                ]))
            );

            const succeeded = results.filter(r => r.ok).length;
            expect(succeeded).toBe(10);
            expect(await readField(PRODUCTS, `${TEST_PREFIX}p-burst`, "availableQuantity")).toBe(0);
        });

        it("does not deadlock when two orders list the same products in opposite order", async () => {
            // Why the function sorts by id before locking. Without that, order 1
            // holds p-x waiting for p-y while order 2 holds p-y waiting for p-x,
            // and Postgres kills one of them.
            await seed(PRODUCTS, `${TEST_PREFIX}p-x`, { availableQuantity: 20 });
            await seed(PRODUCTS, `${TEST_PREFIX}p-y`, { availableQuantity: 20 });

            const forward = { collection: PRODUCTS, id: `${TEST_PREFIX}p-x`, field: "availableQuantity", amount: 1 };
            const back = { collection: PRODUCTS, id: `${TEST_PREFIX}p-y`, field: "availableQuantity", amount: 1 };

            const results = await Promise.all(
                Array.from({ length: 10 }, (_, i) =>
                    decrementManyOrFail(i % 2 === 0 ? [forward, back] : [back, forward])
                )
            );

            expect(results.every(r => r.ok)).toBe(true);
            expect(await readField(PRODUCTS, `${TEST_PREFIX}p-x`, "availableQuantity")).toBe(10);
            expect(await readField(PRODUCTS, `${TEST_PREFIX}p-y`, "availableQuantity")).toBe(10);
        });
    });

    describe("incrementWithinCeiling", () => {
        it("fills the last seat and refuses the one after it", async () => {
            await seed(EVENTS, `${TEST_PREFIX}evt-1`, { currentParticipants: 9, maxParticipants: 10 });

            const taken = await incrementWithinCeiling({
                collection: EVENTS, id: `${TEST_PREFIX}evt-1`,
                field: "currentParticipants", amount: 1, ceilingField: "maxParticipants",
            });
            expect(taken.ok).toBe(true);
            expect(Number(taken.value)).toBe(10);

            const refused = await incrementWithinCeiling({
                collection: EVENTS, id: `${TEST_PREFIX}evt-1`,
                field: "currentParticipants", amount: 1, ceilingField: "maxParticipants",
            });
            expect(refused.ok).toBe(false);
            expect(refused.reason).toBe("at_capacity");

            expect(await readField(EVENTS, `${TEST_PREFIX}evt-1`, "currentParticipants")).toBe(10);
        });

        it("does not oversell a session under concurrent registration", async () => {
            // Migration 010 made this worse before it made it better: the lost
            // increments used to hide the overshoot.
            await seed(EVENTS, `${TEST_PREFIX}evt-race`, { currentParticipants: 0, maxParticipants: 5 });

            const results = await Promise.all(
                Array.from({ length: 20 }, () => incrementWithinCeiling({
                    collection: EVENTS, id: `${TEST_PREFIX}evt-race`,
                    field: "currentParticipants", amount: 1, ceilingField: "maxParticipants",
                }))
            );

            expect(results.filter(r => r.ok)).toHaveLength(5);
            expect(await readField(EVENTS, `${TEST_PREFIX}evt-race`, "currentParticipants")).toBe(5);
        });

        it("treats an event with no cap as unbounded", async () => {
            // Events created without maxParticipants must keep accepting people.
            // Refusing them would break every uncapped session on the platform.
            await seed(EVENTS, `${TEST_PREFIX}evt-open`, { currentParticipants: 500 });

            const result = await incrementWithinCeiling({
                collection: EVENTS, id: `${TEST_PREFIX}evt-open`,
                field: "currentParticipants", amount: 1, ceilingField: "maxParticipants",
            });

            expect(result.ok).toBe(true);
            expect(await readField(EVENTS, `${TEST_PREFIX}evt-open`, "currentParticipants")).toBe(501);
        });

        it("reports a deleted event as not_found rather than full", async () => {
            const result = await incrementWithinCeiling({
                collection: EVENTS, id: `${TEST_PREFIX}evt-missing`,
                field: "currentParticipants", amount: 1, ceilingField: "maxParticipants",
            });

            expect(result.ok).toBe(false);
            expect(result.reason).toBe("not_found");
        });
    });
});
