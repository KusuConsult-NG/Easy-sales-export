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
    /**
     * The window document, so the legal vocabulary can be chosen by which
     * entity this actually is. Optional: a caller that does not pass it gets
     * the shipment vocabulary, which is the behaviour every caller had before.
     */
    window?: Record<string, unknown> | null;
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
    // Which words are legal depends on which entity this is.
    //
    // This used to ask normaliseExportWindowStatus, which knows only the four
    // SHIPMENT statuses. An aggregation window moved onto one of them could
    // therefore never be set back to "open" — "Invalid status value" — and it
    // left the investor browse query (`where status == "open"`) for good, with
    // money already in it. A one-way trapdoor reached through an ordinary
    // admin dropdown.
    const kind = exportWindowKind(change.window);
    const next = normaliseStatusForKind(kind, change.newStatus);
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

    if (normaliseStatusForKind(kind, change.currentStatus) === EXPORT_SETTLED_STATUS) {
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

// ── Which entity a window IS ─────────────────────────────────────────────────

/**
 * export_windows holds two things, and the status vocabulary was one-way.
 *
 * A SHIPMENT window is a private export request: orderId, commodity, quantity,
 * userId, created "pending", moving pending → in_transit → delivered →
 * completed.
 *
 * An AGGREGATION window is a crowdfunded opportunity: title, targetVolume,
 * slotPrice, currentVolume, createdBy, created "open", browsed by investors
 * through `where status == "open"`.
 *
 * THE TRAPDOOR
 * ------------
 * EXPORT_WINDOW_STATUSES lists only the four shipment statuses, and
 * normaliseExportWindowStatus refuses everything else. So the moment an admin
 * moved an aggregation window onto one of the four — which the admin status
 * endpoint happily allowed, because it never asked which entity it was holding
 * — "open" became "Invalid status value" and there was no way back. The window
 * dropped out of the investor browse query permanently, with money already in
 * it.
 *
 * The fix is not to merge the two vocabularies: "in_transit" is meaningless for
 * an aggregation window and "open" is meaningless for a shipment. It is to ask
 * WHICH ENTITY the row is before deciding which words are legal for it.
 *
 * Inferred rather than migrated, the same way loanProductOf is: rows in
 * production carry no discriminator, and the fields have always told them
 * apart. New rows carry `windowKind` outright.
 */
export type ExportWindowKind = "shipment" | "aggregation";

export const EXPORT_AGGREGATION_STATUSES = ["open", "closed", "completed"] as const;

function present(data: Record<string, unknown>, key: string): boolean {
    const v = data[key];
    if (v === undefined || v === null) return false;
    if (typeof v === "string") return v.trim().length > 0;
    if (typeof v === "number") return Number.isFinite(v);
    return true;
}

export function exportWindowKind(
    data: Record<string, unknown> | null | undefined,
): ExportWindowKind {
    if (!data) return "shipment";

    const stamped = data.windowKind;
    if (stamped === "shipment" || stamped === "aggregation") return stamped;

    // slotPrice and targetVolume exist only on the aggregation shape, and
    // admin/_exports.ts already treats targetVolume as the tell:
    // `const isCrowdfunded = !!data.targetVolume;`
    if (present(data, "slotPrice") || present(data, "targetVolume")) return "aggregation";
    // "open" is only ever written by the aggregation creator.
    if (String(data.status ?? "").trim().toLowerCase() === "open") return "aggregation";

    return "shipment";
}

/** The statuses that are legal for a window of this kind. */
export function statusesForExportWindowKind(kind: ExportWindowKind): readonly string[] {
    return kind === "aggregation" ? EXPORT_AGGREGATION_STATUSES : EXPORT_WINDOW_STATUSES;
}

/**
 * Normalise a status against the vocabulary of the kind that owns it.
 *
 * normaliseExportWindowStatus stays as it is — it answers "is this one of the
 * four shipment statuses", which is what its existing callers mean.
 */
export function normaliseStatusForKind(kind: ExportWindowKind, status: unknown): string | null {
    const raw = String(status ?? "").trim().toLowerCase();
    if (!raw) return null;
    return statusesForExportWindowKind(kind).includes(raw) ? raw : null;
}

// ── What an aggregation window is trying to raise ────────────────────────────

/**
 * The amount a window is raising, or null when it is not raising anything.
 *
 * Nothing wrote `fundingGoal` onto an export window, so the overfunding
 * machinery in all three fulfilment paths was inert: incrementWithinCeiling
 * treats a MISSING ceiling field as unbounded, so no window was ever capped.
 *
 * It was always derivable — admin/_exports.ts computes exactly this for display
 * (`Number(data.targetVolume) * Number(data.slotPrice || 1)`) and then throws
 * the number away. Both creators record it now, and this derives it for rows
 * written before they did.
 *
 * A SHIPMENT window returns null: it has no investors and nothing to overfund.
 * Returning 0 would read as "already full" to anything comparing against it.
 *
 * NOTE ON THE CEILING. incrementWithinCeiling reads a stored FIELD through a
 * Postgres function, so deriving the goal in JavaScript does not cap an
 * existing row — only a stored `fundingGoal` does. New windows are capped from
 * creation; existing ones need scripts/backfill-export-funding-goals.ts, which
 * is written but deliberately not run here.
 */
export function exportWindowFundingGoal(
    data: Record<string, unknown> | null | undefined,
): number | null {
    if (!data) return null;

    for (const key of ["fundingGoal", "goal"]) {
        const n = Number(data[key]);
        if (Number.isFinite(n) && n > 0) return n;
    }

    if (exportWindowKind(data) !== "aggregation") return null;

    const targetVolume = Number(data.targetVolume);
    const slotPrice = Number(data.slotPrice);
    if (!Number.isFinite(targetVolume) || targetVolume <= 0) return null;
    if (!Number.isFinite(slotPrice) || slotPrice <= 0) return null;

    return targetVolume * slotPrice;
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * May this window still take an investment?
 *
 *   #275 AN EXPIRED WINDOW STAYED OPEN FOR EVER, AND TWO OF THE THREE PATHS
 *        TOOK MONEY FOR IT.
 *
 *        Three doors onto investing in an export window:
 *
 *          export-aggregation.ts   status === "open" AND now > endDate
 *          export/_ex_investments  status only
 *          export-payment.ts       status only
 *
 *        One checked the deadline. The other two checked that the window said
 *        "open" — and NOTHING EVER MAKES IT SAY ANYTHING ELSE. A scan for a
 *        writer of "closed" on export_windows finds none: the string appears in
 *        type unions and in the two status lists above, and in no assignment
 *        anywhere. No scheduled job, no admin action, no code path closes a
 *        window when its endDate passes.
 *
 *        So a window whose period ended months ago is still "open".
 *        getExportOpportunities lists it as a live opportunity, with its own
 *        closeDate in the past printed on the card, and two of the three paths
 *        charge whoever clicks it.
 *
 *        The same "defined more than once, one of them hardened" shape this
 *        file already opens with about updateExportStatusAction — a third time,
 *        on the door where money enters.
 *
 * WHY THE UNION AND NOT THE STRICTER RULE
 * ---------------------------------------
 * "open" OR "active", which is what the two unhardened paths accept, rather
 * than the "open" the hardened one takes. No window that can be invested in
 * today stops being investable; two paths simply gain the deadline check.
 *
 * "active" is a status NO WRITER PRODUCES — export-aggregation.ts creates an
 * investable window "open" and its own type excludes "active", as does
 * EXPORT_WINDOW_ALL_STATUSES. It is kept anyway: narrowing a money path on the
 * strength of a static scan would refuse a single hand-edited production row.
 * Recorded in export-window-expiry.test.ts, not acted on.
 *
 * AN ABSENT OR UNREADABLE endDate IS NOT A DEADLINE. That is exactly what
 * export-aggregation.ts already did — `new Date() > new Date(undefined)` is
 * false — and copying the hardened path rather than inventing a stricter rule
 * keeps this a fix. #272's reasoning, not #245's: a deadline nobody set is not
 * a control that failed.
 */
export type ExportInvestmentVerdict =
    | { ok: true }
    | { ok: false; reason: "not_open" | "expired"; message: string };

function endDateOf(value: unknown): Date | null {
    if (!value) return null;
    // export_windows rows carry both a Firestore Timestamp and an ISO string;
    // getExportOpportunities branches on .toDate?.() for the same reason.
    const raw = typeof (value as { toDate?: () => Date }).toDate === "function"
        ? (value as { toDate: () => Date }).toDate()
        : value as string | number | Date;

    const d = new Date(raw as string);
    return Number.isNaN(d.getTime()) ? null : d;
}

export function exportWindowAcceptsInvestment(
    windowData: { status?: unknown; endDate?: unknown } | null | undefined,
    now: Date = new Date(),
): ExportInvestmentVerdict {
    const status = String(windowData?.status ?? "");

    // EXPORT_WINDOW_INVESTABLE_STATUSES, not a second copy of it — the
    // vocabulary test above caught me declaring one, which is the exact
    // duplication this file exists to prevent.
    if (!(EXPORT_WINDOW_INVESTABLE_STATUSES as readonly string[]).includes(status)) {
        return {
            ok: false,
            reason: "not_open",
            message: "This export window is no longer accepting investments",
        };
    }

    const endDate = endDateOf(windowData?.endDate);
    if (endDate && now > endDate) {
        return {
            ok: false,
            reason: "expired",
            message: "This export window has expired and is no longer accepting investments",
        };
    }

    return { ok: true };
}

/**
 * What one naira invested in a window pays back — #324.
 *
 * THE PAYING PATH WAS THE ONE THAT NEVER ADOPTED THIS MODULE
 * ----------------------------------------------------------
 * Three places decide an export return, and until now the two that only TALK
 * about it agreed while the one that MOVES MONEY did not.
 *
 * The two fulfilment paths — payments/service.ts and export/_ex_investments.ts
 * — both compute it as:
 *
 *     exportData.returnMultiplier ?? exportData.expectedReturnMultiplier ?? 1.20
 *
 * and /export/windows/[id] quotes the investor exportWindowRoiPercent(...),
 * which defaults to DEFAULT_EXPORT_ROI_PERCENT = 20 for exactly the reason
 * written above it: 20% "is the return the platform already pays when a window
 * records nothing", and using anything else "would have the page advertise one
 * figure and the payout compute another."
 *
 * cron/release-escrow — the job that actually credits the member — did:
 *
 *     const roiString = data.roi || "15%";
 *     let roiPercentage = 0.15;
 *     const match = roiString.match(/(\d+)%/);
 *     if (match) roiPercentage = parseInt(match[1]) / 100;
 *     const totalPayout = amount * (1 + roiPercentage);
 *
 * Three separate problems in five lines:
 *
 *   1. It reads `data.roi`, and NOTHING WRITES AN ROI ONTO A WINDOW — the note
 *      on exportWindowRoiPercent above establishes that, and it still holds.
 *      So the branch that reads a configured rate never runs.
 *   2. Its default is therefore always in force, and it is 15, not 20. Every
 *      delivered window paid 1.15x while the platform quoted 1.20x at the
 *      moment the member paid in. A five-point shortfall on every export
 *      return, silently, forever.
 *   3. It never looks at `roiPercentage` at all — the field
 *      payments/service.ts's own warning tells the operator to add ("Add
 *      'roiPercentage' to the window doc"). An operator who followed that
 *      instruction was still paid the default.
 *
 * This is #38/#179/#183's shape — one rule in N copies that disagree — landing
 * on the copy that pays.
 *
 * WHAT THIS DOES AND DOES NOT DECIDE
 * ----------------------------------
 * It is the two fulfilment paths' rule, extracted verbatim, so pointing them at
 * it changes nothing and pointing the cron at it makes the payout match the
 * quote. It deliberately does NOT consult the `roi` / `roiPercentage` STRINGS
 * for money: no money path has ever done so, and making them authoritative
 * would change what the two working paths pay. That the strings are display-only
 * while the multiplier is the money is now one documented fact in one place,
 * rather than a difference between three files.
 */
export function exportWindowReturnMultiplier(window: Record<string, unknown> | null | undefined): number {
    const raw = (window?.returnMultiplier ?? window?.expectedReturnMultiplier) as unknown;
    const parsed = Number(raw);

    // Finite and positive, or the platform default. A window carrying a string,
    // a zero or a negative must not silently pay nothing or take money back.
    if (Number.isFinite(parsed) && parsed > 0) return parsed;

    return 1 + DEFAULT_EXPORT_ROI_PERCENT / 100;
}
