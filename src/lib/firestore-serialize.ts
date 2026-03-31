/**
 * Firestore Serialization Utilities
 *
 * Next.js Server Actions and Server Components CANNOT pass class instances
 * (like Firestore Timestamps) to Client Components. Only plain objects,
 * primitives, and a few built-ins (Date, Map, Set) are supported.
 *
 * These helpers convert raw Firestore Admin SDK DocumentData into plain,
 * JSON-serializable objects safe for the server→client boundary.
 */

import type { DocumentData } from "firebase-admin/firestore";

/**
 * Checks if a value looks like a Firestore Timestamp (Admin or Client SDK).
 * Both have `_seconds` / `seconds` + `_nanoseconds` / `nanoseconds` fields.
 */
function isTimestamp(value: unknown): boolean {
    if (!value || typeof value !== "object") return false;
    const v = value as Record<string, unknown>;
    return (
        typeof v["_seconds"] === "number" ||
        typeof v["seconds"] === "number"
    ) && typeof (v["toDate"]) === "function";
}

/**
 * Convert a single Firestore Timestamp (or anything with a toDate() method)
 * to an ISO 8601 string.
 */
function timestampToIso(ts: { toDate: () => Date }): string {
    return ts.toDate().toISOString();
}

/**
 * Recursively walk an object/array and convert any Firestore Timestamps
 * to ISO strings so the result is safe to pass to Client Components.
 *
 * @param value - Raw value from Firestore (doc.data(), field value, etc.)
 * @returns A deep-cloned plain object with all Timestamps serialized
 */
export function serializeValue(value: unknown): unknown {
    if (value === null || value === undefined) return value;

    // Firestore Timestamp → ISO string
    if (isTimestamp(value)) {
        return timestampToIso(value as { toDate: () => Date });
    }

    // Date → ISO string (for consistency)
    if (value instanceof Date) {
        return value.toISOString();
    }

    // Arrays — recurse into each element
    if (Array.isArray(value)) {
        return value.map(serializeValue);
    }

    // Plain objects — recurse into each property
    if (typeof value === "object") {
        const result: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            result[k] = serializeValue(v);
        }
        return result;
    }

    // Primitives (string, number, boolean) — safe as-is
    return value;
}

/**
 * Serialize a full Firestore document (doc.data() + id) into a plain object.
 *
 * USAGE:
 *   const courses = snapshot.docs.map(doc =>
 *     serializeDoc<Course>(doc.id, doc.data())
 *   );
 *
 * @param id  - Document ID (doc.id)
 * @param data - Raw document data (doc.data())
 * @returns Fully serializable plain object
 */
export function serializeDoc<T = Record<string, unknown>>(
    id: string,
    data: DocumentData | undefined
): T {
    if (!data) return { id } as unknown as T;
    return serializeValue({ id, ...data }) as T;
}

/**
 * Convenience wrapper for mapping a Firestore QuerySnapshot to serialized objects.
 *
 * USAGE:
 *   const orders = serializeDocs<Order>(snapshot.docs);
 */
export function serializeDocs<T = Record<string, unknown>>(
    docs: Array<{ id: string; data: () => DocumentData }>
): T[] {
    return docs.map((doc) => serializeDoc<T>(doc.id, doc.data()));
}
