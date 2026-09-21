/**
 * Deciding which of somebody's records is the person — and recording it
 * WITHOUT DESTROYING THE OTHERS.
 *
 *   #724 THE FORENSIC REPORT NAMED A DECISION NOBODY HAD A WAY TO MAKE.
 *
 *   The duplicate-profile scan has reported the same finding for weeks, and
 *   said plainly why it does nothing about it:
 *
 *       "Nothing here merges or deletes them: which of somebody's records is
 *        the person is not a decision code should make unattended."
 *
 *   That is right, and it left the owner with a number and no next step. This
 *   is the next step: the decision stays theirs, and everything around it —
 *   gathering the evidence, ranking the candidates, applying the answer safely,
 *   recording who decided — is done for them.
 *
 * ── NOTHING IS DELETED, AND NOTHING NEEDS TO BE ─────────────────────────────
 *
 *   The platform already has a way to say "this row has been superseded", and
 *   every reader already honours it:
 *
 *       lib/profile-choice.ts    the LOGIN ranks a row carrying `_migratedTo`
 *                                below every other candidate (#490)
 *       lib/user-identity.ts     resolveActiveUser WALKS `_migratedTo`, then
 *                                `supabaseAuthId`, to the live row — and every
 *                                money path uses it (#449)
 *
 *   So resolving a duplicate is one additive write per superseded row. No
 *   document is removed, no field is cleared, and no data moves between rows.
 *   The superseded records keep everything they hold and simply stop being
 *   mistaken for the person.
 *
 *   That also makes it REVERSIBLE, which matters more here than anywhere else
 *   in this audit: if the owner picks wrong, clearing the pointer puts the
 *   group back exactly as it was. A merge-and-delete tool could not offer that
 *   and would have been the obvious thing to build.
 *
 * ── AND MOST OF THE THIRTY-THREE ARE NOT DECISIONS AT ALL ───────────────────
 *
 *   The scan's own text says so: "TWO IS NORMAL for anyone migrated from the
 *   old system — the original is kept and tombstoned, never deleted." A pair
 *   where the legacy row already points at the live one is RESOLVED, and
 *   presenting it for a decision would be asking the owner to re-confirm the
 *   migration's own work thirty times.
 *
 *   Groups are classified before anything is shown, so the list the owner works
 *   through is the list that genuinely needs a person.
 */

import { registrationWeight } from "@/lib/profile-choice";
import { supersedingPointer } from "@/lib/user-identity";

/** One profile in a group, with the evidence a person needs to choose. */
export interface DuplicateCandidate {
    id: string;
    /** Where this row already points, if anywhere. */
    migratedTo: string | null;
    supabaseAuthId: string | null;
    roles: string[];
    /** Services with a status that is not "not_started" — what the row carries. */
    registrations: number;
    profileComplete: boolean;
    createdAt: string | null;
    fullName: string;
    /** True when this row is the one every existing reader would already pick. */
    recommended: boolean;
    /**
     * Naira sitting in the wallet filed under exactly this id — #806.
     *
     * Shown because it DECIDES the group. Superseding a funded row strands the
     * money, so the operator needs the figure before they choose, not after the
     * server refuses them. Zero for the overwhelming majority: 272 superseded
     * profiles carry a wallet row and every one was measured at zero.
     */
    walletBalance: number;
}

export type GroupState =
    /** Exactly one live row and every other points at it. Nothing to decide. */
    | "resolved"
    /** No row points anywhere — the person has two or more rival records. */
    | "needs-a-decision"
    /**
     * Pointers exist and disagree: two live rows, or a row pointing somewhere
     * outside the group, or a cycle. Shown apart because "pick one" is not the
     * whole answer.
     */
    | "inconsistent";

export interface DuplicateGroup {
    /** Masked, because this list is as likely to be screenshotted as a report (#490). */
    maskedEmail: string;
    /** The raw address, needed to act on the group and never rendered. */
    email: string;
    candidates: DuplicateCandidate[];
    state: GroupState;
    /** Why it is in that state, in words an operator can act on. */
    explanation: string;
}

const asRecord = (v: unknown): Record<string, unknown> =>
    (v && typeof v === "object" ? v : {}) as Record<string, unknown>;

