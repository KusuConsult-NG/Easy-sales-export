/**
 * Who may move an export window's status, and to what — one answer.
 *
 * TWO ENDPOINTS, ONE OPERATION, ONE OF THEM HARDENED
 * --------------------------------------------------
 * `updateExportStatusAction` is defined twice, over the same collection and the
 * same four statuses, and both are wired to live UI:
 *
 *   export-status.ts        a FormData action. Used by StatusUpdateModal.
 *   export/_ex_windows.ts   positional arguments. Used by /admin/export, and
 *                           re-exported through the export barrel.
 *
 * The first was hardened in an earlier pass. Its comment sets out the rule:
 *
 *     "completed" is a settlement statement. An owner could declare their own
 *     export finished without an admin ever seeing it.
 *
 *     Moving OUT of "completed" reopens a settled record. dashboard.ts sums
 *     windows in in_transit/delivered as the owner's Total Escrow, so the same
 *     call that reopens the record also puts the figure back.
 *
 * The second has none of it. Any of the four statuses could be set from any
 * other, by the window's owner as readily as by an admin — and that endpoint
 * does strictly MORE than change a field. On "completed" it emails every
 * investor a statement of their returns and marks every one of their slots
 * completed. So an owner could settle their own export, notify every investor
 * that it had paid out, and close their slots, with no admin involved.
 *
 * It also read roles from the session token rather than from the database, and
 * did not recognise `export_admin` at all — so a genuine export administrator
 * was refused by one endpoint and allowed by the other.
 *
 * The rule lives here so the two cannot answer differently again.
 */

export const EXPORT_WINDOW_STATUSES = [
    "pending",
    "in_transit",
    "delivered",
    "completed",
] as const;

/**
 * ONE COLLECTION, TWO ENTITIES, TWO VOCABULARIES.
 *
 * export_windows holds two different things, told apart by nothing but which
 * fields they happen to carry. admin/_exports.ts names the split in its own
 * comment — "Safe mapping for Split-Schema (Private Requests vs Crowdfunded
 * Opportunities)" — and the two have separate creators writing separate
 * statuses:
 *
 *   the SHIPMENT      _ex_windows.ts::createExportWindowAction. Carries
 *                     orderId, commodity, quantity, deliveryDate, userId.
 *                     Created "pending"; moves through the four statuses above.
 *   the AGGREGATION   export-aggregation.ts. Carries slotPrice, currentVolume,
 *                     startDate/endDate, createdBy. Created "open"; investors
 *                     buy slots in it.
 *
 * So the statuses a window can actually hold are the union, not the four above.
 * That matters wherever code decides what a window IS by its status:
 *
 *   - the browse query filters `status == "open"`, which only aggregations ever
 *     have, so a shipment is invisible to it — correct by accident rather than
 *     by design.
 *   - EXPORT_WINDOW_STATUSES cannot express "open", so once an admin moves an
 *     aggregation onto one of the four, refuseExportStatusChange rejects "open"
 *     as "Invalid status value" and there is no way back. Recorded rather than
 *     fixed: merging the two entities is a schema decision, not an audit's.
 *
 * Listed here so anything reasoning about a window's status has one place to
 * look, instead of a fifth hand-written set.
 */
export const EXPORT_WINDOW_ALL_STATUSES = [
    ...EXPORT_WINDOW_STATUSES,
    "open",
    "closed",
] as const;

/**
 * A window that accepts investment.
 *
 * _ex_investments.ts spells this `status !== "open" && status !== "active"`,
 * and forensics.ts's investment-cap check asked for `"active"` ALONE —
 * a value nothing in the codebase ever writes to export_windows. Every write
 * that lands on this collection is accounted for: "open" and "pending" from the
 * two creators, the four statuses above from the two updateExportStatusAction
 * endpoints, and "completed" from the escrow cron. "active" appears only on
 * EXPORT_SLOTS and EXPORT_INVESTMENTS.
 *
 * So that check inspected zero windows and reported clean every time it ran —
 * the same shape as an integrity report that never built the index it consulted.
 *
 * "active" is kept here because the investability check already honours it: if
 * a writer ever starts producing it, the cap check should see those windows too
 * rather than silently resume ignoring them.
 */
export const EXPORT_WINDOW_INVESTABLE_STATUSES = ["open", "active"] as const;

export type ExportWindowStatus = (typeof EXPORT_WINDOW_STATUSES)[number];

/** Settled. Reopening one puts money back into a dashboard total. */
export const EXPORT_SETTLED_STATUS: ExportWindowStatus = "completed";

