/**
 * How the four user segments are NAMED to a person reading a screen.
 *
 *   #805 "GHOST USERS" WAS THE PLATFORM'S OWN WORD FOR ITS QUIETEST MEMBERS.
 *
 *   The owner asked for these to stop being shown as ghosts — and to still be
 *   shown. Both halves matter: the number is real and useful, the word is not
 *   one to put on nearly half a register of real people. One screen even
 *   printed it as "👻 Ghost Users".
 *
 * ── THE KEY DOES NOT CHANGE, AND THAT IS THE POINT ──────────────────────────
 *
 *   `ghost_users` stays exactly as it is. It is the stored targeting value:
 *   sms-broadcast switches on it, broadcast-logic returns it, supabase-db
 *   names it in a query comment. Renaming a key to fix a label is how a
 *   cosmetic change becomes an outage, and this audit exists because this
 *   platform keeps breaking.
 *
 *   So the VALUE is untouched and only the words move — which is also why they
 *   are here rather than typed out at each screen. They were written in three
 *   places (the segmentation chart, the SMS audience list, the broadcast
 *   audience list) and would have to be corrected in three places, which is
 *   this codebase's most repeated defect applied to copy instead of logic.
 *
 * ── WHY "NOT STARTED" ───────────────────────────────────────────────────────
 *
 *   It says what the row actually is. #536 already corrected the DESCRIPTION
 *   from "Incomplete registrations / minimal data" — which the owner read as a
 *   sync fault — to what the classifier measures: no application, no bank
 *   details, no address in any spelling the platform writes. Most are imported
 *   member records that never went through a module onboarding.
 *
 *   "Not Started" is the same fact as a stage in a funnel beside Active,
 *   Pending and Stalled. "Ghost" describes the person; this describes where
 *   they have got to.
 */

/** The four buckets categorizeUser() sorts every account into. */
export type UserSegmentKey = "active" | "pending" | "stalled" | "ghost";

export interface UserSegmentLabel {
    /** The words on screen. */
    label: string;
    /** What the number measures, not what somebody inferred from it (#536). */
    description: string;
}

export const USER_SEGMENT_LABELS: Readonly<Record<UserSegmentKey, UserSegmentLabel>> = {
    active: {
        label: "Active",
        description: "Approved and taking part in at least one module",
    },
    pending: {
        label: "Pending Review",
        description: "Applications submitted and awaiting a decision",
    },
    stalled: {
        label: "In Progress",
        description: "Some details on file, no live application",
    },
    ghost: {
        label: "Not Started",
        description: "No application, bank details or address on record",
    },
} as const;

/**
 * The same wording for the broadcast and SMS audience pickers.
 *
 * Those screens target by the STORED key, so this maps the key rather than the
 * segment name — and it is the only place the two vocabularies meet.
 */
export const BROADCAST_SEGMENT_LABELS: Readonly<Record<string, UserSegmentLabel>> = {
    ghost_users: USER_SEGMENT_LABELS.ghost,
    stalled_users: USER_SEGMENT_LABELS.stalled,
    pending_users: USER_SEGMENT_LABELS.pending,
    active_users: USER_SEGMENT_LABELS.active,
} as const;
