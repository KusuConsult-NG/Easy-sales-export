/**
 * toMillis, and the message ordering it exists to fix.
 *
 * WHAT WAS WRONG
 * --------------
 * Both message screens sorted with
 *
 *     const tA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
 *     const tB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
 *     return tA - tB;
 *
 * `new Date(x)` on a Firestore Timestamp object is an Invalid Date, so
 * getTime() is NaN and the comparator returns NaN. A comparator that returns
 * NaN does not order anything — the result is whatever the engine's sort
 * happened to leave behind.
 *
 * That the two shapes both occur is not a guess: the same two files render
 * with an explicit `typeof x.toDate === 'function' ? ... : ...` branch a few
 * lines below. The author handled both at render and assumed one when sorting.
 *
 * THE NaN CASE IS THE POINT.
 * A test that only fed ISO strings would pass against the old code, since
 * `new Date(isoString)` was always correct. Every case below that involves a
 * Timestamp-shaped object is one the previous implementation got wrong.
 */

import { toMillis } from "@/lib/firestore-serialize";

/** A Firestore Timestamp, as the Admin SDK and the compat layer produce it. */
function timestampLike(ms: number) {
    return {
        seconds: Math.floor(ms / 1000),
        nanoseconds: (ms % 1000) * 1e6,
        toDate: () => new Date(ms),
    };
}

/** The same instant with no toDate() — how a Timestamp survives JSON. */
function plainTimestamp(ms: number) {
    return { _seconds: Math.floor(ms / 1000), _nanoseconds: (ms % 1000) * 1e6 };
}

describe("toMillis", () => {
    const MS = Date.UTC(2026, 0, 15, 9, 30, 0);

    it("reads every timestamp shape that reaches client code", () => {
        expect(toMillis(new Date(MS).toISOString())).toBe(MS);
        expect(toMillis(new Date(MS))).toBe(MS);
        expect(toMillis(MS)).toBe(MS);
        // The two the old code turned into NaN.
        expect(toMillis(timestampLike(MS))).toBe(MS);
        expect(toMillis(plainTimestamp(MS))).toBe(MS);
    });

    it("returns 0 rather than NaN for anything it cannot read", () => {
        // NaN is the specific failure being fixed — a comparator that returns
        // it silently abandons the ordering. 0 sorts such an entry to the
        // start, which is at least defined behaviour.
        for (const bad of [null, undefined, "", "not a date", {}, [], true]) {
            expect(toMillis(bad)).toBe(0);
            expect(Number.isNaN(toMillis(bad))).toBe(false);
        }
    });

    it("orders a mixed list of shapes correctly", () => {
        // What the message screens actually do. Deliberately mixes an ISO
        // string with two Timestamp objects, because a list that came partly
        // from a serialized action and partly from a live read is exactly the
        // situation the defensive render branch was written for.
        const t = (n: number) => Date.UTC(2026, 0, n);
        const messages = [
            { id: "third",  timestamp: timestampLike(t(3)) },
            { id: "first",  timestamp: new Date(t(1)).toISOString() },
            { id: "fourth", timestamp: plainTimestamp(t(4)) },
            { id: "second", timestamp: timestampLike(t(2)) },
        ];

        const sorted = [...messages].sort((a, b) => toMillis(a.timestamp) - toMillis(b.timestamp));

        expect(sorted.map(m => m.id)).toEqual(["first", "second", "third", "fourth"]);
    });

    it("demonstrates the ordering the previous implementation produced", () => {
        // Pinning the old behaviour so the reason for this helper cannot be
        // mistaken for style. `new Date(TimestampObject)` really is NaN.
        const old = (v: any) => (v ? new Date(v).getTime() : 0);

        expect(Number.isNaN(old(timestampLike(MS)))).toBe(true);
        expect(Number.isNaN(old(plainTimestamp(MS)))).toBe(true);
        // And correct for the shape it was written against, which is why it
        // survived review.
        expect(old(new Date(MS).toISOString())).toBe(MS);
    });
});
