/**
 * Admin Role Authorization Matrix
 * 
 * Defines granular permissions for admin roles:
 * - super_admin: Full system control
 * - admin: Standard administrative functions
 * - moderator: Content moderation only
 * - support: Read-only + user assistance
 * 
 * SECURITY: Use these helpers for all admin operations
 */

export type AdminRole = "super_admin" | "admin" | "moderator" | "support" | "wave_admin" | "cooperative_admin" | "marketplace_admin" | "export_admin" | "farm_nation_admin" | "academy_admin";

export type AdminPermission =
    // User Management
    | "users:read"
    | "users:create"
    | "users:update"
    | "users:delete"
    | "users:suspend"
    | "users:assign_roles"
    | "users:impersonate"
    // Bulk PII extraction. Separate from "users:read" on purpose: reading one
    // member's record to answer their support ticket and downloading every
    // member's name, email, phone and state as a CSV are not the same act, and
    // every admin role holds users:read.
    | "users:export"

    // Content Management
    | "content:read"
    | "content:approve"
    | "content:reject"
    | "content:delete"
    | "announcements:manage"

    // Financial Operations
    | "finance:read"
    // Re-running payment fulfilment: replaying Paystack transactions through
    // the same processors a webhook uses. It grants roles, activates
    // memberships and credits wallets, so it belongs with the finance WRITE
    // permissions and not with finance:read, which is where it was.
    | "finance:reconcile"
    | "finance:process_withdrawals"
    | "finance:refund"
    | "finance:resolve_disputes"

    // Configuration
    | "config:read"
    | "config:update"
    | "config:feature_toggles"
    | "config:rollback"

    // Marketplace
    | "marketplace:approve_sellers"
    | "marketplace:suspend_sellers"
    | "marketplace:moderate_reviews"
    // Village Market events and their external merchants. The four admin
    // entry points had NO permission in this matrix at all, so they fell back
    // to isAdmin() — true for every admin role, including support and
    // moderator, and for every other module's admin.
    | "marketplace:manage_village_market"

    // Cooperatives
    | "cooperatives:approve_loans"
    | "cooperatives:approve_members"
    | "cooperatives:manage_products"

    // WAVE
    | "wave:approve_applications"
    | "wave:manage_training"

    // Academy
    | "academy:approve_applications"
    | "academy:manage_courses"
    | "academy:manage_quizzes"
    | "academy:issue_certificates"

    // Export
    | "export:approve_applications"

    // Farm Nation
    | "farm_nation:verify_applications"
    | "land:verify_listings"

    // Audit & Security
    | "audit:read"
    | "audit:export"
    | "security:view_logs"
    | "security:manage_mfa";

/**
 * Permission Matrix
 * Maps roles to their allowed permissions
 */
