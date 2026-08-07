/**
 * Firestore Compatibility Shims
 *
 * These stubs replace firebase-admin/firestore FieldValue, FieldPath, and Timestamp
 * for files that have been migrated to supabase-db.ts.
 *
 * The supabase-db adapter DETECTS FieldValue sentinel objects via their _methodName
 * property (set by these stubs) and handles them correctly during writes.
 *
 * Usage: Replace `import { FieldValue } from "@/lib/firestore-compat";
`
 *        with   `import { FieldValue } from "@/lib/firestore-compat"`
 */

// ─── FieldValue ───────────────────────────────────────────────────────────────

export class FieldValue {
    _methodName: string;
    _elements?: any[];
    _operand?: number;

    constructor(methodName: string, elements?: any[], operand?: number) {
        this._methodName = methodName;
        this._elements = elements;
        this._operand = operand;
    }

    static serverTimestamp(): FieldValue {
        return new FieldValue('FieldValue.serverTimestamp');
    }
    static arrayUnion(...elements: any[]): FieldValue {
        return new FieldValue('FieldValue.arrayUnion', elements);
    }
    static arrayRemove(...elements: any[]): FieldValue {
        return new FieldValue('FieldValue.arrayRemove', elements);
    }
    static increment(n: number): FieldValue {
        return new FieldValue('FieldValue.increment', undefined, n);
    }
    static delete(): FieldValue {
        return new FieldValue('FieldValue.delete');
    }
}

// ─── FieldPath ────────────────────────────────────────────────────────────────

class FieldPathSentinel {
    _methodName: string;
    _path: string[];

    constructor(methodName: string, path: string[] = []) {
        this._methodName = methodName;
        this._path = path;
    }
}

export const FieldPath = {
    documentId(): FieldPathSentinel {
        return new FieldPathSentinel('FieldPath.documentId');
    },
};

// ─── GeoPoint ─────────────────────────────────────────────────────────────────

export class GeoPoint {
    latitude: number;
    longitude: number;

    constructor(latitude: number, longitude: number) {
        this.latitude = latitude;
        this.longitude = longitude;
    }
}

// ─── Timestamp ────────────────────────────────────────────────────────────────

export class Timestamp {
    _seconds: number;
    _nanoseconds: number;
    /**
     * Client-SDK aliases.
     *
     * Two Timestamp shapes exist in this codebase: this one (admin style,
     * `_seconds`) and supabase-client-db's (client style, `seconds`).
     * Consumers read whichever they were written against, so the same value
     * yielded `undefined` — and then `Invalid Date` or a NaN sort key —
     * depending on which path produced it.
     *
     * These are assigned as own properties rather than getters on purpose:
     * only own enumerable properties survive serialization to a Client
     * Component, which is exactly where the mismatch used to surface.
     */
    seconds: number;
    nanoseconds: number;

    constructor(seconds: number, nanoseconds: number = 0) {
        this._seconds = seconds;
        this._nanoseconds = nanoseconds;
        this.seconds = seconds;
        this.nanoseconds = nanoseconds;
    }

    static now(): Timestamp {
        const ms = Date.now();
        return new Timestamp(Math.floor(ms / 1000), (ms % 1000) * 1e6);
    }

    static fromDate(date: Date): Timestamp {
        const ms = date.getTime();
        return new Timestamp(Math.floor(ms / 1000), (ms % 1000) * 1e6);
    }

    static fromMillis(ms: number): Timestamp {
        return new Timestamp(Math.floor(ms / 1000), (ms % 1000) * 1e6);
    }

    toDate(): Date {
        return new Date(this._seconds * 1000 + Math.floor(this._nanoseconds / 1e6));
    }

    toMillis(): number {
        return this._seconds * 1000 + Math.floor(this._nanoseconds / 1e6);
    }

    isEqual(other: Timestamp): boolean {
        return this._seconds === other._seconds && this._nanoseconds === other._nanoseconds;
    }

    valueOf(): string {
        return this.toDate().toISOString();
    }
}

// ─── AggregateField ───────────────────────────────────────────────────────────

export const AggregateField = {
    sum(field: string) {
        return { _field: field, _op: 'sum' };
    },
    average(field: string) {
        return { _field: field, _op: 'average' };
    },
    count() {
        return { _op: 'count' };
    }
};
