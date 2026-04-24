import { formatDistance } from "date-fns";
import { CURRENCY_CONFIG } from "./constants";

export function formatCurrency(amount: number): string {
    return new Intl.NumberFormat(CURRENCY_CONFIG.locale, {
        style: "currency",
        currency: CURRENCY_CONFIG.code,
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    }).format(amount);
}

export function formatDate(date: Date | string | null | undefined | any): string {
    if (!date) return "N/A";
    try {
        let d = date;
        if (typeof date === "string" || typeof date === "number") {
            d = new Date(date);
        } else if (date && typeof date.toDate === "function") {
            d = date.toDate();
        } else if (!(date instanceof Date)) {
            d = new Date(date);
        }
        if (isNaN(d.getTime())) return "Invalid Date";
        return new Intl.DateTimeFormat("en-NG", {
            year: "numeric",
            month: "short",
            day: "numeric",
        }).format(d);
    } catch (e) {
        return "Invalid Date";
    }
}

export function formatDateTime(date: Date | string | null | undefined | any): string {
    if (!date) return "Unknown";
    try {
        let d = date;
        if (typeof date === "string" || typeof date === "number") {
            d = new Date(date);
        } else if (date && typeof date.toDate === "function") {
            d = date.toDate();
        } else if (!(date instanceof Date)) {
            d = new Date(date);
        }
        if (isNaN(d.getTime())) return "Unknown";
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
