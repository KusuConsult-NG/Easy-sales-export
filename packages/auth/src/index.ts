/**
 * @easy-sales/auth
 *
 * Shared authentication & authorization utilities.
 * Contains RBAC permission helpers, session utilities, and role constants.
 *
 * Wraps the existing lib/admin-permissions and lib/session-guard modules.
 * In Phase 2, this package will be consumed by all domain apps.
 */

// Permission utilities
export { hasAdminPermission, isAdmin } from "./permissions";

// Session utilities
export { requireSession } from "./session";

// ─── Role constants & types (inlined from @easy-sales/types/roles) ────────────
// Inlined to avoid cross-package imports that fail in the Docker build environment.

export type UserRole =
    | "general_user"
    | "buyer"
    | "marketplace_buyer"
    | "seller"
    | "land_owner"
    | "farmer"
    | "investor"
    | "export_participant"
    | "cooperative_member"
    | "wave_participant"
    | "academy_participant"
    | "field_officer"
    | "cooperative_admin"
    | "academy_admin"
    | "wave_admin"
    | "marketplace_admin"
    | "farm_nation_admin"
    | "export_admin"
    | "admin"
    | "super_admin";

/** @deprecated Use UserRole instead */
export type LegacyRole = "member" | "exporter" | "admin" | "vendor" | "super_admin";

export const LEGACY_ROLE_MAP: Record<LegacyRole, UserRole> = {
    member: "general_user",
    exporter: "export_participant",
    admin: "admin",
    vendor: "seller",
    super_admin: "super_admin",
};

export const ROLE_LABELS: Record<UserRole, string> = {
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
