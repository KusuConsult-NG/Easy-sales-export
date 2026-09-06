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

type DocumentData = Record<string, any>;

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
    
    return hasSeconds && hasNanoseconds;
}

/**
 * Milliseconds since the epoch, from any of the timestamp shapes that reach
 * client code — an ISO string, a Date, a Firestore Timestamp, or a plain
 * { seconds, nanoseconds } object.
 *
 * WHY THIS IS NEEDED
 * ------------------
 * Server Actions return documents through serializeDocs(), which turns every
 * Timestamp into an ISO string. The declared types still say `Timestamp`, so
 * both shapes are believable at a call site and the code has been written for
 * whichever the author had in mind.
 *
 * The message list sorted with
 *
 *     new Date(a.timestamp).getTime()
 *
 * which is correct for a string and gives NaN for a Timestamp object —
 * `new Date(object)` is an Invalid Date, and a comparator returning NaN leaves
 * the order undefined. The same files render with an explicit
 * `typeof x.toDate === 'function' ? ... : ...` branch, so the author knew both
 * shapes occur; only the sort assumed one.
 *
 * Returns 0 for null, undefined or anything unrecognisable, so a caller can
 * sort a partially-populated list without special-casing.
 */
export function toMillis(value: unknown): number {
    if (value == null) return 0;

    if (value instanceof Date) return value.getTime();

    if (typeof value === "number") return value;

    if (typeof value === "string") {
        const parsed = new Date(value).getTime();
        return Number.isNaN(parsed) ? 0 : parsed;
    }

    const v = value as any;
    if (typeof v.toDate === "function") {
        const d = v.toDate();
        return d instanceof Date && !Number.isNaN(d.getTime()) ? d.getTime() : 0;
    }

    const secs = typeof v._seconds === "number" ? v._seconds : v.seconds;
    const nanos = typeof v._nanoseconds === "number" ? v._nanoseconds : v.nanoseconds;
    if (typeof secs === "number") {
        return secs * 1000 + (typeof nanos === "number" ? nanos / 1e6 : 0);
    }

    return 0;
}

/**
 * A timestamp as an ISO 8601 string, or "" when there is none.
 *
 * The companion to toMillis, for the same reason and against the same mistake.
 * Call sites paginating a list wrote
 *
 *     lastDoc.data().createdAt?.toDate?.()?.toISOString() ?? null
 *
 * which answers for a hydrated Timestamp and gives up on every other shape —
 * a Date, a number, a legacy {_seconds} object, or a missing field. As a
 * NEXT CURSOR that is worse than wrong: null cursor with hasMore true stops
 * pagination dead. As a displayed date, the sibling spelling
 * `?? new Date().toISOString()` invents today for a row that has none (#194).
 *
 * Empty string rather than null so it drops into a `string` field without a
 * cast; callers wanting null write `toIsoOrEmpty(x) || null`.
 */
