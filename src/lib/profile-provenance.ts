/**
 *   #495 THREE THOUSAND SIX HUNDRED AND FIVE PROFILES CALL THEMSELVES VERIFIED
 *        AND NOBODY EVER VERIFIED THEM.
 *
 *   Measured on the production database, not inferred:
 *
 *       profiles                                          42,160
 *       marked verified                                   41,338   (98.1%)
 *       rows carrying `_system_skeleton_backfill: true`    3,605
 *         ...of those, marked verified                     3,605   (every one)
 *         ...whose fullName is literally "Unknown Member"  2,591
 *
 *   A representative row, in full:
 *
 *       {"uid":"9d8d77d4-…","email":"","phone":"","roles":["general_user"],
 *        "fullName":"Unknown Member","firstName":"Unknown","lastName":"Member",
 *        "verified":true,"isVerified":true,"profileComplete":true,
 *        "_system_skeleton_backfill":true}
 *
 *   No email. No phone. No name. And `verified`, `isVerified` AND
 *   `profileComplete` all true. Whatever wrote these rows on 29 May 2026 set
 *   three claims about a person it had no information about.
 *
 *   THE WRITER IS NOT IN THIS REPOSITORY. `_system_skeleton_backfill` and
 *   "Unknown Member" appear in no file, in no commit, on no branch — checked
 *   with `git log -S` across all of them. It ran from somewhere else, so its
 *   intent cannot be read from source, only from what it left.
 *
 * ── WHY THE FLAG IS NOT EVIDENCE ────────────────────────────────────────────
 *
 *   `isVerified` is supposed to mean a human decided something. On these rows
 *   it means a loop set a boolean. The distinction is invisible in storage —
 *   `true` looks the same either way — which is exactly why it has to be made
 *   here rather than at each of the places that read it.
 *
 *   It applies to ALL 3,605, not only the 2,591 anonymous ones. The thousand
 *   that carry a name got it from the same unattended run; a name makes the row
 *   more useful, it does not make the claim evidenced.
 *
 * ── WHAT THIS DELIBERATELY DOES NOT DO ──────────────────────────────────────
 *
 *   IT DOES NOT DELETE, CLEAR OR REWRITE ONE FIELD. Every row keeps
 *   `isVerified: true` exactly as stored. This module changes what the
 *   application CONCLUDES from that byte, and nothing else. The rows are
 *   evidence of what the backfill did and they stay that way.
 *
 *   IT DOES NOT HIDE THEM. A count that quietly drops 3,605 rows is the same
 *   defect facing the other way. `unevidenced` is a state an admin can filter
 *   to and look at, because somebody has to decide what these accounts are and
 *   they cannot decide about rows they cannot find.
 *
 * ── THE OTHER HALF: THE 34k COMMENT WAS FALSE ───────────────────────────────
 *
 *   admin/_users.ts carried this, and it shaped the query:
 *
 *       "Do NOT filter isVerified via Firestore query — 34k+ legacy users have
 *        `verified: true` but NOT `isVerified`."
 *
 *   Measured: rows with `verified: true` and no `isVerified` — ZERO. 41,362 of
 *   42,160 carry `isVerified`; the 798 that do not are not `verified: true`
 *   either. data-recovery.ts:305 reconciles exactly that pair and has evidently
 *   already run.
 *
 *   The claim was probably true once. It is not now, and it was the stated
 *   reason for pulling the entire user set into memory to filter it there. The
 *   defensive chain stays — a row could be written tomorrow by something that
 *   only knows the old spelling — but it is a guard now, not a population.
 */

/** The marker the 29 May 2026 backfill left on every row it minted. */
export const MANUFACTURED_PROFILE_MARKER = "_system_skeleton_backfill";

/** Anything with a `data()` shape. Deliberately loose: callers hold raw docs. */
type ProfileLike = Record<string, unknown> | null | undefined;

/**
 * Was this profile written by the backfill rather than by a person registering?
 *
 * Strict equality against `true`, not truthiness: a row carrying the string
 * "false" would otherwise read as manufactured, and this decides whether
 * somebody's verification counts.
 */
export function isManufacturedProfile(data: ProfileLike): boolean {
    return data?.[MANUFACTURED_PROFILE_MARKER] === true;
}

/**
 * Is there any way to reach the person this row claims to describe?
 *
 * Used to tell the 2,591 rows with nothing on them from the ~1,000 that at
 * least carry a name or an address. Both are unevidenced; only one is also
 * unreachable, and an admin triaging them needs to see which is which.
 */
export function hasContactableIdentity(data: ProfileLike): boolean {
    const usable = (v: unknown) => typeof v === "string" && v.trim().length > 0;
    return usable(data?.email) || usable(data?.phone);
}

/**
 * Has a named human recorded a verification decision on this row?
 *
 * `verifiedBy` is the admin id `_toggleUserVerificationAction` stamps. The
 * backfill wrote no such field on any of its 3,605 rows — checked against a
 * sampled document, which carries uid/email/phone/roles/names/timestamps/
 * verified/isVerified/profileComplete/_schemaVersion/serviceRegistrations and
 * nothing else.
 *
 * THIS IS THE ESCAPE HATCH, and it has to exist. Without it a manufactured row
 * would read `unevidenced` forever — including after an admin looked at it,
 * decided, and pressed the button. The marker records where the row CAME FROM
 * and is never removed; this records what somebody DID about it since, and once
 * they have, their decision is the answer.
 */
export function hasHumanVerificationDecision(data: ProfileLike): boolean {
    const by = data?.verifiedBy;
    return typeof by === "string" && by.trim().length > 0;
}

export type VerificationState = "verified" | "unverified" | "unevidenced";

/**
 * What this platform can honestly say about the row's verification.
 *
 *   verified     a stored flag that somebody set through the application
 *   unverified   the same, saying no
 *   unevidenced  the flag exists but was written by the backfill, about a
 *                person it knew nothing about
 *
 * The `isVerified ?? verified ?? false` chain is kept for the ordinary case.
 * See the header: its 34k population no longer exists, but the two spellings
 * both still appear in writes, so reading only one is how this drifts back.
 */
export function verificationState(data: ProfileLike): VerificationState {
    if (isManufacturedProfile(data) && !hasHumanVerificationDecision(data)) {
        return "unevidenced";
    }

    const stored = (data?.isVerified ?? data?.verified ?? false) as unknown;
    return stored === true ? "verified" : "unverified";
}

/**
 * Whether this row counts as a verified member.
 *
 * The one question the badge, the "Verified" filter and every total should ask.
 * `unevidenced` answers NO — not because the person failed a check, but
 * because nobody ever ran one.
 */
export function isVerifiedMember(data: ProfileLike): boolean {
    return verificationState(data) === "verified";
}
