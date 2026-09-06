/**
 * Role-to-App Access Mapping
 * 
 * Defines which apps/features users can access based on their roles.
 * Users only see and access apps they've signed up for.
 */

import { UserRole, LEGACY_ROLE_MAP, type LegacyRole } from "./types/roles";
import { canonicalRoles } from "./role-aliases";

/**
 * App identifiers matching route paths
 */
export type AppIdentifier =
    | "dashboard"
    | "export"
    | "marketplace"
    | "cooperatives"
    | "wave"
    | "farm-nation"
    | "academy"
    | "escrow"
    | "messages"
    | "profile";

/**
 * Maps user roles to accessible apps
 * 
 * Rules:
 * - Escrow is ONLY for: Marketplace, Farm Nation, Export Windows users
 * - Each app has its own dashboard (e.g., /marketplace/dashboard, /export/dashboard)
 * - WAVE and Academy users → NO Escrow access
 * - Cooperative users → NO Escrow access
 * - Everyone gets: Messages, Profile
 * - Admins get: Everything
 */
export const ROLE_APP_ACCESS: Record<UserRole, AppIdentifier[]> = {
    // Marketplace Access (includes Escrow)
    buyer: ["marketplace", "escrow"],
    marketplace_buyer: ["marketplace", "escrow"],
    seller: ["marketplace", "escrow"],
    marketplace_seller: ["marketplace", "escrow"],

    // Export Participants (includes Escrow)
    export_participant: ["export", "escrow"],

    // Cooperative Members (NO Escrow)
    cooperative_member: ["cooperatives"],

    // WAVE Program (NO Escrow)
    wave_participant: ["wave"],

    // Academy Learning Platform
    academy_participant: ["academy"],

    // Farm Nation Access (includes Escrow)
    farmer: ["farm-nation", "escrow"],
    land_owner: ["farm-nation", "escrow"],
    investor: ["farm-nation", "escrow"],

    // General user - NO automatic platform access (strict mode)
    general_user: [],

    // Verifiers/Staff
    field_officer: ["export", "marketplace", "cooperatives", "wave", "farm-nation"],

    // Module-specific admin roles
    cooperative_admin: ["cooperatives"],
    academy_admin: ["academy"],
    wave_admin: ["wave"],
    marketplace_admin: ["marketplace", "escrow"],
    farm_nation_admin: ["farm-nation", "escrow"],
    export_admin: ["export", "escrow"],

    // Admin roles - full access
    admin: ["export", "marketplace", "cooperatives", "wave", "farm-nation", "academy", "escrow"],
    super_admin: ["export", "marketplace", "cooperatives", "wave", "farm-nation", "academy", "escrow"],
};

/**
 * Apps that are accessible to everyone (regardless of role)
 * Dashboard is a smart redirect to user's primary app and must be universally accessible
 * Messages is cross-platform communication available to all authenticated users
 */
export const UNIVERSAL_APPS: AppIdentifier[] = ["dashboard", "profile", "messages"];

/**
 * Every app identifier, as a runtime value.
 *
 * The type above cannot be checked against anything that arrives over the wire,
 * and this list previously existed only as a local inside canAccessRoute — so
 * anything else needing to validate a module identifier had to write its own
 * copy. /api/hub/telemetry did not, and accepted any string.
 */
export const APP_IDENTIFIERS: readonly AppIdentifier[] = [
    "dashboard", "export", "marketplace", "cooperatives",
    "wave", "farm-nation", "academy", "escrow", "messages", "profile",
] as const;

/**
 * Check if user has access to a specific app
 */
export function hasAppAccess(userRoles: UserRole[], app: AppIdentifier): boolean {
    // Universal apps are always accessible
    if (UNIVERSAL_APPS.includes(app)) {
        return true;
    }

    // Check if any of the user's roles grant access to this app
    return normaliseRoles(userRoles).some(role => {
        const allowedApps = ROLE_APP_ACCESS[role];
        return allowedApps?.includes(app) ?? false;
    });
}

/**
 * Get all apps accessible to user based on their roles
 */
