/**
 * Names that are not names.
 *
 *   #754 THIS RULE EXISTED IN ONE RESOLVER AND NOT THE OTHER.
 *
 *   The ghost-account auto-repair wrote "User" and "Unknown" into `fullName`
 *   before April 2026, and various imports left "N/A". `_users.ts` has rejected
 *   them since, with the reason written beside it:
 *
 *       "Reject placeholder values like 'User' or 'Unknown' that were written by
 *        the ghost-account auto-repair before April 2026. Fall through to the
 *        email address so the admin table shows something meaningful."
 *
 *   `extractCanonicalUser` — which serves the cooperative members list, the
 *   cooperative money screen, both withdrawal queues and the WAVE certificate —
 *   had no such rule, so it returned "User" as a person's name on all five.
 *
 *   Shared rather than copied, because a set of placeholder strings maintained
 *   in two files is the same defect waiting to recur: the next spelling somebody
 *   adds goes into one of them.
 */

/** Lower-cased strings that stand in for a name rather than being one. */
export const PLACEHOLDER_NAMES: ReadonlySet<string> = new Set([
    "user",
    "unknown",
    "unknown user",
    "n/a",
    "na",
    "null",
    "undefined",
    "",
]);

/**
 * Is this value a stand-in rather than a real name?
 *
 * Non-strings are placeholders too: a name that arrived as an object or a
 * number is not a name, and letting one through is how an object reaches React
 * as a child and takes the screen down.
 */
export function isPlaceholderName(value: unknown): boolean {
    if (typeof value !== "string") return true;
    return PLACEHOLDER_NAMES.has(value.toLowerCase().trim());
}

/** The value if it is a real name, otherwise an empty string. */
export function realNameOrBlank(value: unknown): string {
    return isPlaceholderName(value) ? "" : (value as string).trim();
}

/**
 * A field that must reach the UI as a string.
 *
 *   #754 `state` AND `lga` COULD BE OBJECTS, AND ONE RESOLVER KNEW IT.
 *
 *   `_users.ts` unwraps them explicitly, with the reason in its own comment —
 *   "preventing React objects-as-children crashes". Some schema generations
 *   store `{ name, code }` or `{ state }` where later ones store a plain
 *   string. `extractCanonicalUser` returned whatever it found, so an admin
 *   screen rendering `{address.state}` from that resolver would be handed an
 *   object.
 */
export function asDisplayString(value: unknown): string {
    if (typeof value === "string") return value;
    if (value && typeof value === "object") {
        const o = value as Record<string, unknown>;
        for (const key of ["name", "state", "lga", "label", "value"]) {
            if (typeof o[key] === "string") return o[key] as string;
        }
    }
    return "";
}
