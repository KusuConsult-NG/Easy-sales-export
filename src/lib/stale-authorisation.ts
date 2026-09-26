import type { AdminPermission } from "@/lib/admin-permissions";

/**
 * Which admin doors must re-read the database, and which may trust the token.
 *
 *   #951 SEVENTY-FIVE DOORS DECIDE AUTHORISATION FROM THE JWT ALONE, AND FOUR
 *   SEPARATE FINDINGS HAVE EACH CONVERTED "THE NEXT BOUNDED SET" BY A CRITERION
 *   INVENTED AT THE TIME.
 *
 *   #356 established the cost: a JWT role claim "keeps its value for hours after
 *   the database loses it", which is why requireAdmin exists and re-reads roles
 *   live on every call. Then:
 *
 *     #532   the three files that disagreed with THEMSELVES — one function on the
 *            live gate, another in the same file still on the token
 *     #748   the four doors money leaves by
 *     #750   the two role-writing files, converted WHOLE
 *     #932   two of the ten unreached API routes: the company's live bank
 *            balance, and the sender of money-owed emails to members
 *
 *   Each pick was sound and each was ad hoc. What was missing is a rule, so that
 *   the seventy-sixth door is decided by a principle rather than by whoever next
 *   chooses a bounded set — and so that a count of 75 becomes a prioritised list
 *   instead of an undifferentiated backlog.
 *
 * ── THE RULE: IRREVERSIBILITY ───────────────────────────────────────────────
 *
 *   A door must re-read the database when acting on stale authorisation produces
 *   an effect that REVOKING THE ADMIN CANNOT UNDO.
 *
 *   That is the whole of it, and it explains three of the four picks above
 *   without being fitted to them. Money paid out does not come back. A role
 *   granted outlives the granter's own revocation. A bank balance cannot be
 *   un-seen; an email cannot be unsent.
 *
 *   The converse is the half worth stating, because this audit has spent ten
 *   findings REDUCING read depth (#283 through #289): where a later admin can
 *   simply undo the act, an eight-hour window of stale access costs a reversible
 *   edit, and a database read on every request to prevent it is a real cost paid
 *   against a small one. A suspended seller is un-suspended. A wrongly approved
 *   land listing is rejected. A course edited badly is edited back.
 *
 *   #532's criterion is NOT subsumed by this and stays live: a file that asks the
 *   database in one function and the token in another is wrong whichever side of
 *   this rule it falls on, and the-role-writers-asked-the-token holds that
 *   separately.
 *
 * ── WHAT THIS RULE IS A PROXY FOR, SAID PLAINLY ─────────────────────────────
 *
 *   The classification below is per PERMISSION, because a permission is
 *   exhaustive, checkable, and already the platform's own statement of what a
 *   door is for. It is a proxy for the real question, which is what the DOOR
 *   does, and the proxy is wrong in one direction today:
 *
 *     api/qr/verify gates on `academy:issue_certificates` and issues nothing —
 *     it is a POST that verifies a scanned QR code and writes an audit entry.
 *     api/certificates/download gates on the same permission to READ one
 *     certificate. Both are marked must-re-read by a permission naming an
 *     irreversible act neither performs.
 *
 *   Reclassifying the permission would be the wrong repair: it would make every
 *   genuine issuing door reversible to fix two doors that are mislabelled. So the
 *   permission decides, an exception is written down with its reason, and the list
 *   is asserted to stay short.
 *
 *   I GOT THIS WRONG FIRST, and the correction is worth keeping. The draft listed
 *   api/certificates/[id] as a third read exception. It exports only DELETE, and
 *   that DELETE destroys a certificate record — the most irreversible thing on
 *   that surface. The permission is right for it; what is unusual is its SHAPE,
 *   which the third list below is for.
 */

/**
 * Permissions whose effect a later revocation cannot undo.
 *
 * Every one of the 43 in AdminPermission is classified — in this set or in the
 * reversible set below — so a NEW permission cannot be added without a decision.
 * one-rule-for-a-stale-token asserts the two sets together are exactly the
 * matrix, which is what makes that true rather than aspirational.
 */