export function getUserAccessibleApps(userRoles: UserRole[]): AppIdentifier[] {
    const apps = new Set<AppIdentifier>(UNIVERSAL_APPS);

    normaliseRoles(userRoles).forEach(role => {
        // `?? []` because ROLE_APP_ACCESS is keyed by UserRole and `role` is
        // whatever the database holds. This read was unguarded while the
        // identical read in hasAppAccess above used `?.` — two functions, one
        // lookup, one of them defensive. The unguarded one threw
        // "Cannot read properties of undefined (reading 'forEach')" on every
        // login by a user carrying a legacy role.
        const roleApps = ROLE_APP_ACCESS[role] ?? [];
        roleApps.forEach(app => apps.add(app));
    });

    return Array.from(apps);
}

/**
 * Translate legacy role names before looking them up.
 *
 * WHY THIS IS NEEDED
 * ------------------
 * Both functions above are typed `userRoles: UserRole[]`, and both are called
 * with roles read straight out of the users table, where the value is whatever
 * was written — including the pre-migration names in LEGACY_ROLE_MAP.
 *
 * "member" is the common one. It is on 8 of the 9 seeded accounts because that
 * mirrors production, and it is NOT a key of ROLE_APP_ACCESS. Two things
 * followed:
 *
 *   getUserAccessibleApps  threw on the undefined lookup, so getPrimaryApp
 *                          threw, so getPostLoginRedirect fell into its catch
 *                          and returned /dashboard. Every login by a legacy
 *                          user landed on the generic hub instead of their
 *                          module, and logged an error saying only
 *                          "Cannot read properties of undefined".
 *   hasAppAccess           did not throw — it answered FALSE. So the same
 *                          users were quietly denied access the role was
 *                          supposed to grant. The silent one is the worse of
 *                          the two.
 *
 * Mapping rather than skipping is the point: "member" means "general_user",
 * and treating it as unknown would drop access instead of restoring it.
 * Unrecognised names are passed through untouched and handled by the `??`
 * guards, so an unexpected value degrades rather than throws.
 */
function normaliseRoles(userRoles: UserRole[] | undefined | null): UserRole[] {
    if (!Array.isArray(userRoles)) return [];

    //   #458 THIS TABLE IS NO LONGER PRIVATE TO THIS FILE. It resolved the
    //        pre-migration names for app access and nothing else did for role
    //        checks, so a `vendor` reached the seller app while
    //        hasRole(roles, "seller") said no. canonicalRoles is the one
    //        resolver now, over one table, and it also carries the legacy
    //        `superadmin` spelling that only actions/auth.ts used to know.
    return canonicalRoles(
        userRoles.filter((role): role is UserRole => typeof role === 'string'),
    );
}

/**
 * Check if route requires specific roles
 * Returns true if user has required access, false otherwise
 */
export function canAccessRoute(userRoles: UserRole[], routePath: string): boolean {
    // Extract app identifier from route (e.g., "/marketplace/products" -> "marketplace")
    const segments = routePath.split("/").filter(Boolean);
    const firstSegment = segments[0];

    // Allow access to root and auth pages
    if (!firstSegment || firstSegment === "auth" || firstSegment === "login" || firstSegment === "register") {
        return true;
    }

    // Check if this is a valid app identifier
    if (!APP_IDENTIFIERS.includes(firstSegment as AppIdentifier)) {
        return true; // Unknown routes are allowed (let Next.js handle 404)
    }

    return hasAppAccess(userRoles, firstSegment as AppIdentifier);
}

/**
 * Special rule: Escrow is ONLY for Marketplace, Farm Nation, Export Windows users
 * This explicitly blocks WAVE, Academy, and Cooperative users from Escrow
 */
export function canAccessEscrow(userRoles: UserRole[]): boolean {
    const escrowRoles: UserRole[] = [
        "buyer", "marketplace_buyer", "seller", "marketplace_seller", // Marketplace
        "export_participant",                          // Export Windows
        "farmer", "land_owner", "investor",           // Farm Nation
        "admin", "super_admin"                        // Admins
    ];
    return userRoles.some(role => escrowRoles.includes(role));
}

