/**
 * @jest-environment node
 *
 * Regression tests for the Firestore-compatibility contract.
 *
 * Every defect covered here shipped to production and passed `tsc --noEmit`,
 * `eslint` and `next build`. The adapter surfaces are typed `any` and
 * strictNullChecks is off, so the compiler could not see any of it. These
 * tests are the guard rail that replaces the types we do not have.
 *
 * If one of these fails, do not relax the test — the contract really is broken.
 */

import { FieldValue, Timestamp as CompatTimestamp } from '@/lib/firestore-compat';
import { Timestamp as ClientTimestamp } from '@/lib/supabase-client-db';
import { toDate } from '@/lib/date-utils';

// jest.setup.js replaces '@/lib/supabase-db' with a hand-written mock for every
// suite. That mock is why none of these defects were ever caught: it answers
// db.collection(...).doc(id) happily while the real adapter was throwing
// "Invalid document path", and it exposes none of the module's exported
// helpers. These tests must run against the real implementation.
const {
    supabaseDb,
    increment,
    serverTimestamp,
    arrayUnion,
} = jest.requireActual('@/lib/supabase-db') as typeof import('@/lib/supabase-db');

describe('supabaseDb.doc() path resolution', () => {
    it('accepts a slash-joined admin-style path', () => {
        const ref = supabaseDb.doc('users/abc123');
        expect(ref.id).toBe('abc123');
        expect(ref.path).toBe('users/abc123');
    });

    it('accepts client-SDK style segments — doc(collection, id)', () => {
        // Regression: the trailing argument used to be dropped, collapsing this
        // to a one-segment path and throwing "Invalid document path".
        // It took out cooperative payment verification and all balance lookups.
        const ref = supabaseDb.doc('processedPayments', 'REF-123');
        expect(ref.id).toBe('REF-123');
        expect(ref.path).toBe('processedPayments/REF-123');
    });

    it('accepts nested collection/id segments', () => {
        const ref = supabaseDb.doc('cooperatives', 'coop1', 'members', 'user1');
        expect(ref.id).toBe('user1');
        expect(ref.path).toBe('cooperatives/coop1/members/user1');
    });

    it('rejects a collection-only path instead of silently misbehaving', () => {
        expect(() => supabaseDb.doc('processedPayments')).toThrow(/Invalid document path/);
    });

    it('rejects an odd number of segments', () => {
        expect(() => supabaseDb.doc('cooperatives/coop1/members')).toThrow(/odd number of segments/);
    });

    it('generates an id when asked via the collection reference', () => {
        const ref = supabaseDb.collection('cooperative_transactions').doc();
        expect(ref.id).toBeTruthy();
        expect(ref.path.startsWith('cooperative_transactions/')).toBe(true);
    });
});

describe('FieldValue sentinels', () => {
    // Regression: supabase-db exported increment() returning { __op: 'increment' },
    // a shape the write pipeline does not recognise. It was persisted verbatim,
    // so counters were REPLACED by that object instead of being incremented.
    it('increment() produces a sentinel the write pipeline detects', () => {
        const sentinel: any = increment(5);
        expect(sentinel._methodName).toBe('FieldValue.increment');
        expect(sentinel._operand).toBe(5);
    });

    it('increment() matches FieldValue.increment', () => {
        const a: any = increment(3);
        const b: any = FieldValue.increment(3);
        expect(a._methodName).toBe(b._methodName);
        expect(a._operand).toBe(b._operand);
    });

    it('serverTimestamp() and arrayUnion() also produce detectable sentinels', () => {
        expect((serverTimestamp() as any)._methodName).toBe('FieldValue.serverTimestamp');
        const u: any = arrayUnion('x', 'y');
        expect(u._methodName).toBe('FieldValue.arrayUnion');
        expect(u._elements).toEqual(['x', 'y']);
    });
});

describe('Timestamp shape compatibility', () => {
    // Regression: two Timestamp classes existed with different field names.
    // Server data exposed _seconds, client data exposed seconds, and consumers
    // read whichever they were written against — producing Invalid Date and
    // NaN sort keys. The notification bell crashed on this.
    it('admin-style Timestamp exposes both seconds and _seconds', () => {
        const ts = CompatTimestamp.fromDate(new Date('2026-01-15T10:30:00.000Z'));
        expect(ts.seconds).toBe(ts._seconds);
        expect(ts.nanoseconds).toBe(ts._nanoseconds);
    });

    it('client-style Timestamp exposes both seconds and _seconds', () => {
        const ts = ClientTimestamp.fromDate(new Date('2026-01-15T10:30:00.000Z'));
        expect(ts._seconds).toBe(ts.seconds);
        expect(ts._nanoseconds).toBe(ts.nanoseconds);
    });

    it('both aliases survive JSON serialization to a client component', () => {
        // Own properties survive; getters would not. This is the whole point.
        const revived = JSON.parse(JSON.stringify(CompatTimestamp.fromDate(new Date('2026-01-15T10:30:00.000Z'))));
        expect(typeof revived.seconds).toBe('number');
        expect(typeof revived._seconds).toBe('number');
        expect(revived.seconds).toBe(revived._seconds);
    });
});

describe('date-utils.toDate() coercion', () => {
    const expected = new Date('2026-01-15T10:30:00.000Z').getTime();

    it('handles ISO strings (what serializeDocs produces)', () => {
        expect(toDate('2026-01-15T10:30:00.000Z').getTime()).toBe(expected);
    });

    it('handles a live Timestamp instance', () => {
        expect(toDate(CompatTimestamp.fromDate(new Date(expected))).getTime()).toBe(expected);
    });

    it('handles a serialized admin Timestamp (_seconds, no methods)', () => {
        // Regression: this shape returned "now" instead of the real date.
        expect(toDate({ _seconds: expected / 1000, _nanoseconds: 0 }).getTime()).toBe(expected);
    });

    it('handles a serialized client Timestamp (seconds, no methods)', () => {
        expect(toDate({ seconds: expected / 1000, nanoseconds: 0 }).getTime()).toBe(expected);
    });

    it('never returns an Invalid Date for junk input', () => {
        for (const junk of [null, undefined, '', 'not-a-date', {}, NaN]) {
            expect(Number.isNaN(toDate(junk as any).getTime())).toBe(false);
        }
    });
});