const PERMISSION_MATRIX: Record<AdminRole, AdminPermission[]> = {
    super_admin: [
        // Full access to everything
        "users:read", "users:create", "users:update", "users:delete",
        "users:suspend", "users:assign_roles", "users:impersonate", "users:export",
        "content:read", "content:approve", "content:reject", "content:delete",
        "announcements:manage",
        "finance:read", "finance:reconcile", "finance:process_withdrawals", "finance:refund",
        "finance:resolve_disputes",
        "config:read", "config:update", "config:feature_toggles", "config:rollback",
        "marketplace:approve_sellers", "marketplace:suspend_sellers",
        "marketplace:moderate_reviews", "marketplace:manage_village_market",
        "cooperatives:approve_loans", "cooperatives:approve_members",
        "cooperatives:manage_products",
        "wave:approve_applications", "wave:manage_training",
        "academy:approve_applications", "academy:manage_courses", "academy:manage_quizzes", "academy:issue_certificates",
        "export:approve_applications",
        "farm_nation:verify_applications",
        "land:verify_listings",
        "audit:read", "audit:export", "security:view_logs", "security:manage_mfa"
    ],

    admin: [
        // Standard admin permissions (no deletion, no impersonation, no config rollback)
        //
        // "users:create" is here now. It was absent, and that absence was an
        // oversight rather than a policy: the line above enumerates exactly what
        // this role is denied — deletion, impersonation, config rollback — and
        // creation is not among them. The gap had a live cost. admin/_legacy.ts
        // is the only caller, and it onboards a legacy member who already
        // exists in the business but not in the platform; an `admin` opening
        // that screen was refused a task the role plainly owns, while keeping
        // users:update and users:assign_roles, which are the wider powers.
        "users:read", "users:create", "users:update", "users:suspend", "users:assign_roles",
        // Bulk PII export. Held by super_admin and admin only — deliberately
        // NOT by support, moderator, or any module admin. Granting it to one of
        // them later is a one-line change to a named permission, which is the
        // whole reason these routes moved off isAdmin().
        "users:export",
        "content:read", "content:approve", "content:reject",
        "announcements:manage",
        "finance:read", "finance:reconcile", "finance:process_withdrawals", "finance:resolve_disputes",
        "config:read", "config:update", "config:feature_toggles",
        "marketplace:approve_sellers", "marketplace:suspend_sellers",
        "marketplace:moderate_reviews", "marketplace:manage_village_market",
        "cooperatives:approve_loans", "cooperatives:approve_members",
        "wave:approve_applications", "wave:manage_training",
        "academy:approve_applications", "academy:manage_courses", "academy:manage_quizzes", "academy:issue_certificates",
        "export:approve_applications",
        "farm_nation:verify_applications",
        "land:verify_listings",
        "audit:read", "security:view_logs"
    ],

    moderator: [
        // Content moderation only
        "users:read",
        "content:read", "content:approve", "content:reject",
        "marketplace:moderate_reviews",
        "audit:read"
    ],

    support: [
        // Read-only + basic user assistance
        "users:read",
        "content:read",
        "finance:read",
        "config:read",
        "audit:read"
    ],

    wave_admin: [
        "users:read",
        "audit:read",
        "wave:approve_applications",
        "wave:manage_training"
    ],
    cooperative_admin: [
        "users:read",
        "audit:read",
        "finance:read",
        "cooperatives:approve_loans",
        "cooperatives:approve_members",
        "cooperatives:manage_products"
    ],
    marketplace_admin: [
        "users:read",
        "audit:read",
        "finance:read",
        "marketplace:approve_sellers",
        "marketplace:suspend_sellers",
        "marketplace:moderate_reviews",
        // The Village Market is marketplace's own surface, so its admin runs it.
        // NOT "users:export": the module admin gains a capability it should
        // have had and loses one it should never have had, in the same change.
        "marketplace:manage_village_market"
    ],
    export_admin: [
        "users:read",
        "audit:read",
        "export:approve_applications"
    ],
    farm_nation_admin: [
        "users:read",
        "audit:read",
        "farm_nation:verify_applications",
        "land:verify_listings"
    ],
    academy_admin: [
        "users:read",
        "audit:read",
        "academy:approve_applications",
        "academy:manage_courses",
        "academy:manage_quizzes",
        "academy:issue_certificates"
    ]
};

/**
 * Check if user has specific admin permission
 */
export function hasAdminPermission(
    userRoles: string[] | undefined,
    permission: AdminPermission
): boolean {
    if (!userRoles || userRoles.length === 0) return false;

    // Check each admin role the user has
    for (const role of userRoles) {
        if (isAdminRole(role)) {
            const permissions = PERMISSION_MATRIX[role as AdminRole];
            if (permissions.includes(permission)) {
                return true;
            }
        }
    }

    return false;
}

/**
 * Check if user has ANY admin role
 */
export function isAdmin(userRoles: string[] | undefined): boolean {
    if (!userRoles) return false;
    return userRoles.some(role =>
        role === "super_admin" ||
        role === "admin" ||
        role === "moderator" ||
        role === "support" ||
        role === "wave_admin" ||
        role === "cooperative_admin" ||
        role === "marketplace_admin" ||
        role === "export_admin" ||
        role === "farm_nation_admin" ||
        role === "academy_admin"
    );
}

