/**
 * Role Utility Functions
 * 
 * Helper functions for role-based access control (RBAC)
 */

import type { UserRole } from "./types/roles";
import { ROLE_HIERARCHY } from "./types/roles";

/**
 * Check if user has a specific role
 */
export function hasRole(userRoles: UserRole[], requiredRole: UserRole): boolean {
    return userRoles.includes(requiredRole);
}

/**
 * Check if user has ANY of the required roles
 */
export function hasAnyRole(userRoles: UserRole[], requiredRoles: UserRole[]): boolean {
    return requiredRoles.some(role => userRoles.includes(role));
}

/**
 * Check if user has ALL of the required roles
 */
export function hasAllRoles(userRoles: UserRole[], requiredRoles: UserRole[]): boolean {
    return requiredRoles.every(role => userRoles.includes(role));
}

/**
 * Check if user is an administrator (admin or super_admin)
 */
export function isAdmin(userRoles: UserRole[]): boolean {
    return hasAnyRole(userRoles, ["admin", "super_admin"]);
}

/**
 * Check if user is a super administrator
 */
export function isSuperAdmin(userRoles: UserRole[]): boolean {
    return hasRole(userRoles, "super_admin");
}

/**
 * Get highest role level from user's roles
 */
export function getHighestRoleLevel(userRoles: UserRole[]): number {
    if (userRoles.length === 0) return 0;
    return Math.max(...userRoles.map(role => ROLE_HIERARCHY[role] || 0));
}

/**
 * Check if user has sufficient role level
 */
export function hasRoleLevel(userRoles: UserRole[], requiredLevel: number): boolean {
    return getHighestRoleLevel(userRoles) >= requiredLevel;
}

/**
 * Check if user can perform an action based on role hierarchy
 */
export function canPerformAction(
    userRoles: UserRole[],
    targetUserRoles: UserRole[]
): boolean {
    // Super admins can always perform actions
    if (isSuperAdmin(userRoles)) return true;

    // User's highest role must be higher than target's highest role
    const userLevel = getHighestRoleLevel(userRoles);
    const targetLevel = getHighestRoleLevel(targetUserRoles);

    return userLevel > targetLevel;
}

/**
 * Filter roles based on user's current roles
 * (For preventing users from assigning higher roles than they have)
 */
export function getAssignableRoles(userRoles: UserRole[]): UserRole[] {
    const userLevel = getHighestRoleLevel(userRoles);

    return Object.entries(ROLE_HIERARCHY)
        .filter(([_, level]) => level <= userLevel)
        .map(([role]) => role as UserRole);
}
