/**
 * Whether a cooperative member may move money. One answer.
 *
 * FIVE DOORS, THREE ANSWERS
 * -------------------------
 * The same question — may this member transact? — was asked five times and
 * answered three ways:
 *
 *   /api/cooperative/apply-loan          membershipStatus !== "active"  → refuse
 *   /api/cooperative/withdraw            membershipStatus !== "active"  → refuse
 *   /api/cooperative/create-fixed-savings   not ("approved" or "active") → refuse
 *   _coop_money submitWithdrawalAction   membershipStatus !== "active"  → refuse
 *   _coop_money _createFixedSavingsAction   NO STATUS CHECK AT ALL
 *   _coop_money _applyForLoanAction         NO STATUS CHECK AT ALL
 *
 * Both halves of that are wrong.
 *
 * "APPROVED" IS NOT A LESSER STATUS
 * ---------------------------------
 * It is the legacy spelling of the same state, and the rest of the codebase
 * says so plainly. The member directory queries
 * `where("membershipStatus", "in", ["approved", "active"])` under the comment
 * 'Query both "active" (canonical since May 2026) and "approved" (legacy
 * status) — both are fully approved members'. The admin member list does the
 * same. updateMemberStatusAction accepts either and grants the
 * cooperative_member role for both. The ID-card reader treats both as issued.
 *
 * So a legacy member sitting at "approved" appeared in the directory, held the
 * role, carried an ID card — and was refused when they tried to withdraw their
 * own savings or apply for a loan, by two doors of five. Nothing said why.
 *
 * AND TWO DOORS ASKED NOTHING
 * ---------------------------
 * The two server actions checked only that a membership row existed. A member
 * still at "pending" — registered, not yet paid, onboarding incomplete — could
 * file a loan application and lock savings into a fixed plan through them,
 * while the routes doing the same work refused. The loan path is bounded by the
 * savings-multiple eligibility check, but the fixed-savings one is not: a
 * pending member whose contribution had landed could lock it away.
 *
 * "suspended" is deliberately absent. Suspension now revokes the
 * cooperative_member role as well, so a suspended member is refused by the
 * module guard and by this — the two agree rather than one covering for the
 * other.
 */

/** The statuses in which a member may transact. */
export const COOPERATIVE_TRANSACTING_STATUSES = ["active", "approved"] as const;

export type CooperativeTransactingStatus = (typeof COOPERATIVE_TRANSACTING_STATUSES)[number];

/**
 * True when this membership document may move money.
 *
 * `membershipStatus` is preferred over `status`, which some legacy rows carry
 * instead — the ID-card reader already reads both, and a member is not refused
 * because of which field their row happens to use.
 */
export function canTransactAsMember(
    member: Record<string, unknown> | null | undefined,
): boolean {
    if (!member) return false;
    const raw = String(member.membershipStatus ?? member.status ?? "").trim().toLowerCase();
    return (COOPERATIVE_TRANSACTING_STATUSES as readonly string[]).includes(raw);
}

/**
 * What a refused member is told.
 *
 * One sentence for all five doors: they were each phrased differently ("You are
 * not an active cooperative member", "Your membership must be approved first",
 * "Only active cooperative members can apply for loans"), which reads to a
 * member as five different problems rather than one.
 */
export const NOT_A_TRANSACTING_MEMBER_MESSAGE =
    "Your cooperative membership must be active before you can do this.";
