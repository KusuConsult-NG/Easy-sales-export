/**
 * The roles each module's own flows GRANT — and therefore the roles its
 * REJECTION must take back.
 *
 * WHY THIS EXISTS
 * ---------------
 * checkModuleAccess grants module access from EITHER signal: Layer 1 is the JWT
 * role on its own, Layer 2 the serviceRegistrations status, Layer 2.5 the roles
 * array in the database. So revoking one without the other revokes nothing —
 * the role alone still opens the module.
 *
 * That was found once already, on the cooperative suspend path, whose fix note
 * reads: "a suspended member kept the dashboard, contributions, loans,
 * withdrawals and the member directory. An admin pressing Suspend achieved
 * nothing except a different word on the admin's own screen."
 *
 * A MAP RATHER THAN FIVE LITERALS
 * -------------------------------
 * So that "which roles does rejecting this module take back" has one answer, and
 * a module added here without a rejection that uses it is a test failure rather
 * than a discovery two years later. No imports, so anything may use it.
 *
 *   #763 IT WAS A MAP OF ONE ROLE EACH, AND TWO MODULES GRANT MORE THAN ONE —
 *        OR GRANT ONE AND REVOKED NONE.
 *
 *   The previous version of this header stated, as the reason `farm-nation`
 *   mapped to `farmer` alone:
 *
 *       "Farm Nation reads `land_owner` and `investor` as well, and neither is
 *        granted by its application flow — revoking those on a seller rejection
 *        would take away a capability this decision is not about."
 *
 *   MEASURED, THAT IS FALSE FOR `investor`. _submitFarmNationOnboardingAction
 *   pushes it for `role: "buyer"` and for `role: "both"` — two of its three
 *   choices — and the rejection took back only `farmer`:
 *
 *       role at submit   roles granted        after rejection   module access
 *       buyer            investor             investor          TRUE
 *       seller           farmer               —                 false
 *       both             investor, farmer     investor          TRUE
 *
 *   So rejecting a Farm Nation BUYER revoked nothing at all, and rejecting a
 *   BOTH applicant revoked half. Only the one case the map happened to name
 *   worked.
 *
 *   `land_owner` is NOT here, and that part of the old reasoning stands: no
 *   Farm Nation flow grants it, and it is the capability to list land rather
 *   than the module registration this decision is about.
 *
 *   AND EXPORT GRANTED A ROLE AND REVOKED NOTHING. The ratchet in
 *   module-rejection-revokes-access.test.ts excused it in a comment — "Export
 *   has no rejection path today; it is named here so that adding one does not
 *   silently escape the check" — and rejectExportApplicationAction has existed
 *   in admin/_exports.ts all along. An approved export member who was then
 *   rejected kept `export_participant` and kept the module; only the word on
 *   the admin's screen changed. That is the same sentence the cooperative fix
 *   note wrote, about a different module, three findings apart.
 *
 *   PLURAL, so the shape of the map cannot mislead about a module that grants
 *   two. A single-role module is a list of one.
 */
export const MODULE_GRANT_ROLES = {
    wave: ["wave_participant"],
    academy: ["academy_participant"],
    cooperatives: ["cooperative_member"],
    //   Both roles _submitFarmNationOnboardingAction grants, from the same
    //   buyer/seller/both choice. `land_owner` is deliberately absent — see
    //   the header.
    "farm-nation": ["farmer", "investor"],
    export: ["export_participant"],
} as const;

export type GrantedModule = keyof typeof MODULE_GRANT_ROLES;

/**
 * The roles to revoke when a module decision goes against the applicant.
 *
 * Spread into arrayRemove: `FieldValue.arrayRemove(...moduleGrantRoles("x"))`.
 * Removing a role the member never held is a no-op, so a seller-only Farm
 * Nation applicant is unaffected by `investor` appearing in the list.
 */
export function moduleGrantRoles(module: GrantedModule): string[] {
    return [...MODULE_GRANT_ROLES[module]];
}
