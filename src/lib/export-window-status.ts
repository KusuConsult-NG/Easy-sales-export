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
