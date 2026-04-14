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
 * Checks if a value looks like a Firestore Timestamp (Admin, Client SDK, or REST API plain object).
 */
function isTimestamp(value: unknown): boolean {
    if (!value || typeof value !== "object") return false;
    const v = value as Record<string, unknown>;
    
    if (typeof v["toDate"] === "function") return true;

    // Handle plain object format (e.g. from REST API or serialization)
    const hasSeconds = typeof v["_seconds"] === "number" || typeof v["seconds"] === "number";
    const hasNanoseconds = typeof v["_nanoseconds"] === "number" || typeof v["nanoseconds"] === "number";
    
    return hasSeconds && hasNanoseconds && Object.keys(v).length <= 2;
}

/**
 * Convert a single Firestore Timestamp (or anything with a toDate() method)
 * to an ISO 8601 string.
 */
function timestampToIso(ts: unknown): string {
    const v = ts as any;
    if (typeof v.toDate === "function") {
        return v.toDate().toISOString();
    }
    
    // Fallback for plain objects
    const secs = typeof v._seconds === "number" ? v._seconds : v.seconds;
    const nanos = typeof v._nanoseconds === "number" ? v._nanoseconds : v.nanoseconds;
    return new Date(secs * 1000 + nanos / 1000000).toISOString();
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

import { logger } from "./logger";

/**
 * Convenience wrapper for mapping a Firestore QuerySnapshot to serialized objects.
 *
 * USAGE:
 *   const orders = serializeDocs<Order>(snapshot.docs);
 */
export function serializeDocs<T = Record<string, unknown>>(
    docs: Array<{ id: string; data: () => DocumentData }>
): T[] {
    if (docs.length > 50) {
        logger.warn(`[DB Scale Warning] serializeDocs processing an unpaginated array of length ${docs.length}. Consider adding pagination limits.`);
    }
    return docs.map((doc) => serializeDoc<T>(doc.id, doc.data()));
}

// ----------------------------------------------------
// Entity Standardizers
// These functions normalize inconsistent database records
// into standardized frontend shapes.
// ----------------------------------------------------

import type { User, WaveApplication } from "./types/firestore";

/**
 * Standardize User entity to ensure consistent formatting.
 * Prioritizes computed name combinations over legacy fields.
 */
export function serializeUser(id: string, data: DocumentData | undefined): User {
    const raw = serializeDoc<User>(id, data);
    
    // Compute a consistent full name
    let computedFullName = raw.fullName || "Unknown User";
    if (raw.firstName || raw.lastName) {
        const parts = [raw.firstName, raw.otherName, raw.lastName].filter(Boolean);
        if (parts.length > 0) {
            computedFullName = parts.join(" ");
        }
    }
    
    return {
        ...raw,
        fullName: computedFullName,
    };
}

/**
 * Standardize WaveApplication entity.
 */
export function serializeWaveApplication(id: string, data: DocumentData | undefined): WaveApplication {
    const raw = serializeDoc<WaveApplication>(id, data);
    
    return {
        ...raw,
        email: raw.userEmail || raw.email || "", // Standardize missing emails
    };
}
