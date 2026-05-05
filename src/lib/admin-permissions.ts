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

    // Content Management
    | "content:read"
    | "content:approve"
    | "content:reject"
    | "content:delete"
    | "announcements:manage"

    // Financial Operations
    | "finance:read"
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
        "users:suspend", "users:assign_roles", "users:impersonate",
        "content:read", "content:approve", "content:reject", "content:delete",
        "announcements:manage",
        "finance:read", "finance:process_withdrawals", "finance:refund",
        "finance:resolve_disputes",
        "config:read", "config:update", "config:feature_toggles", "config:rollback",
        "marketplace:approve_sellers", "marketplace:suspend_sellers",
        "marketplace:moderate_reviews",
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
        "users:read", "users:update", "users:suspend", "users:assign_roles",
        "content:read", "content:approve", "content:reject",
        "announcements:manage",
        "finance:read", "finance:process_withdrawals", "finance:resolve_disputes",
        "config:read", "config:update", "config:feature_toggles",
        "marketplace:approve_sellers", "marketplace:suspend_sellers",
        "marketplace:moderate_reviews",
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
        "wave:approve_applications",
        "wave:manage_training"
    ],
    cooperative_admin: [
        "users:read",
        "cooperatives:approve_loans",
        "cooperatives:approve_members",
        "cooperatives:manage_products"
    ],
    marketplace_admin: [
        "users:read",
        "finance:read",
        "marketplace:approve_sellers",
        "marketplace:suspend_sellers",
        "marketplace:moderate_reviews"
    ],
    export_admin: [
        "users:read",
        "export:approve_applications"
    ],
    farm_nation_admin: [
        "users:read",
        "farm_nation:verify_applications",
        "land:verify_listings"
    ],
    academy_admin: [
        "users:read",
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
        role.endsWith("_admin")
    );
}

/**
 * Check if user is super admin
 */
export function isSuperAdmin(userRoles: string[] | undefined): boolean {
    return userRoles?.includes("super_admin") ?? false;
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
        return isAdmin(userRoles); // Any admin role
    }

    // Support-accessible routes (read-only admin pages)
    const supportRoutes = [
        "/admin/analytics",
        "/admin/audit-logs"
    ];

    if (supportRoutes.some(r => route.startsWith(r))) {
        return isAdmin(userRoles); // Any admin role
    }

    // ── Module Admin Route Isolation ──
    const isWaveAdmin = userRoles?.includes("wave_admin");
    const isCoopAdmin = userRoles?.includes("cooperative_admin");
    const isMktAdmin = userRoles?.includes("marketplace_admin");
    const isExportAdmin = userRoles?.includes("export_admin");
    const isFarmAdmin = userRoles?.includes("farm_nation_admin");
    const isAcadAdmin = userRoles?.includes("academy_admin");

    const isModuleAdmin = isWaveAdmin || isCoopAdmin || isMktAdmin || isExportAdmin || isFarmAdmin || isAcadAdmin;

    if (isModuleAdmin && !isSuperAdmin(userRoles) && !userRoles?.includes("admin")) {
        // Module admins can only access their specific module and basic dashboard
        if (route === "/admin" || route === "/admin/dashboard") return true;
        
        if (isWaveAdmin && route.startsWith("/admin/wave")) return true;
        if (isCoopAdmin && route.startsWith("/admin/cooperatives")) return true;
        if (isMktAdmin && route.startsWith("/admin/marketplace")) return true;
        if (isExportAdmin && route.startsWith("/admin/export")) return true;
        if (isFarmAdmin && route.startsWith("/admin/farm-nation")) return true;
        if (isAcadAdmin && route.startsWith("/admin/academy")) return true;
        
        return false; // Lock them out of everything else!
    }

    // Default: require admin or super_admin for all other /admin routes
    return userRoles?.some(r => r === "admin" || r === "super_admin") ?? false;
}
