import { formatDistance } from "date-fns";
import { CURRENCY_CONFIG } from "./constants";
import { toDateOrNull } from "./date-utils";

export function formatCurrency(amount: any): string {
    const value = Number(amount);
    const safeAmount = isNaN(value) ? 0 : value;
    return new Intl.NumberFormat(CURRENCY_CONFIG.locale, {
        style: "currency",
        currency: CURRENCY_CONFIG.code,
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    }).format(safeAmount);
}

/**
 * Coercion is delegated to date-utils rather than repeated here.
 *
 * This function had its own chain — string/number, .toDate(), else
 * `new Date(value)` — which does not recognise a SERIALIZED Firestore
 * Timestamp. Once a Timestamp crosses to a client component it is a plain
 * object carrying `_seconds`/`seconds` and no methods, and `new Date({...})`
 * on that is Invalid Date.
 *
 * So every one of the 26 files calling formatDate rendered the literal text
 * "Invalid Date" for any date arriving in that shape. Found by the first
 * rendering test in this repository, on the admin users table's Joined column
 * — tsc cannot see it, because the parameter is `any`.
 *
 * date-utils.toDateOrNull already handles both shapes and returns null when a
 * value genuinely is not a date, which preserves the "N/A" and "Invalid Date"
 * answers below exactly as they were. Note toDate (no OrNull) would be wrong
 * here: it falls back to the current moment, so an unparseable value would
 * render as today.
 */
export function formatDate(date: Date | string | null | undefined | any): string {
    if (!date) return "N/A";
    try {
        const d = toDateOrNull(date);
        if (!d) return "Invalid Date";
        return new Intl.DateTimeFormat("en-NG", {
            year: "numeric",
            month: "short",
            day: "numeric",
        }).format(d);
    } catch (e) {
        return "Invalid Date";
    }
}

/** Same coercion fix as formatDate above. */
export function formatDateTime(date: Date | string | null | undefined | any): string {
    if (!date) return "Unknown";
    try {
        const d = toDateOrNull(date);
        if (!d) return "Unknown";
        return d.toLocaleDateString("en-NG", {
            day: "numeric", month: "short", year: "numeric",
            hour: "2-digit", minute: "2-digit",
        });
    } catch (e) {
        return "Unknown";
    }
}

export function formatRelativeTime(date: Date | string | null | undefined): string {
    if (!date) return "N/A";
    try {
        const d = typeof date === "string" ? new Date(date) : date;
        if (isNaN(d.getTime())) return "N/A";
        return formatDistance(d, new Date(), { addSuffix: true });
    } catch (e) {
        return "Invalid Date";
    }
}

export function cn(...classes: (string | undefined | null | false)[]): string {
    return classes.filter(Boolean).join(" ");
}

export function calculateTimeRemaining(endDate: Date): {
    days: number;
    hours: number;
    minutes: number;
    seconds: number;
    expired: boolean;
} {
    const now = new Date().getTime();
    const end = new Date(endDate).getTime();
    const diff = end - now;

    if (diff <= 0) {
        return { days: 0, hours: 0, minutes: 0, seconds: 0, expired: true };
    }

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);

    return { days, hours, minutes, seconds, expired: false };
}

/**
 * Escapes HTML characters in a string to prevent XSS attacks.
 */
export function escapeHtml(str: string): string {
    if (!str) return "";
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

/**
 * Safely converts various date-like formats (Timestamp, string, number) to a Date object.
 */
export function toSafeDate(date: any): Date {
    if (!date) return new Date();
    if (date instanceof Date) return date;
    
    try {
        if (typeof date === "string" || typeof date === "number") {
            const d = new Date(date);
            return isNaN(d.getTime()) ? new Date() : d;
        }
        
        // Handle Firestore Timestamp
        if (date && typeof date.toDate === "function") {
            return date.toDate();
        }
        
        // Handle POJO Timestamp (from server actions)
        if (date && typeof date.seconds === "number") {
            return new Date(date.seconds * 1000);
        }
        
        const fallback = new Date(date);
        return isNaN(fallback.getTime()) ? new Date() : fallback;
    } catch {
        return new Date();
    }
}

/**
 * Safely parses a string that might contain currency symbols (e.g. ₦, $, €),
 * commas, or other formatting characters, into a clean float.
 */
export function parseCurrencyStringToFloat(val: string | null | undefined): number {
    if (val === null || val === undefined) return 0;
    const cleanStr = String(val)
        .replace(/[₦$€,]/g, "") // remove common currency symbols and commas
        .replace(/\s+/g, "")    // remove whitespace
        .trim();
    if (cleanStr === "") return 0;
    return parseFloat(cleanStr);
}

