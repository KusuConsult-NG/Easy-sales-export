/**
 * Notification Module Filter
 *
 * Determines which notification types a user should see based on their
 * module subscriptions (serviceRegistrations).
 *
 * Rules:
 *  - "Universal" types (system, general, info, success, warning, error,
 *    payment, payout, transaction, order, marketplace) always show.
 *  - Module-specific types only show when the user has an approved / active
 *    registration for that module.
 *  - Admins see everything (detected via roles array).
 */

import type { UserRole } from "@/lib/types/roles";

export type NotifType =
    | "info" | "success" | "warning" | "error"
    | "loan" | "payment" | "wave" | "withdrawal"
    | "land" | "escrow" | "dispute"
    | "order" | "academy" | "cooperative" | "system"
    | "export" | "payout" | "farm_nation" | "marketplace"
    | "general" | "transaction" | "event" | "withdrawal";

/** Types that are always visible regardless of subscriptions */
const UNIVERSAL_TYPES = new Set<string>([
    "system",
    "general",
    "info",
    "success",
    "warning",
    "error",
    "payment",
    "payout",
    "transaction",
    "order",
    "marketplace",
    "withdrawal",
]);

/**
 * Maps notification type → serviceRegistrations key(s).
 * A notification is shown if ANY of the listed keys has an approved/active status.
 */
const MODULE_TYPE_MAP: Record<string, string[]> = {
    wave:        ["wave"],
    academy:     ["academy"],
    cooperative: ["cooperative", "cooperatives"],
    loan:        ["cooperative", "cooperatives"],   // loan notifications come from cooperative module
    farm_nation: ["farmNation", "farm_nation"],
    land:        ["farmNation", "farm_nation"],
    escrow:      ["farmNation", "farm_nation", "marketplace"],
    dispute:     ["farmNation", "farm_nation", "marketplace", "cooperative", "cooperatives"],
    export:      ["export"],
    event:       ["wave", "academy"],               // training/academy events
};

/** Statuses that count as "subscribed" for a given module */
const ACTIVE_STATUSES = new Set(["approved", "active", "paid"]);

/**
 * Returns true if the user has an active subscription for ANY of the given
 * serviceRegistration keys.
 */
function isSubscribed(serviceRegistrations: Record<string, any>, keys: string[]): boolean {
    return keys.some((key) => {
        const reg = serviceRegistrations?.[key];
        if (!reg) return false;
        return ACTIVE_STATUSES.has(reg.status);
    });
}

/**
 * Returns whether a notification type should be shown to this user.
 *
 * @param type               The notification's type field.
 * @param serviceRegistrations  From session.user.serviceRegistrations (or Firestore profile).
 * @param roles              From session.user.roles — admins bypass all filters.
 */
export function isNotificationVisible(
    type: string,
    serviceRegistrations: Record<string, any> | null | undefined,
    roles: string[] | null | undefined
): boolean {
    // Admins always see everything
    const isAdmin = (roles || []).some((r) =>
        r === "admin" || r === "super_admin" || r === "academy_admin"
    );
    if (isAdmin) return true;

    // Universal types always show
    if (UNIVERSAL_TYPES.has(type)) return true;

    // No subscriptions? hide all module-specific notifications
    if (!serviceRegistrations) return false;

    // Look up which module(s) this type belongs to
    const requiredKeys = MODULE_TYPE_MAP[type];
    if (!requiredKeys) return true; // unknown type — show it (future-proof)

    return isSubscribed(serviceRegistrations, requiredKeys);
}

/**
 * Returns an array of filter-tab keys that should be VISIBLE for this user.
 * Always includes "all" and "unread".
 */
export function getVisibleFilterTabs(
    serviceRegistrations: Record<string, any> | null | undefined,
    roles: string[] | null | undefined
): string[] {
    const always = ["all", "unread", "payment", "order"];

    const isAdmin = (roles || []).some((r) =>
        r === "admin" || r === "super_admin" || r === "academy_admin"
    );
    if (isAdmin) {
        return ["all", "unread", "payment", "order", "wave", "cooperative", "academy", "loan", "export", "farm_nation", "dispute"];
    }

    const conditional: Array<{ tab: string; keys: string[] }> = [
        { tab: "wave",        keys: ["wave"] },
        { tab: "cooperative", keys: ["cooperative", "cooperatives"] },
        { tab: "academy",     keys: ["academy"] },
        { tab: "loan",        keys: ["cooperative", "cooperatives"] },
        { tab: "export",      keys: ["export"] },
        { tab: "farm_nation", keys: ["farmNation", "farm_nation"] },
        { tab: "dispute",     keys: ["farmNation", "farm_nation", "marketplace", "cooperative", "cooperatives"] },
    ];

    const visible = [...always];
    for (const { tab, keys } of conditional) {
        if (isSubscribed(serviceRegistrations || {}, keys)) {
            visible.push(tab);
        }
    }
    return visible;
}
