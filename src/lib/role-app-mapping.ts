/**
 * Role-to-App Access Mapping
 * 
 * Defines which apps/features users can access based on their roles.
 * Users only see and access apps they've signed up for.
 */

import { UserRole } from "./types/roles";

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
 * Check if user has access to a specific app
 */
export function hasAppAccess(userRoles: UserRole[], app: AppIdentifier): boolean {
    // Universal apps are always accessible
    if (UNIVERSAL_APPS.includes(app)) {
        return true;
    }

    // Check if any of the user's roles grant access to this app
    return userRoles.some(role => {
        const allowedApps = ROLE_APP_ACCESS[role];
        return allowedApps?.includes(app) ?? false;
    });
}

/**
 * Get all apps accessible to user based on their roles
 */
export function getUserAccessibleApps(userRoles: UserRole[]): AppIdentifier[] {
    const apps = new Set<AppIdentifier>(UNIVERSAL_APPS);

    userRoles.forEach(role => {
        const roleApps = ROLE_APP_ACCESS[role];
        roleApps.forEach(app => apps.add(app));
    });

    return Array.from(apps);
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
    const validApps: AppIdentifier[] = [
        "dashboard", "export", "marketplace", "cooperatives",
        "wave", "farm-nation", "academy", "escrow", "messages", "profile"
    ];

    if (!validApps.includes(firstSegment as AppIdentifier)) {
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
        "buyer", "marketplace_buyer", "seller",         // Marketplace
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
export function getPrimaryApp(userRoles: UserRole[]): string {
    // Role priority mapping
    const rolePriorityMap: Record<UserRole, string> = {
        export_participant: "/export/dashboard",
        buyer: "/marketplace/buyer/dashboard",
        marketplace_buyer: "/marketplace/buyer/dashboard",
        seller: "/marketplace/seller/dashboard",
        farmer: "/farm-nation/dashboard",
        land_owner: "/farm-nation/dashboard",
        investor: "/farm-nation/dashboard",
        cooperative_member: "/cooperatives/dashboard",
        wave_participant: "/wave/dashboard",
        academy_participant: "/academy/dashboard",
        general_user: "/", // General users start at the Hub
        field_officer: "/admin",
        admin: "/admin",
        super_admin: "/admin",
    };

    // MODULE ROLES FIRST — Check specific program memberships before admin.
    // A user who enrolled in WAVE (and also has admin) must reach /wave/dashboard.
    const modulePriorityOrder: UserRole[] = [
        "export_participant",
        "seller", "buyer", "marketplace_buyer",
        "farmer", "land_owner", "investor",
        "cooperative_member",
        "wave_participant",
        "academy_participant",
        "general_user",
    ];

    for (const role of modulePriorityOrder) {
        if (userRoles.includes(role)) {
            return rolePriorityMap[role];
        }
    }

    // ADMIN FALLBACK — Only reached when user has no module-specific role.
    const adminPriorityOrder: UserRole[] = [
        "super_admin", "admin", "field_officer",
    ];

    for (const role of adminPriorityOrder) {
        if (userRoles.includes(role)) {
            return rolePriorityMap[role];
        }
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
