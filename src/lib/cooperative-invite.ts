import { toMillis } from "@/lib/firestore-serialize";

/**
 * When a cooperative invitation stops being usable, and by whom.
 *
 * An invite waives the cooperative registration fee — `paymentStatus:
 * "completed"` is set from the presence of a token alone. Two things were
 * missing from the check:
 *
 *   NO EXPIRY.       The invite document has `email`, `token`, `status`,
 *                    `invitedBy`, `createdAt`, `updatedAt` and nothing else.
 *                    There is no expiresAt on the writer or the reader, so a
 *                    link worked for ever.
 *   NO EMAIL BINDING. validateCooperativeInviteAction compared the recorded
 *                    `email` to nothing at all. A forwarded link therefore
 *                    admitted whoever held it, fee-free.
 *
 * WHY THE BINDING FAILS CLOSED AND THE SESSION-REVOCATION CHECK FAILED OPEN
 * ------------------------------------------------------------------------
 * The asymmetry runs the other way here. A false refusal costs one invited
 * member a support conversation; a false acceptance gives a membership away to
 * whoever forwarded the link. So a recorded email that does not match the
 * caller refuses, and an invite with NO recorded email refuses too — every
 * invite this platform issues carries one, so its absence means a hand-made
 * row rather than a legitimate one.
 *
 * THE AGE WINDOW, AND WHY 90 DAYS IS SAFE TO PICK
 * -----------------------------------------------
 * Rows carry no expiresAt, so an age limit has to be derived from createdAt,
 * and the business has never stated one. 90 days is generous rather than
 * tight, and it is safe to pick precisely BECAUSE the email binding lands in
 * the same change: an ageing invite can now only be redeemed by the person it
 * was issued to, so the window is a second line rather than the only one.
 * `expiresAt` is honoured when present, so setting one per-invite later needs
 * no change here.
 *
 * NOTE ON REISSUING. inviteLegacyMemberAction — the only writer of this
 * collection — returns "Method deprecated"; its body is commented out. So no
 * new invitations can be issued at all, and a member refused here registers
 * and pays through the normal flow. Restoring the issuer is separate work.
 */

/** Days an invite remains usable when it carries no explicit expiresAt. */
export const INVITE_MAX_AGE_DAYS =
    Number(process.env.COOPERATIVE_INVITE_MAX_AGE_DAYS) > 0
        ? Number(process.env.COOPERATIVE_INVITE_MAX_AGE_DAYS)
        : 90;

export const INVITE_MAX_AGE_MS = INVITE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

export const INVITE_USED_MESSAGE = "This invitation has already been used or revoked.";
export const INVITE_EXPIRED_MESSAGE = "This invitation has expired. Please register normally or ask an administrator for a new one.";
export const INVITE_WRONG_ACCOUNT_MESSAGE = "This invitation was issued to a different email address. Sign in with the invited account, or register normally.";

export interface InviteRecord {
    status?: unknown;
    email?: unknown;
    createdAt?: unknown;
    expiresAt?: unknown;
}

function normaliseEmail(value: unknown): string {
    return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/**
 * Why this invite cannot be redeemed, or null if it can.
 *
 * `callerEmail` is optional so the onboarding page can preview a link before
 * anybody has signed in. Redemption always has a session, so the binding
 * always applies where the fee waiver is actually granted — the preview being
 * more permissive than the redemption is deliberate, not a gap.
 */
export function inviteRefusalReason(
    invite: InviteRecord | null | undefined,
    callerEmail?: string | null,
    now: number = Date.now(),
): string | null {
    if (!invite) return INVITE_USED_MESSAGE;

    if (invite.status !== "pending") return INVITE_USED_MESSAGE;

    // Explicit expiry wins when a row has one.
    const expiresAt = toMillis(invite.expiresAt);
    if (expiresAt > 0) {
        if (now >= expiresAt) return INVITE_EXPIRED_MESSAGE;
    } else {
        // Otherwise derive it. A row with an unreadable createdAt is treated as
        // ageless rather than as created at epoch — toMillis returns 0 for the
        // shapes it cannot read, and 0 would expire every such invite at once.
        const createdAt = toMillis(invite.createdAt);
        if (createdAt > 0 && now - createdAt >= INVITE_MAX_AGE_MS) {
            return INVITE_EXPIRED_MESSAGE;
        }
    }

    if (callerEmail !== undefined && callerEmail !== null) {
        const invited = normaliseEmail(invite.email);
        const caller = normaliseEmail(callerEmail);
        // Fails closed on a missing recorded email: every invite this platform
        // issues writes one.
        if (!invited || invited !== caller) return INVITE_WRONG_ACCOUNT_MESSAGE;
    }

    return null;
}