/**
 * Which permission each kind of moderated content actually requires.
 *
 * WHY THIS EXISTS
 * ---------------
 * approveContentAction and rejectContentAction take a ContentType and switch
 * over SIX collections — products, land listings, the export catalogue,
 * courses, certificates and resources — under a single `isAdmin()` gate.
 *
 * isAdmin() is true for EVERY admin role, so one gate made no distinction
 * between them. Each module's admin could act on every other module's content:
 * an academy_admin could mark a land listing VERIFIED, a wave_admin could
 * publish an export listing, a farm_nation_admin could issue an academy
 * certificate. All six module-admin roles are in ALL_USER_ROLES, so all six are
 * grantable and this was reachable. The matrix already denies each of them;
 * nothing asked it.
 *
 * SCOPE, STATED HONESTLY: `support` and `moderator` appear in PERMISSION_MATRIX
 * and in isAdmin(), but in no role type and no UI list — bulk-user-operations.ts
 * records that, and validating against ALL_USER_ROLES closed the one path that
 * could grant them. So the "a read-only support user could approve things"
 * reading of this defect is NOT reachable today. The cross-module escalation
 * between the six module admins is the live half.
 *
 * That was the only thing missing. hasAdminPermission is used at seventy-odd
 * other call sites, so this is one gate that skipped the machinery rather than
 * machinery that was never built.
 */
export const CONTENT_TYPE_PERMISSION = {
    products: "content:approve",
    land: "land:verify_listings",
    export: "export:approve_applications",
    courses: "academy:manage_courses",
    certificates: "academy:issue_certificates",
    resources: "academy:manage_courses",
} as const satisfies Record<string, AdminPermission>;

export type ModeratedContentType = keyof typeof CONTENT_TYPE_PERMISSION;

/**
 * The permission needed to approve or reject this kind of content.
 *
 * An unrecognised type returns null, and callers must refuse on null rather
 * than falling back to a generic check — an unknown content type is exactly
 * where a new collection would slip past the matrix.
 */
export function permissionForContentType(type: string): AdminPermission | null {
    // Object.hasOwn, not a bare index: `type` arrives from the caller, and a
    // plain lookup walks the prototype chain — permissionForContentType(
    // "constructor") returned Object.prototype.constructor, a truthy value that
    // is not a permission. It failed closed (hasAdminPermission never matches a
    // function) but it reached the matrix at all, which is one step further
    // than a caller-supplied string should get.
    if (!Object.hasOwn(CONTENT_TYPE_PERMISSION, type)) return null;
    return (CONTENT_TYPE_PERMISSION as Record<string, AdminPermission>)[type];
}

/**
 * Check if user is super admin
 */
export function isSuperAdmin(userRoles: string[] | undefined): boolean {
    return userRoles?.includes("super_admin") ?? false;
}

/**
 * Roles that only a super_admin may grant.
 *
 * DERIVED, BECAUSE A HAND-WRITTEN LIST WENT STALE
 * ----------------------------------------------
 * This was `["admin", "super_admin"]`, written when those were the only roles
 * that could do anything a plain admin could not. Six module-admin roles were
 * added to PERMISSION_MATRIX afterwards and the list was not revisited, so
 * `cooperative_admin` — which holds "cooperatives:manage_products", a
 * permission the matrix deliberately withholds from `admin` — became grantable
 * by any admin. An admin could assign it to themselves and hold a permission
 * the matrix gives only to super_admin and cooperative_admin.
 *
 * That particular escalation is latent rather than live: nothing in the
 * codebase checks "cooperatives:manage_products" today, so the permission
 * currently gates nothing. It stops being latent the moment somebody writes the
 * check, and a guard that is correct only because the thing it protects is
 * unused is not a guard.
 *
 * So the rule is computed instead of listed: a role is privileged if it can do
 * anything a plain `admin` cannot. Add a permission to any module-admin role
 * and that role becomes super_admin-only to grant, without anyone remembering
 * to come back here.
 *
 * "admin" and "super_admin" are unioned in explicitly. They are privileged by
 * definition rather than by holding a surplus permission, and `admin` compared
 * against itself has a surplus of nothing.
 */
