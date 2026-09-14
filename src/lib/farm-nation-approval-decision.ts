/**
 * An approval with nothing behind it, and what an admin may do about it.
 *
 *   #725 THE SECOND FINDING THE FORENSIC REPORT COULD ONLY DESCRIBE.
 *
 *   The Farm Nation check reports two things that look alike and are not:
 *
 *     DRIFT               the user's registration and the application
 *                         DISAGREE. #486: "an approval landed by halves", and
 *                         it leaves a member approved on one screen and pending
 *                         on another.
 *
 *     NO APPLICATION      the user is marked approved and no application is
 *                         findable under ANY key the product uses — userId, the
 *                         applicationId on the user record, legacy_<uid>, then
 *                         the address.
 *
 *   Neither can be settled unattended, and the reason is worth stating because
 *   it is what makes this different from every automated repair in this audit:
 *
 *       "The two available moves are to fabricate an application so the checker
 *        stops reporting it, or to revoke 45 people's approvals. The first makes
 *        the record lie; the second takes something away from members who may
 *        well be entitled to it."
 *
 * ── THERE IS A THIRD MOVE, AND IT IS THE HONEST ONE ─────────────────────────
 *
 *   An admin can look at a member and VOUCH for the approval. Recording that —
 *   who confirmed it, when, and why — is a true statement about something that
 *   actually happened. It is not a fabricated application, and this module is
 *   careful never to write one: no row is created in FARM_NATION_APPLICATIONS
 *   by any decision here.
 *
 *   So the three decisions are:
 *
 *     confirm    an admin vouches. The approval stands and the record now says
 *                on what basis, which is the thing that was missing.
 *     revoke     the approval should not have been granted. The registration
 *                moves to `revoked` and the PREVIOUS status is kept beside it,
 *                so the decision is reversible and the history is not erased.
 *     reconcile  drift only. One side is authoritative and the other is brought
 *                to match it, recorded as an admin decision rather than
 *                back-dated into looking like it was always so.
 *
 *   None of them deletes anything. That is the standing rule on this audit and
 *   it is the whole reason `revoke` writes a status rather than removing a
 *   registration.
 */

/** What the scan found about one farmer. */
export type ApprovalIssue =
    /** Registration says approved; no application under any key. */
    | "no-application"
    /** Registration and application disagree. */
    | "drift";

export type ApprovalDecision = "confirm" | "revoke" | "reconcile";

export interface FarmerCase {
    userId: string;
    fullName: string;
    maskedEmail: string;
    issue: ApprovalIssue;
    /** serviceRegistrations.farmNation.status, as stored. */
    userStatus: string | null;
    /** The statuses of every application found, in the order found. */
    applicationStatuses: string[];
    /** Which key the application was found under, when one was. */
    foundVia: string | null;
    /** Set once an admin has vouched — this is what clears the finding. */
    confirmedBy: string | null;
    confirmedAt: string | null;
    confirmedReason: string | null;
    /** True when a decision has already been recorded for this member. */
    settled: boolean;
}

/**
 * Which decisions make sense for this case.
 *
 * SEPARATED FROM THE I/O so the rule can be tested directly, and so the screen
 * and the server cannot offer different options — the server re-derives this
 * and refuses anything not in it.
 */
export function decisionsFor(issue: ApprovalIssue): ApprovalDecision[] {
    //   `reconcile` is meaningless without two records to reconcile, and
    //   `confirm` on drift would leave the two records still disagreeing while
    //   claiming the case was handled. Each issue gets only what can actually
    //   settle it.
    return issue === "drift" ? ["reconcile", "revoke"] : ["confirm", "revoke"];
}

export interface DecisionCheck {
    issue: ApprovalIssue;
    decision: string;
    reason: string;
    /** For `reconcile`: which record the admin says is right. */
    authoritative?: string;
}

/**
 * May this decision be applied?
 *
 * Every rule here is about refusing a write that cannot be explained later. The
 * screen can be wrong and the request can be edited, so the answer is
 * re-derived from the case the server just read.
 */