export const IRREVERSIBLE_PERMISSIONS: readonly AdminPermission[] = [
    //   MONEY LEAVES, OR A DEBT IS CREATED. #748's four doors were picked on
    //   exactly this and it is the least arguable line on the list.
    "finance:process_withdrawals",
    "finance:refund",
    "finance:reconcile",
    //   Releases escrow, which is money moving between two members.
    "finance:resolve_disputes",
    //   Creates a debt and increments loanBalance. #748 converted ONE loan door,
    //   api/admin/cooperative/approve-loan, and left eleven siblings on the
    //   token — including reject-loan, in the same directory, deciding the same
    //   loan, and verify-guarantor, which is the step that makes a loan
    //   approvable at all.
    "cooperatives:approve_loans",

    //   ACCESS THAT OUTLIVES THE GRANTER'S OWN REVOCATION. This is the
    //   compounding case and the reason it is not merely "one more irreversible
    //   act": a revoked admin who can still write roles can grant fresh access
    //   to themselves or to somebody else, and that grant survives the
    //   revocation that was supposed to have stopped them. #750 converted
    //   admin/_users.ts and bulk-user-operations.ts whole for this reason.
    "users:assign_roles",
    "users:create",
    "users:update",
    "users:impersonate",
    "users:delete",
    //   Can turn a second factor off. The rollout in #936/#937 is what makes
    //   this a live concern rather than a theoretical one.
    "security:manage_mfa",

    //   CANNOT BE UN-SEEN. A revocation removes future access; it does not
    //   retrieve what has already been read or exported.
    "users:export",
    //   Reads rows a member asked to have erased — #b04bc9b5's finding is that
    //   the erasure is partial, which makes this access more sensitive, not less.
    "users:read_erased",
    //   The company's live bank balance. #932 converted
    //   api/admin/finance/paystack-balance on this reading.
    "finance:read",
    "security:view_logs",
    //   The audit trail is the record of what every other admin did. All ten
    //   roles hold these, so converting a door here refuses nobody who is still
    //   an admin — and a revoked one is revoked from all ten.
    "audit:read",
    "audit:export",

    //   CANNOT BE UNSENT, OR DESTROYS. #202 already settled that a demoted admin
    //   must not reach every member; #932 converted the money-owed email sender.
    "announcements:manage",
    "content:approve",
    //   The owner's standing instruction is that nothing is deleted or
    //   destroyed, which makes a destructive act on a stale token the worst case
    //   on this list rather than a routine one.
    "content:delete",

    //   A CREDENTIAL SOMEBODY SHOWS A THIRD PARTY. Revoking the issuer does not
    //   recall the certificate a learner has already put in front of an employer.
    "academy:issue_certificates",

    //   CHANGES WHAT EVERY LATER CHARGE IS COMPUTED FROM. An exchange rate or a
    //   fee written on a stale token is not undone by fixing it afterwards: the
    //   charges taken in between were real.
    "config:update",
    "config:rollback",
    "config:feature_toggles",
];

/**
 * Permissions whose effect a later admin can simply undo.
 *
 * Listed rather than inferred as "the rest", so that adding a permission to
 * AdminPermission forces a decision instead of defaulting to the cheaper answer.
 */
export const REVERSIBLE_PERMISSIONS: readonly AdminPermission[] = [
    //   Reads that carry no member PII out of the platform.
    "users:read",
    "content:read",
    "content:reject",
    "config:read",
    //   Reversible, and fail-safe in the direction that matters: suspending is
    //   the cautious act, and un-suspending is one click for the next admin.
    "users:suspend",

    //   EDITORIAL AND QUEUE WORK. Each of these is undone by doing the opposite,
    //   and the module admin who runs the queue runs it all day — a database read
    //   on every request is the cost this audit spent #283–#289 removing.
    "academy:manage_courses",
    "academy:manage_quizzes",
    "academy:approve_applications",
    "wave:manage_training",
    "wave:approve_applications",
    "export:approve_applications",
    "land:verify_listings",
    "farm_nation:verify_applications",
    "cooperatives:approve_members",
    "cooperatives:manage_products",
    "marketplace:approve_sellers",
    "marketplace:suspend_sellers",
    "marketplace:moderate_reviews",
    "marketplace:manage_village_market",
];

