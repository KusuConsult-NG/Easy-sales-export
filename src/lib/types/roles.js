"use strict";
/**
 * User Role Type Definitions
 *
 * Defines all user roles in the Easy Sales Export platform
 * with support for multi-role assignment per user.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.GENDER_RESTRICTED_ROLES = exports.ROLE_LABELS = exports.ROLE_HIERARCHY = exports.LEGACY_ROLE_MAP = void 0;
exports.requiresGenderValidation = requiresGenderValidation;
exports.isGenderCompatible = isGenderCompatible;
/**
 * Maps legacy roles to new role system
 */
exports.LEGACY_ROLE_MAP = {
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
exports.ROLE_HIERARCHY = {
    general_user: 1,
    buyer: 2,
    marketplace_buyer: 2,
    seller: 2,
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
exports.ROLE_LABELS = {
    general_user: "General User",
    buyer: "Buyer",
    marketplace_buyer: "Marketplace Buyer",
    seller: "Seller",
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
exports.GENDER_RESTRICTED_ROLES = {
    wave_participant: "female", // WAVE is female-only
};
/**
 * Check if a role requires gender validation
 */
function requiresGenderValidation(role) {
    return role in exports.GENDER_RESTRICTED_ROLES;
}
/**
 * Validate if user's gender is compatible with role
 */
function isGenderCompatible(role, userGender) {
    var requiredGender = exports.GENDER_RESTRICTED_ROLES[role];
    if (!requiredGender)
        return true; // No restriction
    return userGender === requiredGender;
}
