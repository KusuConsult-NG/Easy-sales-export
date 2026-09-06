/**
 * Legacy role spellings, and the canonical role each one means.
 *
 *   #458 A HOLDER OF THE LEGACY `superadmin` ROLE WAS SENT TO THE ADMIN PORTAL
 *   BY LOGIN AND BOUNCED STRAIGHT BACK OUT OF IT.
 *
 *   The stored spelling `superadmin`, without the underscore, is honoured in
 *   exactly one file. actions/auth.ts treats it as a global admin twice — once
 *   to decide the user has an admin role at all, once to decide they land on
 *   the main dashboard rather than a module silo:
 *
 *       return r === 'superadmin' || r.includes('admin_dashboard');
 *       ...
 *       || roleStrings.includes('superadmin')
 *
 *   Nothing else knows the spelling. isAdmin() in role-utils lists the eight
 *   canonical admin roles and not this one; PERMISSION_MATRIX has no entry for
 *   it; app/admin/page.tsx computes `isGlobalAdmin` by hand from "super_admin"
 *   and "admin". So the round trip is:
 *
 *       login          -> hasAdminRole true, isGlobalAdmin true -> /admin
 *       /admin         -> isGlobalAdmin false, no module role   -> /dashboard
 *       any admin call -> requireAdmin -> isAdmin false -> "Unauthorized"
 *
 *   Login promises the admin portal and the admin portal refuses. #356 kept
 *   this spelling alive in auth.ts on the stated grounds that "dropping it here
 *   would strand whoever holds it" — and they were stranded anyway, one hop
 *   later, by a redirect that had never heard of it.
 *
 *   ONE PLACE NOW. An alias is resolved to its canonical role here, and every
 *   predicate that judges roles resolves first, so a legacy spelling cannot
 *   mean "admin" to one reader and "nobody" to the next. The hand-written
 *   clauses in auth.ts are removed rather than kept beside this, because two
 *   statements of one rule is the defect, not the cure.
 *
 *   THIS WIDENS NOTHING FOR ADMIN ACCESS. `superadmin` is a spelling of
 *   `super_admin`, not a lesser role being held back: the login flow already
 *   treats it as full global admin, and the only reason the rest of the
 *   platform did not was that it had never been told. Refusing a typo is not an
 *   access control.
 *
 *   AND THERE WERE ALREADY TWO LEGACY VOCABULARIES WITH TWO RESOLVERS, NEITHER
 *   AWARE OF THE OTHER. role-app-mapping.ts carries a private `normaliseRoles`
 *   that resolves LEGACY_ROLE_MAP — member, exporter, vendor — while nothing in
 *   role-utils or admin-permissions resolved anything at all. So a `vendor`
 *   could reach the seller app and simultaneously fail
 *   `hasRole(roles, "seller")`. Adding a THIRD table for `superadmin` beside
 *   those two would have been the defect, not the cure, so both are merged
 *   here and role-app-mapping delegates to this one.
 *
 *   That merge does change what role-utils and admin-permissions answer for
 *   `member`, `exporter` and `vendor`. It changes it TO what role-app-mapping
 *   already believed, and none of those three is an admin role — the two
 *   LEGACY_ROLE_MAP entries that are (`admin`, `super_admin`) map to
 *   themselves.
 */

import { LEGACY_ROLE_MAP } from "./types/roles";

/**
 * Legacy spelling -> canonical role.
 *
 * Keys are compared lower-cased and trimmed, so `SuperAdmin` and ` superadmin `
 * resolve too — stored role data on this platform has been hand-edited, and a
 * case difference should not decide whether somebody can administer it.
 */
export const ROLE_ALIASES: Readonly<Record<string, string>> = {
    /**
     * The pre-migration role names. These already had a resolver — a private
     * `normaliseRoles` inside role-app-mapping.ts — which is why a `vendor`
     * could reach the seller app while `hasRole(roles, "seller")` said no.
     * ONE table, so the answer cannot depend on which module is asking.
     */
    ...LEGACY_ROLE_MAP,

    /**
     * And the spelling only actions/auth.ts knew, which is this finding. No
     * speculative entries beside it: every alias here grants whatever the
     * canonical role grants, so a guessed spelling is a guessed grant.
     */
    superadmin: 'super_admin',
};

/** Resolve one role to its canonical spelling. Unknown roles pass through. */
export function canonicalRole<T extends string>(role: T): T {
    if (typeof role !== 'string') return role;
    return (ROLE_ALIASES[role.trim().toLowerCase()] ?? role) as T;
}

/**
 * Resolve a list of roles, dropping nothing.
 *
 * Returns the SAME ARRAY when there is nothing to resolve — which is the
 * overwhelmingly common case — so putting this at the top of a hot predicate
 * costs an identity check and no allocation.
 */
export function canonicalRoles<T extends string>(roles: readonly T[] | undefined): T[] {
    if (!roles || roles.length === 0) return (roles as T[]) ?? [];

    let changed = false;
    const out = roles.map((role) => {
        const canonical = canonicalRole(role);
        if (canonical !== role) changed = true;
        return canonical;
    });

    return changed ? out : (roles as T[]);
}
