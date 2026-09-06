/**
 * Turn a strict Zod object schema into one that cannot throw.
 *
 *   #443. This codebase's schemas are written to HEAL — nearly every field
 *   carries a `.default()`, and the header of validations/marketplace.ts says
 *   so out loud: "These schemas 'heal' corrupted legacy data by providing
 *   sensible defaults."
 *
 *   They only heal a row that PARSES. One field without a default makes the
 *   whole parse throw, and the two call sites that mattered caught the throw
 *   and handed the browser the RAW document instead — still typed as `Order`,
 *   with none of the guarantees that type implies. A stored order with no
 *   `deliveryAddress` therefore reached the buyer dashboard with no `items`
 *   either, and `{order.items.length}` took the page down.
 *
 *   The fallback is the bug, not the strictness. `lenientObject` is what the
 *   fallback should have been: the SAME schema, with each field allowed to fall
 *   back to the default the schema itself declares for it.
 *
 * WHY THE FALLBACK IS DERIVED AND NOT WRITTEN OUT
 *
 *   A hand-written skeleton — `{ items: [], subtotal: 0, ... }` — is a second
 *   statement of every default, and this audit has now fixed the same class
 *   often enough to know how that ends: the two statements drift, and the copy
 *   nobody is looking at is the one that is wrong. Each field's fallback is
 *   obtained by asking the field what it produces for a missing value, so
 *   adding a field to the strict schema extends the lenient one for free and
 *   changing a default changes both.
 */

import { z } from "zod";

/**
 * A copy of `schema` in which no field can fail.
 *
 * For each field:
 *
 *   - If the field accepts a missing value — it has a `.default()`, a
 *     `.prefault()`, or is `.optional()` — a bad stored value falls back to
 *     whatever the field produces for `undefined`. So a field declared
 *     `z.array(...).default([])` is an array afterwards whether the row stored
 *     an array, a string, or nothing at all.
 *   - Otherwise the field is genuinely required, and there is no honest value
 *     to invent for it. It becomes optional, so one missing required field no
 *     longer discards every healable field beside it.
 *
 * Unknown keys are STRIPPED, exactly as the strict schema strips them. That is
 * deliberate: what crosses the server→client boundary stays bounded by the
 * schema rather than being whatever the document happens to hold.
 */
export function lenientObject<Shape extends z.ZodRawShape>(
    schema: z.ZodObject<Shape>,
): z.ZodObject<z.ZodRawShape> {
    const shape: Record<string, z.ZodType> = {};

    for (const [key, field] of Object.entries(schema.shape)) {
        const typed = field as z.ZodType;
        const forMissing = typed.safeParse(undefined);
        shape[key] = forMissing.success
            ? typed.catch(forMissing.data as never)
            : typed.optional().catch(undefined as never);
    }

    return z.object(shape as z.ZodRawShape);
}
