import "server-only";

import { FieldPath } from "@/lib/firestore-compat";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from "@/lib/logger";

/**
 * Who performed the action on an audit row.
 *
 *   #770 THE AUDIT LOG COULD NOT SAY WHO DID ANYTHING.
 *
 *   The owner photographed /admin/audit-logs. Every visible row reads
 *
 *       Unknown
 *       2d02d66c…
 *
 *   in the User column — a truncated opaque id and the word "Unknown".
 *
 *   `userEmail` is declared on AuditLogEntry and written by NOTHING in
 *   lib/audit-log.ts. Counted across every recordAdminAction,
 *   createAdminAuditLog and createAuditLog call in the repository:
 *
 *       audit writes                189
 *       carrying a userEmail         10
 *
 *   So 179 of 189 produce a row whose actor is an id prefix, and the reader —
 *   `log.userEmail || "Unknown"` — is honest about not knowing. An audit log
 *   that cannot name the actor does not answer the one question it exists for.
 *
 * ── WHY THE READER, AND NOT THE 179 WRITERS ─────────────────────────────────
 *
 *   Two reasons, and the second is the stronger one.
 *
 *   FIRST, it is the same repair #764 arrived at for the missing `details`
 *   sentence: a field that is optional on the type gets forgotten, and the
 *   180th writer forgets it too. The reader already holds the `userId` and can
 *   resolve the rest.
 *
 *   SECOND, AND DECISIVE: IT HEALS THE ROWS ALREADY WRITTEN. The owner is
 *   looking at months of history. Writers can only fix rows created after they
 *   ship, and an audit row must never be edited afterwards — this function's
 *   own file already carries that ruling, from #474:
 *
 *       "An audit log that can be edited afterwards is not an audit log, and
 *        the owner's standing instruction is that nothing is destroyed to fix a
 *        defect. The stored record keeps everything; the READER stops
 *        displaying it."
 *
 *   #474 applied that to hiding fields. This applies it to adding one back: the
 *   stored rows are untouched, and the screen resolves the actor at read time.
 *
 * ── COST ────────────────────────────────────────────────────────────────────
 *
 *   ONE query per page, not one per row. The distinct ids on a page are looked
 *   up together with `documentId() in (…)`, chunked because that operator is
 *   bounded. A page is at most 50 rows and usually holds far fewer distinct
 *   actors, so this is a single extra read on a screen that already does one.
 *
 * ── AND IT REVEALS NOTHING NEW ──────────────────────────────────────────────
 *
 *   The audit screen already renders `userEmail` for the ten rows that carry
 *   one, behind `audit:read`. This fills in the same field on the same screen
 *   for the same audience; it does not widen who can see it. The email is NOT
 *   written back to the row, so the stored record is unchanged.
 *
 * ── FAILING OPEN ────────────────────────────────────────────────────────────
 *
 *   Any failure leaves the rows exactly as they arrived, so the screen shows
 *   "Unknown" as it does today. An audit page that cannot render because a
 *   convenience lookup failed would be a worse defect than the one being fixed.
 */

/** The `in` operator is bounded; the adapter's own callers chunk at 30. */
const LOOKUP_CHUNK = 30;

interface ActorRow {
    userId?: string;
    userEmail?: string;
}

/**
 * Fill in `userEmail` on rows that have a `userId` and no email.
 *
 * Returns a new array; the input rows are not mutated. Rows that already carry
 * an email are left alone — a stored value is what the actor was called AT THE
 * TIME, and the current profile may since have been renamed or erased.
 */
export async function attachActorEmails<T extends ActorRow>(
    rows: T[],
    db: { collection: (name: string) => any },
): Promise<T[]> {
    const missing = [...new Set(
        rows.filter((r) => r.userId && !r.userEmail).map((r) => r.userId as string),
    )];

    if (missing.length === 0) return rows;

    const emails = new Map<string, string>();

    try {
        for (let i = 0; i < missing.length; i += LOOKUP_CHUNK) {
            const chunk = missing.slice(i, i + LOOKUP_CHUNK);
            const snap = await db.collection(COLLECTIONS.USERS)
                .where(FieldPath.documentId(), "in", chunk)
                .get();

            for (const doc of snap.docs) {
                const data = doc.data() ?? {};
                //   `email` is the field the rest of this platform reads, and
                //   the one the ten rows that DO carry an email were written
                //   from. No fallback to a name: this column is labelled by the
                //   address, and a display name in it would be a different
                //   claim rendered as the same one.
                const email = typeof data.email === "string" ? data.email.trim() : "";
                if (email) emails.set(doc.id, email);
            }
        }
    } catch (error) {
        //   Fail open — see the header. The page renders exactly as it does
        //   today, and the failure is findable.
        logger.error("[audit-actor] could not resolve actor emails; rows keep their stored value", {
            ids: missing.length,
            error: error instanceof Error ? error.message : String(error),
        });
        return rows;
    }

    if (emails.size === 0) return rows;

    return rows.map((r) =>
        (r.userId && !r.userEmail && emails.has(r.userId))
            ? { ...r, userEmail: emails.get(r.userId) }
            : r);
}
