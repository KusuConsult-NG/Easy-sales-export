/**
 * Which application found by EMAIL a caller may be granted access on.
 *
 *   THE SAME CONTROL, ON THE EIGHTH DOOR. Three status actions already ask
 *   this question and answer it correctly:
 *
 *       wave/_wv_membership.ts        _checkWaveStatusAction
 *       export/_ex_onboarding.ts      _checkExportStatusAction
 *       farm-nation/_fn_onboarding.ts _checkFarmNationStatusAction
 *
 *   Each one's header records the two defects it was narrowed against, and
 *   `_ex_onboarding` names the shape out loud: "That fix landed on WAVE alone.
 *   This copy and the one in farm-nation kept both defects, which is the shape
 *   this audit keeps meeting: one control applied on two doors out of three."
 *
 *   It was two doors out of FOUR. Layers 2.8, 2.9 and 2.10 of
 *   module-access-check — the gate every module layout calls, on every page of
 *   every module — still carried both, and the gate is the worse place to carry
 *   them. A status action promotes a STATUS onto the caller's record; the gate
 *   grants the module ROLE and writes `serviceRegistrations.<app>.status:
 *   "approved"`, which Layers 2 and 2.5 above it then grant on for ever without
 *   ever reaching this code again.
 *
 * ── DEFECT 1: IT MATCHED A FIELD NOBODY AUTHENTICATED AS ────────────────────
 *
 *   When the `userEmail` query came back empty, each layer fell back to a
 *   second one — `email` on WAVE, `profile.email` on Export and Farm Nation.
 *
 *   `userEmail` is written from `session.user.email` at submission
 *   (_wv_applications.ts:399, _ex_onboarding.ts:160, _fn_onboarding.ts:231) and
 *   is therefore the address the account actually signed in as. The other two
 *   are not: `email` on a WAVE application is the OPTIONAL address on the form,
 *   spread onto the document from validatedData, and `profile.email` arrives
 *   from an import or an admin edit. Neither carries any guarantee at all.
 *
 *   So an applicant who typed somebody else's address into that optional field
 *   and was then approved handed that person the module — and the gate wrote
 *   the role to make it stick.
 *
 *   THE SECOND QUERY IS GONE, not narrowed. There is no version of "match on a
 *   field the applicant types" that is safe at a gate, and the rows it reaches
 *   are exactly the ones the app never wrote: every application submitted
 *   through this platform carries `userEmail`.
 *
 * ── DEFECT 2: IT ADOPTED APPLICATIONS THAT ALREADY HAD AN OWNER ─────────────
 *
 *   The `!appData.userId` test guarded only the backfill WRITE. The document
 *   became the answer either way, so an application belonging to a DIFFERENT
 *   user id was still read and its `approved` status still granted to the
 *   caller. Only an unclaimed application can be claimed.
 *
 *   An application whose `userId` is the caller's own cannot reach this code:
 *   the owner-scoped query above these branches asks `userId IN <every id this
 *   person owns>`, which is a superset of the caller's own id, and this
 *   fallback only runs when that came back empty.
 *
 * ── WHO LOSES ACCESS, STATED RATHER THAN HOPED ──────────────────────────────
 *
 *   A row carrying ONLY the applicant-typed address, never healed, whose owner
 *   has not yet been let in by this gate. Anybody the gate has already healed
 *   keeps their access: the grant it wrote is what Layers 2 and 2.5 read.
 *
 *   And such a person is already being told they have not applied — the three
 *   status actions stopped honouring that field before this did. The gate
 *   admitting somebody the status screen says has not applied was the
 *   inconsistency; this removes it in the direction that does not hand one
 *   member's approval to another.
 */

import { latestApplication } from "@/lib/latest-application";

/** The little of a snapshot document this rule needs. */
export interface ApplicationLike {
    data(): Record<string, any> | null | undefined;
}

export interface EmailMatchOutcome<T> {
    /** The application this caller may be granted on, or null. */
    claimable: T | null;
    /** How many matched the address but already belong to somebody else. */
    ownedByOthers: number;
}

/**
 * The newest UNCLAIMED application among `docs`, and a count of the rest.
 *
 * The count is returned rather than logged here so the caller can name its own
 * layer and collection in the warning — a line reading "3 applications match
 * this address and every one already belongs to another account" is worth
 * seeing, and worth being able to trace to the door it came from.
 *
 * Newest rather than first: these layers have always ranked by
 * `latestApplication`, and a resubmitted application is a second row. Filtering
 * by ownership must not quietly change WHICH of the survivors is chosen.
 */
export function claimableByEmail<T extends ApplicationLike>(
    docs: readonly T[] | null | undefined,
): EmailMatchOutcome<T> {
    const all = docs ?? [];

    const unclaimed = all.filter((d) => {
        const owner = d.data()?.userId;
        //   A blank string is not an owner. Rows written by an import with
        //   `userId: ""` are unclaimed, and treating them as owned would make
        //   this stricter than the three actions it is copying.
        return typeof owner !== "string" || owner.trim() === "";
    });

    return {
        claimable: latestApplication(unclaimed as T[]),
        ownedByOthers: all.length - unclaimed.length,
    };
}