/**
 * Must a door gating on this permission re-read the database?
 *
 * Throws on an unclassified permission rather than defaulting. A default in
 * either direction is how the seventy-sixth door gets decided by accident: false
 * would quietly admit a new money permission to the token, and true would
 * quietly put a database read on a new editorial queue.
 */
export function mustRevalidateLive(permission: AdminPermission): boolean {
    if (IRREVERSIBLE_PERMISSIONS.includes(permission)) return true;
    if (REVERSIBLE_PERMISSIONS.includes(permission)) return false;

    throw new Error(
        `stale-authorisation: "${permission}" is not classified. Decide whether `
        + `acting on a stale token here produces an effect that revoking the admin `
        + `cannot undo, then add it to IRREVERSIBLE_PERMISSIONS or to `
        + `REVERSIBLE_PERMISSIONS with the reason.`,
    );
}

/**
 * Doors the permission classifies one way and their actual effect classifies the
 * other, each with why it is left as it is.
 *
 * An exception list is a liability, so it is short, it is asserted to BE short,
 * and every entry names what would retire it.
 */
export const CLASSIFICATION_EXCEPTIONS: ReadonlyArray<{
    readonly file: string;
    readonly permission: AdminPermission;
    readonly why: string;
}> = [
    {
        file: "src/app/api/qr/verify/route.ts",
        permission: "academy:issue_certificates",
        why: "A POST that verifies a scanned QR code and writes an audit entry. It "
            + "issues nothing, so the irreversible effect the permission names is not "
            + "what this door does. Retired by giving it a verification permission of "
            + "its own, which is a matrix change rather than a gate change.",
    },
    {
        file: "src/app/api/certificates/download/route.ts",
        permission: "academy:issue_certificates",
        why: "Reads one certificate, and the admin permission is the FALLBACK branch "
            + "of an owner-or-admin check — the learner reading their own certificate "
            + "never reaches it. Retired the same way as qr/verify.",
    },
];

/**
 * Doors whose SHAPE decides how to convert them, not whether.
 *
 *   `data.userId !== session.user.id && !hasAdminPermission(...)` is an
 *   owner-or-admin check: the admin branch is a fallback for acting on somebody
 *   else's row. Converting it to a bare `await requireAdmin(...)` would put a
 *   database read in front of every MEMBER acting on their own row — the cost
 *   #283 through #289 spent ten findings removing — and would refuse them
 *   outright, since they are not admins at all.
 *
 *   So the conversion has to re-validate on the non-owner branch only. That is a
 *   per-site edit, not a substitution, which is why these are recorded rather
 *   than swept: the same reason #532 gave for stopping where it did.
 */
export const OWNER_OR_ADMIN_SHAPE: ReadonlyArray<{
    readonly file: string;
    readonly permission: AdminPermission;
    readonly why: string;
}> = [
    {
        file: "src/app/api/certificates/[id]/route.ts",
        permission: "academy:issue_certificates",
        why: "Exports only DELETE, and it destroys a certificate record — a learner "
            + "may delete their own, an admin may delete anybody's. Irreversible, so "
            + "the permission is right; the admin branch is what needs the live read.",
    },
    {
        file: "src/app/actions/loan-actions.ts",
        permission: "cooperatives:approve_loans",
        why: "getLoanApplicationAction admits the applicant OR an admin. Two more "
            + "gates in the same file are admin-only and convert plainly, which is "
            + "why this file is a per-site read rather than a substitution.",
    },
];
