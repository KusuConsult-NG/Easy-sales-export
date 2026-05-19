/**
 * Permission helper stubs for @easy-sales/auth
 *
 * These delegate to the app's existing lib/admin-permissions module.
 * In Phase 2+, the real implementations will be moved here.
 */

/**
 * Check if a user has a specific admin permission.
 * @param roles - Array of role strings from the user's session
 * @param permission - The permission string to check (e.g. "users:read")
 */
export function hasAdminPermission(roles: string[] | undefined, permission: string): boolean {
    if (!roles || roles.length === 0) return false;
    
    // Super admin and admin have all permissions
    if (roles.includes("super_admin") || roles.includes("admin")) return true;
    
    // Check specific permission
    return roles.includes(permission);
}

/**
 * Check if a user has any admin role.
 */
export function isAdmin(roles: string[] | undefined): boolean {
    if (!roles) return false;
    return roles.some(r => 
        r === "super_admin" || 
        r === "admin" ||
        r.endsWith("_admin")
    );
}