export const PRIVILEGED_ROLES: readonly string[] = (() => {
    const adminPerms = new Set<AdminPermission>(PERMISSION_MATRIX.admin);
    const beyondAdmin = (Object.keys(PERMISSION_MATRIX) as AdminRole[]).filter((role) =>
        (PERMISSION_MATRIX[role] ?? []).some((p) => !adminPerms.has(p))
    );
    return Array.from(new Set<string>(["admin", "super_admin", ...beyondAdmin]));
})();

/**
 * Which roles hold a permission — the inverse of the matrix lookup.
 *
 * WHY THIS EXISTS
 * ---------------
 * Deciding WHO to tell about work is the same question as deciding who may do
 * it, and the two were answered from different places. wallet.ts notified
 * `cooperative_admin` and `super_admin` about a pending withdrawal, while the
 * action that processes one requires "finance:process_withdrawals" — held by
 * `super_admin` and `admin`. Every cooperative_admin was sent to a screen that
 * would refuse them, and no plain admin was told at all.
 *
 * A hand-written audience beside a matrix-derived gate is the same drift as a
 * hand-written role list beside a matrix-derived permission, and it fails in
 * the direction nobody notices: the work simply does not get done.
 */
export function rolesWithPermission(permission: AdminPermission): AdminRole[] {
    return (Object.keys(PERMISSION_MATRIX) as AdminRole[]).filter((role) =>
        (PERMISSION_MATRIX[role] ?? []).includes(permission)
    );
}

/**
 * Does this set of roles include one that only a super_admin may hand out?
 *
 * WHY THIS EXISTS
 * ---------------
 * PERMISSION_MATRIX gives `admin` the "users:assign_roles" permission and
 * withholds "users:delete", "users:impersonate" and "config:rollback" — the
 * entry says so in as many words: "no deletion, no impersonation, no config
 * rollback". Both role-writing endpoints then accepted whatever role list they
 * were handed:
 *
 *   bulkAssignRolesAction   refused rolesToRemove containing admin/super_admin
 *                           and placed no restriction at all on rolesToAdd
 *   updateUserRolesAction   wrote the array wholesale; its only check was that
 *                           you were not removing your OWN admin rights, which
 *                           adding a role never does
 *
 * So any admin could call either one on their own id and come back a
 * super_admin, collecting exactly the permissions the matrix was written to
 * withhold. The boundary was described everywhere and enforced nowhere.
 *
 * Both call sites route through here so the rule has one definition rather than
 * two that can drift apart.
 *
 * The set it consults is derived from the matrix — see PRIVILEGED_ROLES.
 */
export function includesPrivilegedRole(roles: string[] | undefined): boolean {
    if (!roles) return false;
    return roles.some((r) => PRIVILEGED_ROLES.includes(r));
}

/**
 * Get highest admin role user has
 */
export function getHighestAdminRole(userRoles: string[] | undefined): AdminRole | null {
    if (!userRoles) return null;

    if (userRoles.includes("super_admin")) return "super_admin";
    if (userRoles.includes("admin")) return "admin";
    if (userRoles.includes("moderator")) return "moderator";
    if (userRoles.includes("support")) return "support";
    
    // Module admins
    const moduleAdmin = userRoles.find(r => r.endsWith("_admin") && r !== "super_admin");
    if (moduleAdmin) return moduleAdmin as AdminRole;

    return null;
}

/**
 * Get all permissions for user's highest admin role
 */
export function getUserAdminPermissions(userRoles: string[] | undefined): AdminPermission[] {
    const highestRole = getHighestAdminRole(userRoles);
    if (!highestRole) return [];

    return PERMISSION_MATRIX[highestRole];
}

/**
 * Type guard for admin roles
 */
function isAdminRole(role: string): role is AdminRole {
    return ["super_admin", "admin", "moderator", "support", "wave_admin", "cooperative_admin", "marketplace_admin", "export_admin", "farm_nation_admin", "academy_admin"].includes(role);
}

/**
 * Assert user has permission (throws if not)
 * Use this in server actions for clean error handling
 */
