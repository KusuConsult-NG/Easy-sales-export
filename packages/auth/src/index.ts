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

// Role constants & types
export type { UserRole, LegacyRole } from "../../types/src/roles";
export { ROLE_LABELS, LEGACY_ROLE_MAP } from "../../types/src/roles";
