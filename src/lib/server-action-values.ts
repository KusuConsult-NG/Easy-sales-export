/**
 * Values that server actions share, and that a `"use server"` file may not hold.
 *
 *   #382 A CONSTANT EXPORTED FROM A SERVER-ACTION MODULE FAILED THE BUILD.
 *
 *        `npm run build` stopped with:
 *
 *            Failed to collect page data for /api/id-card/pdf
 *              A "use server" file can only export async functions, found string.
 *              at src/app/actions/cooperative/_coop_money.ts
 *
 *        Every export of a `"use server"` module is REGISTERED AS A SERVER
 *        ACTION — that is the whole point of the directive, and it is why an
 *        unwired exported action is still a live endpoint (the reasoning #374
 *        and #379 both turned on). Registration requires a function. A string,
 *        an array or an object exported alongside the actions is not one, and
 *        Next refuses the module rather than registering something it cannot
 *        call.
 *
 *        THE SUITE COULD NOT HAVE CAUGHT THIS. Jest resolves modules; it never
 *        applies the server-action transform, so all three offenders imported
 *        and executed perfectly in every test while the application would not
 *        compile. Only a build sees it, and until #382 nothing in this
 *        repository ran one. `npm run verify` now does.
 *
 *        The three values live here instead. Each is still exported from its
 *        original module — re-exporting a value is not an action export, so it
 *        is legal and nothing that imported it has to change.
 */

/** What an admin may decide about an export booking. */
export const EXPORT_BOOKING_DECISIONS = ["confirmed", "cancelled"] as const;
export type ExportBookingDecision = (typeof EXPORT_BOOKING_DECISIONS)[number];

/**
 * The datasets an admin CSV export may name (#309).
 *
 * The recorder rejects anything not on this list, so the list and the screens
 * that call it cannot drift apart.
 */
export const EXPORTABLE_DATASETS = [
    "academy_applications",
    "audit_logs",
    "cooperative_loans",
    "cooperative_transactions",
    "export_applications",
    "farm_nation_applications",
    "farm_nation_land_verification",
    "finance_report",
    "marketplace_buyers",
    "marketplace_sellers",
    "wave_applications",
    "wave_compliance",
    "wave_members",
    "wave_registrations",
] as const;
export type ExportableDataset = (typeof EXPORTABLE_DATASETS)[number];

/**
 * Why a contribution made from the cooperative dashboard modal is refused
 * (#333).
 *
 * Stated once so the refusal an admin reads in a log and the sentence a member
 * reads on screen are the same sentence.
 */
export const UNPAID_CONTRIBUTION_MESSAGE =
    "Contributions must be paid for. Please use the Contribute page so your "
    + "payment can be verified before your savings are credited.";