export function checkDecision(
    input: DecisionCheck,
): { ok: true } | { ok: false; reason: string } {
    const allowed = decisionsFor(input.issue);

    if (!allowed.includes(input.decision as ApprovalDecision)) {
        return {
            ok: false,
            reason: `"${input.decision}" cannot settle a ${input.issue} case. `
                + `Available: ${allowed.join(", ")}.`,
        };
    }

    if (input.reason.trim().length < 8) {
        /*
         *   A REASON IS REQUIRED AND THE BAR IS HIGHER THAN #724's.
         *
         *   Confirming an approval with no application behind it IS the record.
         *   There is nothing else to point at afterwards — no form, no
         *   submission, no payment trail — so the admin's sentence is the only
         *   evidence the approval was ever examined. "ok" is not evidence.
         */
        return {
            ok: false,
            reason: "Say why, in a sentence. On these cases your note is the only record of the basis.",
        };
    }

    if (input.decision === "reconcile") {
        if (input.authoritative !== "user" && input.authoritative !== "application") {
            return {
                ok: false,
                reason: "Say which record is right: the user's registration, or the application.",
            };
        }
    }

    return { ok: true };
}

/**
 * What one decision writes onto the user's Farm Nation registration.
 *
 * RETURNED AS A PATCH RATHER THAN APPLIED, so the shape is testable without a
 * database and so the caller — which is the only thing holding the admin's
 * identity — supplies it once.
 *
 * NOTHING HERE CREATES AN APPLICATION. Confirming records that an admin
 * vouched; it does not invent the form that was never submitted.
 */
export function approvalPatch(args: {
    decision: ApprovalDecision;
    reason: string;
    adminId: string;
    /** The status the registration holds now, kept so a revoke is reversible. */
    previousStatus: string | null;
    /** For `reconcile`: the status the authoritative record carries. */
    reconcileTo?: string | null;
}): Record<string, unknown> {
    const { decision, reason, adminId, previousStatus, reconcileTo } = args;

    const common = {
        "serviceRegistrations.farmNation.reviewDecision": decision,
        "serviceRegistrations.farmNation.reviewDecisionBy": adminId,
        "serviceRegistrations.farmNation.reviewDecisionReason": reason,
        //   The status BEFORE this decision, on every branch. It is what makes
        //   a revoke undoable and what lets somebody later see what was
        //   changed, rather than only what it was changed to.
        "serviceRegistrations.farmNation.statusBeforeReview": previousStatus,
    };

    if (decision === "confirm") {
        //   The status is NOT rewritten — it is already "approved" and the
        //   finding was never that the status was wrong. What was missing is
        //   the basis, and that is what this adds.
        return {
            ...common,
            "serviceRegistrations.farmNation.approvalBasis": "admin_confirmed_without_application",
        };
    }

    if (decision === "revoke") {
        return {
            ...common,
            //   `revoked`, not a delete and not back to `pending`. Pending would
            //   put the member into a queue they never applied to, and a delete
            //   would lose the fact that they were once approved — which is the
            //   part somebody investigating this will need.
            "serviceRegistrations.farmNation.status": "revoked",
        };
    }

    return {
        ...common,
        //   Reconcile brings the user's registration to the authoritative
        //   status. When the APPLICATION is authoritative this changes the
        //   user; when the USER is, the caller updates the application instead
        //   and this patch only records the decision.
        ...(reconcileTo ? { "serviceRegistrations.farmNation.status": reconcileTo } : {}),
    };
}

/**
 * Is this case settled?
 *
 * A member carrying a recorded decision is no longer an unexplained approval —
 * it is an approval somebody examined and vouched for, which is a different
 * state and belongs in a different count.
 *
 * THIS IS NOT THE SAME AS HIDING IT. The forensic check still reports these
 * rows; it reports them as confirmed rather than as unexplained, and the total
 * that has nobody's name against it is the one that goes down. A tool whose
 * effect on the report was to make a number disappear would be the defect this
 * audit exists to find.
 */
export function isSettled(registration: Record<string, unknown> | null | undefined): boolean {
    const r = registration ?? {};
    const decision = r.reviewDecision;
    return typeof decision === "string" && decision.trim() !== "";
}
