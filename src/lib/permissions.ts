/**
 * Permission Matrix
 *
 *   #353 NOTHING IMPORTS THIS FILE, AND IT DISAGREES WITH THE SYSTEM THAT IS
 *        ACTUALLY ENFORCED. READ BEFORE WIRING IT UP.
 *
 *        Its header said "Defines which roles can access which features and
 *        routes", which reads as authoritative and is not true of any request
 *        this application serves. There are zero importers of
 *        `@/lib/permissions` in src/. `canAccessRoute`, `hasFeaturePermission`
 *        and `getAccessibleRoutes` have never been called.
 *
 *        WHAT ACTUALLY DECIDES ACCESS:
 *
 *          lib/admin-permissions.ts   PERMISSION_MATRIX — the ten admin roles
 *                                     and their capability strings, plus
 *                                     isAdmin() and hasAdminPermission().
 *                                     This is the authority.
 *          lib/route-manifest.ts      which paths are protected
 *          lib/session-guard.ts       who is signed in and not banned
 *          lib/hub-guard.ts           who has completed hub registration
 *          checkModuleAccess          per-module membership
 *
 *        WHY WIRING THIS UP AS-IS WOULD LOCK PEOPLE OUT. Nine of the twenty-one
 *        values in the UserRole union are absent from ROUTE_PERMISSIONS below:
 *
 *            academy_admin        cooperative_admin    export_admin
 *            farm_nation_admin    marketplace_admin    wave_admin
 *            marketplace_buyer    marketplace_seller   academy_participant
 *
 *        So `canAccessRoute` would refuse every module admin at /admin, refuse
 *        a marketplace_seller at /marketplace — the standardised role the type
 *        itself calls "new standardized role" — and refuse an
 *        academy_participant at /academy, the route this file marks "all
 *        users". It also knows nothing of `moderator` or `support`.
 *
 *        It is KEPT rather than deleted, per the standing instruction to fix
 *        rather than remove. The ratchet in
 *        src/__tests__/unit/one-permission-authority.test.ts holds it: while it
 *        has no importers it may drift, and the moment anything imports it its
 *        vocabulary must match the real role set. That is the point at which
 *        this becomes a decision rather than a document.
 *
 *        OWNER DECISION: adopt this as the route/feature layer and complete it
 *        against the real roles, or retire it. It duplicates, incompletely, a
 *        system that already works.
 */

import type { UserRole } from "./types/roles";

/**
 * Route-based permissions
 * Maps routes to required roles (user must have AT LEAST ONE of these roles)
 */
export const ROUTE_PERMISSIONS: Record<string, UserRole[]> = {
    // Dashboard - accessible to all authenticated users with any role
    "/dashboard": ["general_user", "buyer", "seller", "land_owner", "farmer", "investor", "export_participant", "cooperative_member", "wave_participant", "field_officer", "admin", "super_admin"],

    // Marketplace
    "/marketplace": ["buyer", "seller", "admin", "super_admin"],
    "/marketplace/sell": ["seller", "admin", "super_admin"],
    "/marketplace/buy": ["buyer", "admin", "super_admin"],

    // Export Windows
    "/export": ["export_participant", "admin", "super_admin"],

    // Cooperatives
    "/cooperatives": ["cooperative_member", "admin", "super_admin"],
    "/cooperatives/contribute": ["cooperative_member", "admin", "super_admin"],
    "/cooperatives/withdraw": ["cooperative_member", "admin", "super_admin"],
    "/cooperatives/loans": ["cooperative_member", "admin", "super_admin"],
    "/cooperatives/fixed-savings": ["cooperative_member", "admin", "super_admin"],

    // WAVE Program (female only)
    "/wave": ["wave_participant", "admin", "super_admin"],

    // Farm Nation
    "/farm-nation": ["farmer", "land_owner", "investor", "admin", "super_admin"],

    // Academy - all users
    "/academy": ["general_user", "buyer", "seller", "land_owner", "farmer", "investor", "export_participant", "cooperative_member", "wave_participant", "field_officer", "admin", "super_admin"],

    // Land Listings
    "/land": ["land_owner", "buyer", "investor", "admin", "super_admin"],

    // Admin Panel
    "/admin": ["admin", "super_admin"],
    "/admin/users": ["super_admin"],
    "/admin/withdrawals": ["admin", "super_admin"],
    "/admin/export-approvals": ["admin", "super_admin"],
    "/admin/wave-applications": ["admin", "super_admin"],
    "/admin/audit-logs": ["super_admin"],
    "/admin/analytics": ["admin", "super_admin"],
    "/admin/announcements": ["admin", "super_admin"],
    "/admin/banners": ["admin", "super_admin"],
    "/admin/settings": ["super_admin"],
};