/**
 * The roles that may settle an export, or reopen a settled one.
 *
 * `export_admin` is included because export-status.ts already includes it. The
 * other endpoint did not, which is the kind of divergence a shared list exists
 * to prevent.
 */
export const EXPORT_ADMIN_ROLES = ["admin", "super_admin", "export_admin"] as const;

export function hasExportAdminAccess(roles: readonly string[] | undefined | null): boolean {
    return (roles ?? []).some((r) => (EXPORT_ADMIN_ROLES as readonly string[]).includes(r));
}

export function normaliseExportWindowStatus(status: unknown): ExportWindowStatus | null {
    const raw = String(status ?? "").trim().toLowerCase();
    if (!raw) return null;
    return (EXPORT_WINDOW_STATUSES as readonly string[]).includes(raw)
        ? (raw as ExportWindowStatus)
        : null;
}

export interface ExportStatusChange {
    callerId: string;
    /** Read from the DATABASE, not from the session token — see below. */
    callerRoles: readonly string[] | undefined | null;
    ownerId: string | undefined | null;
    currentStatus: unknown;
    newStatus: unknown;
}

/**
 * Returns the reason the change is refused, or null if it may proceed.
 *
 * Roles are expected to come from the user document rather than the session.
 * A token keeps its roles until it refreshes, and this decides who may change a
 * record the dashboard reads as escrow — the same reasoning applied to
 * admin-content.ts and the escrow readers.
 *
 * This is deliberately NOT a full state machine. Which transitions are legal in
 * the middle of the flow is a wider question than this should answer alone; the
 * same line was drawn for export order status. What it settles is who may
 * settle, and who may reopen a settlement.
 */
export function refuseExportStatusChange(change: ExportStatusChange): string | null {
    const next = normaliseExportWindowStatus(change.newStatus);
    if (!next) return "Invalid status value";

    const isAdmin = hasExportAdminAccess(change.callerRoles);
    const isOwner = !!change.ownerId && change.ownerId === change.callerId;

    if (!isAdmin && !isOwner) return "Unauthorized to update this export";

    // Admins keep full control, including correcting a mistake in either
    // direction.
    if (isAdmin) return null;

    if (next === EXPORT_SETTLED_STATUS) {
        return "Only an administrator can mark an export completed";
    }

    if (normaliseExportWindowStatus(change.currentStatus) === EXPORT_SETTLED_STATUS) {
        return "This export is completed and can only be changed by an administrator";
    }

    return null;
}

/**
 * The ROI percentage a window advertises, as a number.
 *
 * NOTHING WRITES AN ROI ONTO A WINDOW
 * -----------------------------------
 * `roi` and `roiPercentage` are read in four places and written in none — the
 * only `roi:` writes in the codebase are onto EXPORT_SLOTS, after an investment
 * has already been made. Neither createExportWindowAction records one, the same
 * way neither records a fundingGoal.
 *
 * That was not merely cosmetic. getExportOpportunityById maps
 * `projectedROI: data.roi`, and /export/windows/[id] did
 *
 *     parseFloat(windowData.projectedROI.replace("%", ""))
 *
 * inside its invest handler — calling .replace on undefined. It threw a
 * TypeError before the server action was reached, and the surrounding catch
 * reported "An error occurred while processing your investment". That was the
 * FIRST of three independent reasons export investing could not complete; the
 * other two were in the action it never got to.
 *
 * 20 is not invented here: the two fulfilment paths both compute the expected
 * return as `amount * (returnMultiplier ?? 1.20)`, so 20% is the return the
 * platform already pays when a window records nothing. Using anything else
 * would have the page advertise one figure and the payout compute another.
 */
export const DEFAULT_EXPORT_ROI_PERCENT = 20;

export function exportWindowRoiPercent(value: unknown): number {
    const cleaned = String(value ?? "").replace("%", "").trim();

    // The WHOLE string has to be one number.
    //
    // parseFloat("15-20") returns 15 — the platform's own default ROI label is
    // the range "15-20%", so a window carrying it would advertise 15% while the
    // fulfilment paths pay `amount * 1.20`. Silently taking the low end of a
    // range is a worse answer than saying the value is not a single figure and
    // using the rate that is actually paid.
    if (!/^\d+(\.\d+)?$/.test(cleaned)) return DEFAULT_EXPORT_ROI_PERCENT;

    const parsed = Number(cleaned);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_EXPORT_ROI_PERCENT;
}
