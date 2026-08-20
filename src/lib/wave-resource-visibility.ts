/**
 * Whether a WAVE resource is still available to members — one definition.
 *
 * WHY THIS EXISTS
 * ---------------
 * `COLLECTIONS.WAVE_RESOURCES` is created, listed and deleted by TWO separate
 * pairs of actions, and each pair used a different field to mean "withdrawn":
 *
 *   resource-actions.ts
 *     uploadResourceAction    writes `isActive: true`
 *     deleteResourceAction    writes `isActive: false`
 *     getResourcesAction      queries `.where("isActive", "==", true)`
 *     downloadResourceAction  refuses when `isActive === false`
 *
 *   wave/_wv_admin_resources.ts
 *     createResourceAction    writes NEITHER field
 *     deleteResourceAction    writes `deleted: true`
 *
 *   wave/_wv_resources.ts
 *     getWaveResourcesAction  filters on neither
 *
 * Each pair is coherent with itself and with nothing else, and all three effects
 * were live:
 *
 * 1. A resource uploaded through the WAVE admin screen has no `isActive`, so
 *    `isActive == true` does not match it and it NEVER APPEARED in
 *    getResourcesAction — the listing behind /wave/(member)/resources. An admin
 *    uploaded a training document, saw it in their own list, and members never
 *    got it.
 *
 * 2. A resource deleted through the WAVE admin screen sets `deleted: true`, which
 *    NOTHING READS. getWaveResourcesAction still lists it and
 *    downloadResourceAction still serves the file, because that guard tests
 *    `isActive === false`. That delete button was inert.
 *
 * 3. getWaveResourcesAction filters on neither field, so it listed everything
 *    including resources withdrawn by either path.
 *
 * So which admin screen was used decided whether members could see a resource,
 * and one of the two delete buttons did nothing at all.
 *
 * WHY A PREDICATE AND NOT A MIGRATION
 * -----------------------------------
 * Live rows exist in three shapes: `isActive: true`, `deleted: true`, and neither.
 * A predicate that honours all three needs no backfill and cannot leave a row
 * stranded halfway through one. Both writers now set both fields, so new rows are
 * unambiguous; this exists for the ones already there.
 *
 * MISSING MEANS VISIBLE
 * ---------------------
 * Deliberately. Every resource created by the WAVE admin path lacks both fields,
 * and treating those as withdrawn would hide the entire existing library — turning
 * a listing defect into a data-loss-shaped one. Withdrawal has to be explicit,
 * which is also what downloadResourceAction's `=== false` test already assumed.
 */

/** A resource is withdrawn only if a writer said so explicitly. */
export function isResourceWithdrawn(data: Record<string, any> | null | undefined): boolean {
    if (!data) return true;
    return data.deleted === true || data.isActive === false;
}

/** The inverse, for readers that read better that way. */
export function isResourceVisible(data: Record<string, any> | null | undefined): boolean {
    return !isResourceWithdrawn(data);
}

/**
 * The fields a writer should set to mark a resource live.
 *
 * Both spellings, so a reader that only knows one of them still gets the right
 * answer — including the two listings that query `isActive` directly in SQL and
 * cannot call a predicate.
 */
export const RESOURCE_LIVE_FIELDS = { isActive: true, deleted: false } as const;

/**
 * The fields a writer should set to withdraw a resource.
 *
 * Both, for the same reason: `deleted: true` alone was read by nothing.
 */
export const RESOURCE_WITHDRAWN_FIELDS = { isActive: false, deleted: true } as const;
