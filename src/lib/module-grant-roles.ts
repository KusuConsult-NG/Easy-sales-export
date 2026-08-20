/**
 * The role each module's APPROVAL grants — and therefore the role its
 * REJECTION must take back.
 *
 * WHY THIS EXISTS
 * ---------------
 * checkModuleAccess grants module access from EITHER signal: Layer 1 is the JWT
 * role on its own, Layer 2 the serviceRegistrations status. So revoking one
 * without the other revokes nothing — the role alone still opens the module.
 *
 * That was found once already, on the cooperative suspend path, whose fix note
 * reads: "a suspended member kept the dashboard, contributions, loans,
 * withdrawals and the member directory. An admin pressing Suspend achieved
 * nothing except a different word on the admin's own screen." Farm Nation's
 * seller rejection was correct for the same reason.
 *
 * WAVE and Academy were not. Both write `serviceRegistrations.<key>.status =
 * "rejected"` and leave the role in place, so a rejected applicant kept the
 * module — and, until #207, had the rejection overwritten with "approved" by
 * the login self-heal, which reads exactly that role. The fix landed on two of
 * the four modules, which is #83's shape: a correction applied where it was
 * found and not where it also applied.
 *
 * A MAP RATHER THAN FOUR LITERALS
 * -------------------------------
 * So that "which role does rejecting this module take back" has one answer, and
 * a module added here without a rejection that uses it is a test failure rather
 * than a discovery two years later. No imports, so anything may use it.
 *
 * This is the role a module's own approval GRANTS, which is a subset of the
 * roles that grant access to it (APP_TO_ROLES in module-access-check.ts holds
 * the wider set). Farm Nation reads `land_owner` and `investor` as well, and
 * neither is granted by its application flow — revoking those on a seller
 * rejection would take away a capability this decision is not about.
 */
export const MODULE_GRANT_ROLE = {
    wave: "wave_participant",
    academy: "academy_participant",
    cooperatives: "cooperative_member",
    "farm-nation": "farmer",
    export: "export_participant",
} as const;

export type GrantedModule = keyof typeof MODULE_GRANT_ROLE;

/** The role to revoke when a module decision goes against the applicant. */
export function moduleGrantRole(module: GrantedModule): string {
    return MODULE_GRANT_ROLE[module];
}