/**
 * Get user's primary app based on their first/main role
 * This determines where /dashboard should redirect
 *
 * PRIORITY ORDER (most to least specific):
 * Module roles ALWAYS take precedence over admin roles.
 * Admin/super_admin is only the destination if the user has NO module role.
 * This prevents a user who is both an admin and a wave_participant from
 * being sent to /admin when they should be in their module dashboard.
 */
export function getPrimaryApp(rawUserRoles: UserRole[]): string {
    // Legacy names translated here too, for the same reason as the two
    // functions above: without it, ["member"] matches none of the priority
    // lists below — not even the explicit general_user branch — and falls
    // through to the "roles are somehow unrecognised" scan at the end.
    const userRoles = normaliseRoles(rawUserRoles);

    // Role priority mapping
    const rolePriorityMap: Record<UserRole, string> = {
        export_participant: "/export/dashboard",
        buyer: "/marketplace/buyer/dashboard",
        marketplace_buyer: "/marketplace/buyer/dashboard",
        seller: "/marketplace/seller/dashboard",
        marketplace_seller: "/marketplace/seller/dashboard",
        farmer: "/farm-nation/dashboard",
        land_owner: "/farm-nation/dashboard",
        investor: "/farm-nation/dashboard",
        cooperative_member: "/cooperatives/dashboard",
        wave_participant: "/wave/dashboard",
        academy_participant: "/academy/dashboard",
        general_user: "/", // General users start at the Hub
        field_officer: "/admin",
        cooperative_admin: "/admin/cooperatives",
        academy_admin: "/admin/academy",
        wave_admin: "/admin/wave",
        marketplace_admin: "/admin/marketplace",
        farm_nation_admin: "/admin/farm-nation",
        export_admin: "/admin/export",
        admin: "/admin",
        super_admin: "/admin",
    };

    // MODULE ROLES FIRST — Check specific program memberships before admin.
    // A user who enrolled in WAVE (and also has admin) must reach /wave/dashboard.
    const modulePriorityOrder: UserRole[] = [
        "export_participant",
        "seller", "buyer", "marketplace_buyer", "marketplace_seller",
        "farmer", "land_owner", "investor",
        "cooperative_member",
        "wave_participant",
        "academy_participant",
    ];

    for (const role of modulePriorityOrder) {
        if (userRoles.includes(role)) {
            return rolePriorityMap[role];
        }
    }

    // ADMIN FALLBACK — Only reached when user has no module-specific role.
    // NOTE: Module admins are silo-isolated and blocked from the global /admin dashboard.
    // Therefore, they must take precedence over 'admin' and 'super_admin' to be correctly routed.
    const adminPriorityOrder: UserRole[] = [
        "cooperative_admin", "academy_admin", "wave_admin",
        "marketplace_admin", "farm_nation_admin", "export_admin",
        "super_admin", "admin",
        "field_officer",
    ];

    for (const role of adminPriorityOrder) {
        if (userRoles.includes(role)) {
            return rolePriorityMap[role];
        }
    }

    // GENERAL USER FALLBACK — Check after other active roles to avoid hijacking admins
    if (userRoles.includes("general_user")) {
        return "/";
    }

    // FINAL FALLBACK: Scan accessible apps if roles are somehow unrecognised
    const accessibleApps = getUserAccessibleApps(userRoles);

    const fallbackPriority: AppIdentifier[] = [
        "marketplace", "export", "farm-nation",
        "cooperatives", "wave", "academy"
    ];

    for (const app of fallbackPriority) {
        if (accessibleApps.includes(app)) {
            if (app === "cooperatives") return "/cooperatives/dashboard";
            if (app === "wave") return "/wave/dashboard";
            if (app === "export") return "/export/dashboard";
            if (app === "farm-nation") return "/farm-nation/dashboard";
            if (app === "academy") return "/academy/dashboard";
            if (app === "marketplace") return "/marketplace/buyer/dashboard";
            return `/${app}`;
        }
    }

    // Absolute fallback — no apps at all
    return "/";
}
