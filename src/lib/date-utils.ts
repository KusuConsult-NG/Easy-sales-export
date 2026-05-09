/**
 * Robust date formatting utility for the Easy Sales Export platform.
 * Handles various date-like inputs: Date objects, Firestore Timestamps (including serialized versions),
 * ISO strings, and numeric timestamps.
 */

export function toDate(date: any): Date {
    if (!date) return new Date();
    
    // Handle Firestore Timestamp (client-side plain object or server-side class)
    if (typeof date === 'object') {
        if (typeof date.toDate === 'function') {
            return date.toDate();
        }
        if (typeof date.seconds === 'number') {
            return new Date(date.seconds * 1000);
        }
    }
    
    // Handle numeric timestamp or ISO string
    const d = new Date(date);
    if (!isNaN(d.getTime())) {
        return d;
    }
    
    return new Date();
}

/**
 * Formats a date-like input to a local date string (e.g., "MM/DD/YYYY").
 */
export function formatLocalDate(date: any): string {
    return toDate(date).toLocaleDateString();
}

/**
 * Formats a date-like input to a local date-time string.
 */
export function formatLocalDateTime(date: any): string {
    return toDate(date).toLocaleString();
}