export function toIsoOrEmpty(value: unknown): string {
    const ms = toMillis(value);
    return ms > 0 ? new Date(ms).toISOString() : "";
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
export function serializeValue<T = any>(value: any): T {
    if (value === null || value === undefined) return value;

    // Firestore Timestamp → ISO string
    if (isTimestamp(value)) {
        return timestampToIso(value as { toDate: () => Date }) as any;
    }

    // Date → ISO string (for consistency)
    if (value instanceof Date) {
        return value.toISOString() as any;
    }

    // Arrays — recurse into each element
    if (Array.isArray(value)) {
        return value.map(serializeValue) as any;
    }

    // Plain objects — recurse into each property
    if (typeof value === "object") {
        const result: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            result[k] = serializeValue(v);
        }
        return result as any;
    }

    // Primitives (string, number, boolean) — safe as-is
    return value as T;
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
    data: DocumentData | undefined,
    schema?: import("zod").ZodSchema<T>
): T {
    if (!data) return { id } as unknown as T;
    const serialized = serializeValue({ id, ...data });
    
    if (schema) {
        return schema.parse(serialized);
    }
    
    return serialized as T;
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
    if (docs.length > 5000) {
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

import { UserSchema } from "./validations/user";

/**
 * Standardize User entity to ensure consistent formatting.
 * Prioritizes computed name combinations over legacy fields.
 * Uses Zod for strict schema gating and data healing.
 */
export function serializeUser(id: string, data: DocumentData | undefined): User {
    const rawDoc = serializeDoc<any>(id, data);
    
    // Strict Schema Gating & Data Healing
    const validated = UserSchema.parse(rawDoc);
    
    // Compute a consistent full name if structured fields are present
    let computedFullName = validated.fullName;
    if (validated.firstName || validated.lastName) {
        const parts = [validated.firstName, validated.lastName].filter(Boolean);
        if (parts.length > 0) {
            computedFullName = parts.join(" ");
        }
    }
    
    return {
        ...validated,
        fullName: computedFullName,
    } as User;
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


import type { Order, Product } from "./types/marketplace";
import { OrderSchema, ProductSchema } from "./validations/marketplace";
import { lenientObject } from "./schema-heal";

/** The healing forms. Derived from the strict schemas, never restated. */
const LenientOrderSchema = lenientObject(OrderSchema);
const LenientProductSchema = lenientObject(ProductSchema);

/**
 *   #443 EVERY ORDER THAT REACHES A SCREEN COMES THROUGH HERE, AND WHAT COMES
 *        OUT IS THE SHAPE `Order` PROMISES.
 *
 *        Four actions read orders, and they had three different ideas about
 *        validation:
 *
 *          _mp_buyer_dashboard    OrderSchema.parse in a try, RAW DOCUMENT in
 *          _mp_seller_dashboard   the catch — so the one row the schema could
 *                                 not heal was the one row that skipped it
 *          orders.ts              serializeDoc, no schema at all
 *          order-management.ts    serializeDoc<Order>, a bare cast
 *
 *        Six screens then read `order.items.length` or `order.items.map(...)`
 *        with no guard, because the type said they could. ONE of the nine
 *        readers guarded it — buyer/orders/page.tsx writes
 *        `order.items && order.items.length > 0` — which is the shape of a
 *        defect somebody has already met and fixed where they stood.
 *
 *        A stored order with no `deliveryAddress` and no `items` failed the
 *        parse, took the raw-document path, and threw
 *        "Cannot read properties of undefined (reading 'length')" into the
 *        error boundary of /marketplace/buyer/dashboard. Observed in Chromium
 *        during a full browser run, on a real row, twice.
 *
 *        The fix is at the boundary rather than in the six renders. Scattering
 *        `?.` through the screens would have hidden the next boundary break
 *        instead of fixing it, and would have left the type still lying.
 *
 *        A row that needs healing is LOGGED. #379 recorded this exact hazard
 *        in a comment — "would have skipped validation silently rather than
 *        failing visibly" — and silence is the half that let it sit.
 */
function healThroughSchema(
    label: string,
    strictSchema: { safeParse: (v: unknown) => { success: boolean; data?: unknown; error?: { issues: Array<{ path: PropertyKey[]; code: string }> } } },
    lenientSchema: { parse: (v: unknown) => unknown },
    id: string,
    data: DocumentData | undefined,
): Record<string, unknown> {
    const raw = serializeDoc<Record<string, unknown>>(id, data ?? {});

    const strict = strictSchema.safeParse(raw);
    if (strict.success) return serializeValue(strict.data);

    logger.warn(`[${label}] document did not satisfy its schema; healing`, {
        id,
        // Field paths and issue codes only. The VALUES are the document's
        // contents — buyer addresses among them — and do not belong in a log.
        issues: (strict.error?.issues ?? []).map((issue) => `${issue.path.join(".")}: ${issue.code}`),
    });

    // Merged OVER the raw document, not returned in place of it. The old catch
    // returned the raw document and lost nothing; this keeps that property and
    // adds the guarantees, so healing can never make a screen show less than
    // the broken path did.
    const healed = lenientSchema.parse(raw) as Record<string, unknown>;
    return serializeValue({ ...raw, ...healed, id });
}

export function serializeOrder(id: string, data: DocumentData | undefined): Order {
    return healThroughSchema(
        "serializeOrder", OrderSchema, LenientOrderSchema, id, data,
    ) as unknown as Order;
}

/** `serializeOrder` over a QuerySnapshot's docs. */
export function serializeOrders(
    docs: Array<{ id: string; data: () => DocumentData }>
): Order[] {
    return docs.map((doc) => serializeOrder(doc.id, doc.data()));
}

/**
 *   #443 THE SAME FALLBACK, ON THE CATALOGUE SIDE.
 *
 *        Five product reads carried `ProductSchema.parse` in a try with the
 *        raw document in the catch, one of them in the same file as the order
 *        list above. That fallback is #130's mitigation — one malformed row
 *        must not empty the catalogue — and it is right about that and wrong
 *        about how: a raw document still typed `Product` is what #439 and #442
 *        then had to defend against in the RENDERS, twice, screen by screen.
 *
 *        Healing here does what the catch was reaching for. The renders keep
 *        their guards; they are simply no longer the only thing standing
 *        between a stored row and an error boundary.
 */
export function serializeProduct(id: string, data: DocumentData | undefined): Product {
    return healThroughSchema(
        "serializeProduct", ProductSchema, LenientProductSchema, id, data,
    ) as unknown as Product;
}
