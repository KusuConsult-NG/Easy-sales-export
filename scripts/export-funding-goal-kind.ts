/**
 * Pure classification helpers for export_windows rows, split out from
 * backfill-export-funding-goals.ts so they can be imported (by tests, or
 * anything else) without dragging in that script's CLI entrypoint —
 * which validates Supabase env vars and calls process.exit(1) if they are
 * missing, and otherwise runs main() unconditionally on import.
 *
 * Duplicated from lib/export-window-status.ts deliberately: a script that
 * imports application code drags the whole module graph and its environment
 * expectations into a one-off maintenance run. Kept in step by
 * export-window-kind-and-goal.test.ts, which asserts both agree.
 */

export function kindOf(raw: Record<string, any>): 'shipment' | 'aggregation' {
    if (raw.windowKind === 'shipment' || raw.windowKind === 'aggregation') return raw.windowKind;

    const num = (v: unknown) => Number.isFinite(Number(v)) && Number(v) !== 0;
    if (num(raw.slotPrice) || num(raw.targetVolume)) return 'aggregation';
    if (String(raw.status ?? '').trim().toLowerCase() === 'open') return 'aggregation';

    return 'shipment';
}

export function goalOf(raw: Record<string, any>): number | null {
    const targetVolume = Number(raw.targetVolume);
    const slotPrice = Number(raw.slotPrice);
    if (!Number.isFinite(targetVolume) || targetVolume <= 0) return null;
    if (!Number.isFinite(slotPrice) || slotPrice <= 0) return null;
    return targetVolume * slotPrice;
}

/**
 * What the backfill decides for ONE export-window row.
 *
 *   #967 THE APPLY PATH OF A PRODUCTION WRITE HAD NEVER BEEN EXECUTED.
 *
 *   backfill-export-funding-goals is run as `npm run backfill:exportgoals --
 *   --apply` against production, and maintenance-scripts-do-not-overstate
 *   already RECORDS that it is one of three scripts no test executes. Its
 *   `readWindows`, `apply` and `main` are module-private and the module itself
 *   calls createClient at import time, so nothing could reach them.
 *
 *   kindOf and goalOf above were already extracted and are tested. What was not
 *   is the decision BETWEEN them — which rows get written, which are left alone,
 *   and which are reported as unusable. That is the part that decides what a
 *   production write touches, so it moves here beside its siblings and is
 *   exercised by the-write-nobody-had-executed.
 *
 *   MOVED WITHOUT CHANGING IT. The four outcomes below are the script's existing
 *   branches, in its order, including the one nobody would guess:
 *
 *     A row can be BOTH `skip` and carry a patch. An aggregation window with no
 *     usable targetVolume x slotPrice is reported as unusable — and if its
 *     `windowKind` is also wrong, that still gets written. Reporting a row as
 *     skipped while writing part of it looks like a contradiction and is not one:
 *     the goal is what could not be computed, and the kind is a separate fact
 *     that could. Pinned rather than tidied, because tidying it would silently
 *     stop correcting the kind on exactly those rows.
 */
export type RowPlan =
    | { outcome: 'patch'; kind: 'shipment' | 'aggregation'; goal: number | null; patch: Record<string, unknown>; skipReason?: string }
    | { outcome: 'already-correct' }
    | { outcome: 'skip'; reason: string };

export function planRow(raw: Record<string, any>): RowPlan {
    const kind = kindOf(raw);

    const patch: Record<string, unknown> = {};
    if (raw.windowKind !== kind) patch.windowKind = kind;

    let goal: number | null = null;
    let skipReason: string | undefined;

    if (kind === 'aggregation') {
        const existing = Number(raw.fundingGoal);

        if (Number.isFinite(existing) && existing > 0) {
            //   Never overwritten: an admin may have set this by hand. The kind
            //   may still need correcting, which is why this does not return yet.
            if (Object.keys(patch).length === 0) return { outcome: 'already-correct' };
        } else {
            goal = goalOf(raw);
            if (goal === null) {
                skipReason = 'aggregation window with no usable targetVolume x slotPrice';
                if (Object.keys(patch).length === 0) return { outcome: 'skip', reason: skipReason };
            } else {
                patch.fundingGoal = goal;
            }
        }
    }

    if (Object.keys(patch).length === 0) return { outcome: 'already-correct' };
    return { outcome: 'patch', kind, goal, patch, ...(skipReason ? { skipReason } : {}) };
}
