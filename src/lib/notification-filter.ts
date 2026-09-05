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

    /**
     *   #417 THE "FUTURE-PROOF" CLAUSE COULD NOT BE REACHED BY THE PEOPLE IT
     *   WAS WRITTEN FOR.
     *
     *   These three tests used to run in the other order:
     *
     *       if (!serviceRegistrations) return false;   // "hide all
     *                                                  //  module-specific"
     *       const requiredKeys = MODULE_TYPE_MAP[type];
     *       if (!requiredKeys) return true;            // "unknown type — show
     *                                                  //  it (future-proof)"
     *
     *   The early return does not do what its comment says. It hides every
     *   non-universal type, INCLUDING the ones that are not module-specific at
     *   all — so for anyone with no serviceRegistrations, which is every
     *   account before it joins a module, an unclassifiable notification was
     *   dropped without trace. The line three below, stating the opposite
     *   policy, could never run for them.
     *
     *   Deciding what a type belongs to does not depend on the subscriptions,
     *   so it is decided first. A type nothing recognises is shown — which is
     *   what the comment always claimed, and is the same principle as #307/#408:
     *   when we cannot classify something, do not silently answer "nothing".
     *
     *   LATENT, AND SAYING SO. Every type this codebase writes today is in one
     *   of the two sets — checked against the union in createNotificationAction
     *   and against notificationService — so nothing produced now reaches the
     *   clause either way. What DOES reach it is a row with no `type` at all
     *   (legacy or imported), which used to vanish from the panel entirely.
     */
    const requiredKeys = MODULE_TYPE_MAP[type];
    if (!requiredKeys) return true; // unknown or unclassifiable type — show it

    // A module-specific type, and nothing to check it against.
    if (!serviceRegistrations) return false;

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

/**
 *   #416 THE WINDOW BOTH NOTIFICATION BADGES READ.
 *
 *   NotificationCenter fetches this many and counts the unread visible ones for
 *   its bell; getMyUnreadNotificationCount reads the same many for the nav
 *   badge. Two numbers describing the same fact have to describe the same set,
 *   so the number lives here rather than in either of them.
 *
 *   It is NOT in my-data.ts because that module carries "use server", and a
 *   "use server" module may export only async functions — a plain const there
 *   fails the build.
 */
export const NOTIFICATION_BADGE_WINDOW = 50;
