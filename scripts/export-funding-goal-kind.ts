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
