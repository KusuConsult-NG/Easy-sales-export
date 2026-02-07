/**
 * User Role Type Definitions
 * 
 * Defines all user roles in the Easy Sales Export platform
 * with support for multi-role assignment per user.
 */

export type UserRole =
    | "general_user"        // Basic platform access
    | "buyer"              // Can purchase from marketplace
    | "seller"             // Can sell on marketplace  
    | "land_owner"         // Owns land for farming
    | "farmer"             // Farm operator
    | "investor"           // Investment opportunities
    | "export_participant" // Participates in exports
    | "cooperative_member" // Cooperative savings member
    | "wave_participant"   // WAVE program (female only)
    | "field_officer"      // Verifies applications/data
    | "admin"              // System administration
    | "super_admin";       // Full system control

/**
 * Legacy role type for backward compatibility
 * @deprecated Use UserRole instead
 */
export type LegacyRole = "member" | "exporter" | "admin" | "vendor" | "super_admin";

/**
 * Maps legacy roles to new role system
 */
export const LEGACY_ROLE_MAP: Record<LegacyRole, UserRole> = {
    member: "general_user",
    exporter: "export_participant",
    admin: "admin",
    vendor: "seller",
    super_admin: "super_admin",
};

/**
 * Role hierarchy for permission inheritance
 * Higher roles inherit permissions from lower roles
 */
export const ROLE_HIERARCHY: Record<UserRole, number> = {
    general_user: 1,
    buyer: 2,
    seller: 2,
    land_owner: 2,
    farmer: 2,
    investor: 2,
    export_participant: 3,
    cooperative_member: 3,
    wave_participant: 3,
    field_officer: 4,
    admin: 5,
    super_admin: 6,
};

/**
 * Role display names for UI
 */
export const ROLE_LABELS: Record<UserRole, string> = {
    general_user: "General User",
    buyer: "Buyer",
    seller: "Seller",
    land_owner: "Land Owner",
    farmer: "Farmer / Farm Operator",
    investor: "Investor",
    export_participant: "Export Participant",
    cooperative_member: "Cooperative Member",
    wave_participant: "WAVE Participant",
    field_officer: "Field Officer / Verifier",
    admin: "Administrator",
    super_admin: "Super Administrator",
};

/**
 * Roles that require gender validation
 */
export const GENDER_RESTRICTED_ROLES: Partial<Record<UserRole, "male" | "female">> = {
    wave_participant: "female", // WAVE is female-only
};

/**
 * Check if a role requires gender validation
 */
export function requiresGenderValidation(role: UserRole): boolean {
    return role in GENDER_RESTRICTED_ROLES;
}

/**
 * Validate if user's gender is compatible with role
 */
export function isGenderCompatible(role: UserRole, userGender?: "male" | "female"): boolean {
    const requiredGender = GENDER_RESTRICTED_ROLES[role];
    if (!requiredGender) return true; // No restriction
    return userGender === requiredGender;
}
