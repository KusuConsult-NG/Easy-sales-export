/**
 * User Role Type Definitions
 * 
 * Defines all user roles in the Easy Sales Export platform
 * with support for multi-role assignment per user.
 */

export type UserRole =
    | "general_user"        // Basic platform access
    | "buyer"              // Can purchase from marketplace
    | "marketplace_buyer"  // Can purchase from marketplace (new standardized role)
    | "seller"             // Can sell on marketplace  
    | "marketplace_seller" // Can sell on marketplace (new standardized role)
    | "land_owner"         // Owns land for farming
    | "farmer"             // Farm operator
    | "investor"           // Investment opportunities
    | "export_participant" // Participates in exports
    | "cooperative_member" // Cooperative savings member
    | "wave_participant"   // WAVE program (female only)
    | "academy_participant" // Academy learning platform
    | "field_officer"      // Verifies applications/data
    | "cooperative_admin" // Manages the cooperative module
    | "academy_admin"     // Manages the academy module
    | "wave_admin"        // Manages the WAVE module
    | "marketplace_admin" // Manages the marketplace module
    | "farm_nation_admin" // Manages the farm nation module
    | "export_admin"      // Manages the export module
    | "admin"              // System administration
    | "super_admin";       // Full system control

/**
 * Every role in UserRole, as a value.
 *
 * WHY THIS EXISTS
 * ---------------
 * "What is a valid role?" had six answers in this codebase and no two agreed:
 *
 *   UserRole (this file)                21 roles, including six module admins
 *   add-roles VALID_ROLES               13 — no module admins at all, while its
 *                                       own doc comment says "Regular admins can
 *                                       assign module-level roles (e.g.
 *                                       cooperative_admin, wave_admin)"
 *   schemas.ts UserRoleSchema           14 — has marketplace_buyer, not
 *                                       marketplace_seller
 *   write-guard.ts VALID_ROLES          19 — including "user", "academy_student",
 *                                       "wave_member", "farm_nation_member" and
 *                                       "exporter", none of which are roles
 *   PERMISSION_MATRIX                   10 — including "moderator" and "support",
 *                                       which appear in NO other list
 *   bulkAssignRolesAction               no list; any string was accepted
 *
 * The combination that mattered: isAdmin() honours "moderator" and "support",
 * 32 admin routes are gated on isAdmin(), and the only path that could write
 * those strings was the one with no validation. So a role conferring full admin
 * access could be granted while appearing in no type, no schema and no UI —
 * admin access that nothing lists as admin access.
 *
 * This array is the value form of the type. The `satisfies` below fails
 * compilation if a role is added to UserRole and not here.
 */
export const ALL_USER_ROLES = [
    "general_user",
    "buyer",
    "marketplace_buyer",
    "seller",
    "marketplace_seller",
    "land_owner",
    "farmer",
    "investor",
    "export_participant",
    "cooperative_member",
    "wave_participant",
    "academy_participant",
    "field_officer",
    "cooperative_admin",
    "academy_admin",
    "wave_admin",
    "marketplace_admin",
    "farm_nation_admin",
    "export_admin",
    "admin",
    "super_admin",
] as const satisfies readonly UserRole[];

/**
 * Compile-time exhaustiveness: if UserRole gains a member that ALL_USER_ROLES
 * does not list, this assignment stops type-checking.
 *
 * `satisfies` above proves every entry IS a UserRole. This proves every UserRole
 * IS an entry. Both directions are needed — a list can be wrong by omission as
 * easily as by addition, and omission is how add-roles lost the six module
 * admins.
 */
const _everyRoleIsListed: Record<UserRole, true> = Object.fromEntries(
    ALL_USER_ROLES.map((r) => [r, true])
) as Record<UserRole, true>;
void _everyRoleIsListed;

/** Is this arbitrary string one of the platform's roles? */
export function isUserRole(value: unknown): value is UserRole {
    return typeof value === "string" && (ALL_USER_ROLES as readonly string[]).includes(value);
}

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
    marketplace_buyer: 2,
    seller: 2,
    marketplace_seller: 2,
    land_owner: 2,
    farmer: 2,
    investor: 2,
    export_participant: 3,
    cooperative_member: 3,
    wave_participant: 3,
    academy_participant: 3,
    field_officer: 4,
    cooperative_admin: 5,
    academy_admin: 5,
    wave_admin: 5,
    marketplace_admin: 5,
    farm_nation_admin: 5,
    export_admin: 5,
    admin: 5,
    super_admin: 6,
};

/**
 * Role display names for UI
 */
export const ROLE_LABELS: Record<UserRole, string> = {
    general_user: "General User",
    buyer: "Buyer",
    marketplace_buyer: "Marketplace Buyer",
    seller: "Seller",
    marketplace_seller: "Marketplace Seller",
    land_owner: "Land Owner",
    farmer: "Farmer / Farm Operator",
    investor: "Investor",
    export_participant: "Export Participant",
    cooperative_member: "Cooperative Member",
    wave_participant: "WAVE Participant",
    academy_participant: "Academy Participant",
    field_officer: "Field Officer / Verifier",
    cooperative_admin: "Cooperative Administrator",
    academy_admin: "Academy Administrator",
    wave_admin: "WAVE Administrator",
    marketplace_admin: "Marketplace Administrator",
    farm_nation_admin: "Farm Nation Administrator",
    export_admin: "Export Administrator",
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