/**
 * Feature-based permissions
 */
export const FEATURE_PERMISSIONS = {
    // Marketplace
    canSellProducts: ["seller", "admin", "super_admin"],
    canBuyProducts: ["buyer", "admin", "super_admin"],
    canManageProducts: ["seller", "admin", "super_admin"],

    // Export
    canCreateExportWindow: ["export_participant", "admin", "super_admin"],
    canViewExportWindows: ["export_participant", "admin", "super_admin"],

    // Cooperatives
    canMakeContribution: ["cooperative_member", "admin", "super_admin"],
    canRequestWithdrawal: ["cooperative_member", "admin", "super_admin"],
    canApplyForLoan: ["cooperative_member", "admin", "super_admin"],

    // WAVE
    canAccessWave: ["wave_participant", "admin", "super_admin"],
    canApplyToWave: ["wave_participant", "admin", "super_admin"],

    // Farm Nation
    canListLand: ["land_owner", "admin", "super_admin"],
    canManageFarm: ["farmer", "admin", "super_admin"],
    canInvest: ["investor", "admin", "super_admin"],

    // Verification
    canVerifyApplications: ["field_officer", "admin", "super_admin"],
    canVerifyLand: ["field_officer", "admin", "super_admin"],

    // Admin
    canAccessAdminPanel: ["admin", "super_admin"],
    canManageUsers: ["super_admin"],
    canAssignRoles: ["super_admin"],
    canViewAuditLogs: ["super_admin"],
    canManageSettings: ["super_admin"],
    canApproveWithdrawals: ["admin", "super_admin"],
    canManageAnnouncements: ["admin", "super_admin"],
} as const;

export type FeaturePermission = keyof typeof FEATURE_PERMISSIONS;

/**
 * Check if user has permission for a specific feature
 */
export function hasFeaturePermission(
    userRoles: UserRole[],
    feature: FeaturePermission
): boolean {
    const requiredRoles = FEATURE_PERMISSIONS[feature];
    return requiredRoles.some(role => userRoles.includes(role));
}

/**
 * Check if user can access a route
 */
export function canAccessRoute(
    userRoles: UserRole[],
    route: string
): boolean {
    // Find matching route (check for exact match first, then prefix match)
    let requiredRoles = ROUTE_PERMISSIONS[route];

    if (!requiredRoles) {
        // Try prefix match (e.g., /admin/users/123 matches /admin/users)
        const matchingRoute = Object.keys(ROUTE_PERMISSIONS).find(r =>
            route.startsWith(r + "/") || route === r
        );

        if (matchingRoute) {
            requiredRoles = ROUTE_PERMISSIONS[matchingRoute];
        }
    }

    // If no permissions defined, allow access (public route)
    if (!requiredRoles || requiredRoles.length === 0) {
        return true;
    }

    // User must have at least one of the required roles
    return requiredRoles.some(role => userRoles.includes(role));
}

/**
 * Get all routes accessible by user
 */
export function getAccessibleRoutes(userRoles: UserRole[]): string[] {
    return Object.entries(ROUTE_PERMISSIONS)
        .filter(([, requiredRoles]) =>
            requiredRoles.some(role => userRoles.includes(role))
        )
        .map(([route]) => route);
}