function str(v: unknown): string | null {
    return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

/**
 * Where this row points, or null when it points nowhere.
 *
 *   #802 A ROW POINTING AT ITSELF POINTS NOWHERE, AND THIS FILE WAS THE ONE
 *        PLACE ON THE PLATFORM THAT DID NOT KNOW IT.
 *
 *        resolveActiveUser — the walk every money path and every session goes
 *        through — stops on a self-pointer and calls that row LIVE:
 *
 *            const next = pointerOf(row);
 *            if (!next || next === id) { ... stoppedBecause: "no-pointer" }
 *
 *        _wallet_consolidation restates it when it looks for superseded rows
 *        ("A row pointing at ITSELF is not superseded"), and checkResolution
 *        below already allows such a row to be kept. classifyGroup did not:
 *        it put every `_migratedTo` into the pointer map, so a self-pointing
 *        row was never counted among the live ones.
 *
 *        WHAT THAT DID TO THE WORKLIST, counted on production: of 496 groups,
 *        3 needed a decision, 340 were settled and 153 were reported as
 *        "Look at this one" — and the self-pointer shape `{A → A, B → A}`
 *        recurs the whole way down that third list. It is an ordinary settled
 *        migration whose live row happens to name itself; with no row left
 *        unpointed the `live.length === 0` branch fired, so the screen called
 *        it "a cycle that needs a person to break it" and printed the live
 *        record as `superseded → <its own id>`.
 *
 *        How many of the 153 this moves is deliberately not asserted here: the
 *        screen lists groups rather than tallying them by shape, and the split
 *        is only visible on a re-read. Nor does it move them all one way —
 *        `{A → A, B → B}` is two rival live records and becomes work that was
 *        never shown as work.
 *
 *        Worse than the noise: on a group with SOME self-pointers the screen
 *        named the wrong live row. For one five-record address the only row
 *        this file counted as live carried ONE registration, while the row the
 *        platform actually hands the person carries THREE and points at itself.
 *        An operator following the screen would have superseded the record the
 *        login prefers.
 *
 *        The forensic scan classifies through this same function (#736, so the
 *        two cannot disagree), so it counted all 153 as unsettled duplicates.
 *        One rule, one fix, both reports.
 */
function pointerFrom(id: string, data: Record<string, unknown>): string | null {
    //   #804 — the rule itself now lives in user-identity, beside the walk that
    //   has always applied it. Three modules had grown their own copy; this is
    //   the one that reads `_migratedTo` alone, deliberately (see above).
    return supersedingPointer(id, data._migratedTo);
}

function createdAtIso(v: unknown): string | null {
    const raw = asRecord(v).createdAt;
    if (!raw) return null;
    const d = typeof (raw as any)?.toDate === "function" ? (raw as any).toDate()
        : raw instanceof Date ? raw
        : new Date(raw as any);
    return d instanceof Date && Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

/**
 * Rank the rows of a group, best first.
 *
 * DELIBERATELY THE SAME ORDER THE LOGIN USES — registrations, then a complete
 * profile, then roles, then the oldest — so the recommendation cannot disagree
 * with the row the platform would actually hand somebody. A tool that
 * recommended one record while the login preferred another would be worse than
 * no tool.
 *
 * The supersession rule is NOT applied here. profile-choice ranks a superseded
 * row last because it is answering "who just logged in"; this is answering
 * "which row should the others point at", and in an `inconsistent` group an
 * existing pointer is the thing under review rather than a fact to defer to.
 */
export function rankCandidates(rows: { id: string; data: Record<string, unknown> }[]): string[] {
    return [...rows]
        .sort((a, b) => {
            const regs = registrationWeight(b.data) - registrationWeight(a.data);
            if (regs !== 0) return regs;

            const complete = (b.data.profileComplete === true ? 1 : 0)
                - (a.data.profileComplete === true ? 1 : 0);
            if (complete !== 0) return complete;

            const roles = (Array.isArray(b.data.roles) ? (b.data.roles as unknown[]).length : 0)
                - (Array.isArray(a.data.roles) ? (a.data.roles as unknown[]).length : 0);
            if (roles !== 0) return roles;

            const ta = createdAtIso(a.data);
            const tb = createdAtIso(b.data);
            if (ta !== tb) {
                if (ta === null) return 1;
                if (tb === null) return -1;
                return ta < tb ? -1 : 1;
            }

            //   A TOTAL order. Two rows that tie on every rule must still sort
            //   deterministically, or the "recommended" row changes between two
            //   reads of the same data and the screen looks unreliable.
            return a.id < b.id ? -1 : 1;
        })
        .map((r) => r.id);
}

/**
 * What state one group of same-address profiles is in.
 *
 * Separated from the I/O so the rule can be tested directly — the part worth
 * proving is the classification, and a classifier that can only be exercised
 * against a database is one nobody re-tests after changing it.
 */
export function classifyGroup(
    rows: { id: string; data: Record<string, unknown> }[],
): { state: GroupState; explanation: string } {
    const ids = new Set(rows.map((r) => r.id));
    const pointers = new Map<string, string>();
    for (const r of rows) {
        const to = pointerFrom(r.id, r.data);
        if (to) pointers.set(r.id, to);
    }

    const live = rows.filter((r) => !pointers.has(r.id));

    if (pointers.size === 0) {
        return {
            state: "needs-a-decision",
            explanation: `${rows.length} records share this address and none points at another. `
                + `Choose the one that is the person; the rest are marked as superseded and keep `
                + `everything they hold.`,
        };
    }

    const pointsOutside = [...pointers.values()].filter((to) => !ids.has(to));
    if (pointsOutside.length > 0) {
        return {
            state: "inconsistent",
            explanation: `A record here points at ${pointsOutside[0]}, which is not one of these `
                + `${rows.length}. That is a migration chain leaving this address — follow it before `
                + `deciding anything here.`,
        };
    }

    if (live.length === 1 && pointers.size === rows.length - 1) {
        const everyPointerAgrees = [...pointers.values()].every((to) => to === live[0].id);
        if (everyPointerAgrees) {
            return {
                state: "resolved",
                explanation: `Already settled: ${pointers.size} superseded record(s) point at `
                    + `${live[0].id}. This is what a normal migration leaves behind — nothing to do.`,
            };
        }
        return {
            state: "inconsistent",
            explanation: `One live record, but the superseded ones do not all point at it. `
                + `Re-pointing them at the same row will settle it.`,
        };
    }

    if (live.length === 0) {
        return {
            state: "inconsistent",
            explanation: `Every record here points at another one, so none of them is the live row. `
                + `That is a cycle and needs a person to break it.`,
        };
    }

    return {
        state: "inconsistent",
        explanation: `${live.length} records are live and ${pointers.size} are superseded. `
            + `Choose which of the live ones is the person.`,
    };
}

/** The full view of one group, ready for a screen. */
export function describeGroup(
    email: string,
    maskedEmail: string,
    rows: { id: string; data: Record<string, unknown> }[],
    /**
     *   #806 — balances by id, read by the caller.
     *
     *   A PARAMETER RATHER THAN A READ, because this function is pure and
     *   synchronous and every other value on a candidate is derivable from the
     *   rows it was handed. Defaulting to zero is safe in the one direction
     *   that matters: a caller that does not supply balances cannot be shown a
     *   figure that is wrong, only one that is absent — and the SERVER's
     *   refusal reads the wallets itself rather than trusting this.
     */
    balances: Record<string, number> = {},
): DuplicateGroup {
    const ranked = rankCandidates(rows);
    const best = ranked[0];

    const candidates: DuplicateCandidate[] = ranked.map((id) => {
        const row = rows.find((r) => r.id === id)!;
        const d = row.data;
        return {
            id,
            migratedTo: pointerFrom(id, d),
            supabaseAuthId: str(d.supabaseAuthId),
            roles: Array.isArray(d.roles) ? (d.roles as unknown[]).map(String) : [],
            registrations: registrationWeight(d),
            profileComplete: d.profileComplete === true,
            createdAt: createdAtIso(d),
            fullName: str(d.fullName)
                ?? [str(d.firstName), str(d.lastName)].filter(Boolean).join(" ")
                ?? "",
            recommended: id === best,
            walletBalance: balances[id] ?? 0,
        };
    });

    const { state, explanation } = classifyGroup(rows);
    return { email, maskedEmail, candidates, state, explanation };
}

/**
 * Is this a decision the tool may apply?
 *
 * EVERY RULE HERE EXISTS TO STOP A WRITE THAT CANNOT BE UNDONE BY CLEARING ONE
 * FIELD. The screen can be wrong, the request can be replayed, and the ids can
 * be edited by hand in a request — so the answer is re-derived from the group
 * the server just read, never from what the caller sent.
 */
export function checkResolution(args: {
    group: DuplicateGroup;
    keepId: string;
    supersedeIds: string[];
}): { ok: true } | { ok: false; reason: string } {
    const { group, keepId, supersedeIds } = args;
    const ids = new Set(group.candidates.map((c) => c.id));

    if (!ids.has(keepId)) {
        return { ok: false, reason: "The record to keep is not one of this address's profiles." };
    }
    if (supersedeIds.length === 0) {
        return { ok: false, reason: "Nothing was selected to supersede." };
    }
    if (supersedeIds.includes(keepId)) {
        return { ok: false, reason: "A record cannot supersede itself." };
    }
    for (const id of supersedeIds) {
        if (!ids.has(id)) {
            return { ok: false, reason: `${id} is not one of this address's profiles.` };
        }
    }

    //   A KEEPER THAT POINTS SOMEWHERE ELSE IS NOT A KEEPER. Pointing rows at
    //   it would build a chain through a tombstone, and resolveActiveUser would
    //   walk straight past the row the operator chose.
    const keeper = group.candidates.find((c) => c.id === keepId)!;
    if (keeper.migratedTo && keeper.migratedTo !== keepId) {
        return {
            ok: false,
            reason: `That record is itself superseded — it points at ${keeper.migratedTo}. `
                + `Choose the live record, or clear its pointer first.`,
        };
    }

    return { ok: true };
}