export function requireAdminPermission(
    userRoles: string[] | undefined,
    permission: AdminPermission,
    errorMessage?: string
): void {
    if (!hasAdminPermission(userRoles, permission)) {
        throw new Error(
            errorMessage || `Insufficient permissions. Required: ${permission}`
        );
    }
}

/**
 * Check if user can access admin route based on role
 */
export function canAccessAdminRoute(
    userRoles: string[] | undefined,
    route: string
): boolean {
    // Super admins have universal access to all admin routes
    if (isSuperAdmin(userRoles)) {
        return true;
    }

    // Super admin routes (only super_admin)
    const superAdminOnlyRoutes = [
        "/admin/users/delete",
        "/admin/feature-toggles/rollback",
        "/admin/config/rollback"
    ];

    if (superAdminOnlyRoutes.some(r => route.startsWith(r))) {
        return isSuperAdmin(userRoles);
    }

    // Moderator-accessible routes
    const moderatorRoutes = [
        "/admin/content-approval",
        "/admin/marketplace/reviews"
    ];

    if (moderatorRoutes.some(r => route.startsWith(r))) {
        // Special case: marketplace_admin can see reviews
        if (route.startsWith("/admin/marketplace/reviews") && userRoles?.includes("marketplace_admin")) return true;
        
        // Otherwise require core admin/moderator roles
        return userRoles?.some(r => r === "super_admin" || r === "admin" || r === "moderator") ?? false;
    }

    // Support-accessible routes (read-only admin pages)
    const supportRoutes = [
        "/admin/analytics",
        "/admin/audit-logs"
    ];

    if (supportRoutes.some(r => route.startsWith(r))) {
        // Strictly block module admins from these global pages
        return userRoles?.some(r => r === "super_admin" || r === "admin" || r === "support") ?? false;
    }

    // ── Module Admin Route Isolation ──
    const isWaveAdmin = userRoles?.includes("wave_admin");
    const isCoopAdmin = userRoles?.includes("cooperative_admin");
    const isMktAdmin = userRoles?.includes("marketplace_admin");
    const isExportAdmin = userRoles?.includes("export_admin");
    const isFarmAdmin = userRoles?.includes("farm_nation_admin");
    const isAcadAdmin = userRoles?.includes("academy_admin");

    const isModuleAdmin = isWaveAdmin || isCoopAdmin || isMktAdmin || isExportAdmin || isFarmAdmin || isAcadAdmin;

    // Strict Silo Isolation: If a user has a module admin role, they are locked to that silo,
    // UNLESS they are also granted super_admin or admin rights (global admin roles).
    const isGlobalAdmin = userRoles?.includes("admin") || userRoles?.includes("super_admin");
    if (isModuleAdmin && !isGlobalAdmin) {
        // Module admins have access to their own silos, user management, support, and settings
        // NOTE: They are explicitly BLOCKED from the base /admin and /admin/dashboard to remove them from sidebar
        if (route.startsWith("/admin/users")) return true;
        if (route.startsWith("/admin/messages")) return true; // Support Inbox
        if (route.startsWith("/admin/support")) return true;  // Legacy support path
        if (route.startsWith("/admin/settings")) return true;
        
        // Silo isolation
        if (isWaveAdmin && route.startsWith("/admin/wave")) return true;
        if (isCoopAdmin && route.startsWith("/admin/cooperatives")) return true;
        if (isMktAdmin && route.startsWith("/admin/marketplace")) return true;
        if (isExportAdmin && route.startsWith("/admin/export")) return true;
        if (isFarmAdmin && route.startsWith("/admin/farm-nation")) return true;
        if (isAcadAdmin && route.startsWith("/admin/academy")) return true;
        
        // Allow access to base dashboard so they don't think the system is broken
        if (route === "/admin" || route === "/admin/dashboard") return true;
        
        return false; // Strictly block from Analytics, Audit Logs, and Content Approval
    }

    // Default: require admin or super_admin for all other /admin routes
    return userRoles?.some(r => r === "admin" || r === "super_admin") ?? false;
}
