/**
 * normalisePhone — Converts any Nigerian phone format to E.164 (+234XXXXXXXXXX)
 *
 * Handles:
 *   08012345678  → +2348012345678
 *   2348012345678 → +2348012345678
 *   +2348012345678 → +2348012345678 (no-op)
 *
 * Returns null for strings that cannot be normalised to a 13-digit +234 number.
 */
export function normalisePhone(raw: string | null | undefined): string | null {
    if (!raw) return null;
    let p = String(raw).replace(/\D/g, '');
    if (p.startsWith('0')) p = '234' + p.slice(1);
    if (p.startsWith('234') && p.length >= 13) return '+' + p;
    if (p.length >= 10) return '+234' + p.slice(-10);
    return null;
}

/**
 * normalisePhoneLoose — Same as normalisePhone but accepts shorter numbers.
 * Use only for display purposes, not for dedup queries.
 */
export function normalisePhoneLoose(raw: string | null | undefined): string | null {
    if (!raw) return null;
    let p = String(raw).replace(/\D/g, '');
    if (p.startsWith('0')) p = '234' + p.slice(1);
    if (p.length < 10) return null;
    return '+' + p;
}
