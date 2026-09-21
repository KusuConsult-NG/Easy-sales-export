/**
 * The free text a person types into a box, checked where it is stored.
 *
 *   #812 THE CLIENT ENFORCED THE RULE AND THE SERVER TRUSTED IT.
 *
 *   The escrow chat's own input already says what the rule is:
 *
 *       EscrowChatClient.tsx:438   maxLength={1000}
 *       EscrowChatClient.tsx:168   if (!newMessage.trim() ...) return;
 *       EscrowChatClient.tsx:180   message: newMessage.trim()
 *
 *   `_sendEscrowMessageAction` applied none of it. A server action is a public
 *   HTTP endpoint — `maxLength` on an input is a courtesy to the honest user,
 *   not a control — so an empty message, a whitespace-only one, or one of any
 *   size at all could be posted straight to it.
 *
 *   The empty one is the visible half: a blank bubble in the other party's
 *   escrow chat, from a named participant, in the thread where a disputed
 *   order is argued. The unbounded one is the expensive half — the message is
 *   stored, re-read by every poll of that thread, and re-rendered.
 *
 *   MARKETPLACE REVIEW COMMENTS HAD THE SAME GAP with no client cap either:
 *   `comment: data.comment || null`, whatever arrived.
 *
 *   AND THE MODULE ALREADY KNEW BETTER. `_quote_offers.ts` does this to its own
 *   free text, server-side, in one expression:
 *
 *       response.message.trim().slice(0, 2000)
 *
 *   so the rule was applied to one path in the module and not to its siblings —
 *   the shape this audit finds more often than any other.
 *
 * ── WHY THIS REFUSES RATHER THAN TRUNCATES ──────────────────────────────────
 *
 *   `slice` silently changes what somebody said. On a chat message in a
 *   disputed order that is the wrong failure: the sender believes they sent a
 *   sentence and the recipient reads two thirds of one, with nothing on either
 *   screen saying so. Refusing is loud, and the client already prevents it, so
 *   an honest caller never sees the refusal at all.
 *
 *   `_quote_offers` is deliberately NOT changed to match. Truncating is what it
 *   has always done, its cap is generous, and altering the shipped behaviour of
 *   a working path is a wider change than this finding justifies. It is
 *   recorded here rather than quietly left: a seller's 2,500-character counter
 *   still loses its last 500 characters without being told.
 */

/** The escrow chat's own `maxLength`, now enforced where the message is stored. */
export const MESSAGE_MAX_LENGTH = 1000;

/** Matches the cap `_quote_offers` already applies to its free text. */
export const COMMENT_MAX_LENGTH = 2000;

export type FreeTextVerdict =
    | { ok: true; text: string }
    | { ok: false; reason: "empty" | "too_long"; message: string };

/**
 * Text a caller must supply — trimmed, non-empty, within `max`.
 *
 * `what` names the thing in the refusal, because "Message cannot be empty" and
 * "Note cannot be empty" are read by people in different places.
 */
export function requiredFreeText(
    value: unknown,
    max: number = MESSAGE_MAX_LENGTH,
    what: string = "Message",
): FreeTextVerdict {
    //   Anything that is not a string is empty rather than coerced. `String(42)`
    //   would make "42" a valid chat message, and an object would arrive as
    //   "[object Object]" in somebody's thread.
    const text = typeof value === "string" ? value.trim() : "";

    if (text === "") {
        return { ok: false, reason: "empty", message: `${what} cannot be empty.` };
    }
    if (text.length > max) {
        return {
            ok: false,
            reason: "too_long",
            message: `${what} is too long — ${text.length} characters, and the limit is ${max}.`,
        };
    }
    return { ok: true, text };
}

/**
 * Text a caller may omit — trimmed, capped, `null` when there is none.
 *
 * Refuses an over-long value rather than storing a truncated one, for the same
 * reason as above: a review whose last paragraph vanished is a review the buyer
 * did not write.
 */
export function optionalFreeText(
    value: unknown,
    max: number = COMMENT_MAX_LENGTH,
    what: string = "Comment",
): { ok: true; text: string | null } | { ok: false; reason: "too_long"; message: string } {
    if (value === undefined || value === null) return { ok: true, text: null };

    const text = typeof value === "string" ? value.trim() : "";
    if (text === "") return { ok: true, text: null };

    if (text.length > max) {
        return {
            ok: false,
            reason: "too_long",
            message: `${what} is too long — ${text.length} characters, and the limit is ${max}.`,
        };
    }
    return { ok: true, text };
}
