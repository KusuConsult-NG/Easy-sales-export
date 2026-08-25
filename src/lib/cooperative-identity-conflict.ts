/**
 * Does somebody ELSE already hold this phone number or email in the cooperative?
 *
 * ONE RULE, AND ONLY ONE OF THE TWO DOORS ASKED IT
 * ------------------------------------------------
 * registerCooperativeMemberAction checked the cooperative roster for a matching
 * phone and a matching email before writing. resubmitCooperativeApplicationAction
 * — the revision flow, which writes the same fields to the same collection —
 * checked neither. A member in `revision_required` could resubmit carrying
 * somebody else's phone number or email address and it went straight through.
 *
 * That is #32 again: the WAVE resubmission path bypassed its own duplicate
 * guards for exactly the same reason, because a resubmit is written as a
 * separate function from a submit and only one of them gets the rule.
 *
 * WHAT THE ORIGINAL CHECK COMPARED
 * --------------------------------
 * It read one row per field and allowed the write when `doc.id !== userId` was
 * false — the DOCUMENT id, not the row's `userId`. Most cooperative member rows
 * are keyed by the user id so that usually agreed, but joinCooperativeAction
 * creates rows with an auto-generated id, and the email/paymentReference
 * fallbacks in _coop_identity.ts adopt whatever document they matched. For those
 * rows the caller's OWN record read as a stranger's and blocked them.
 *
 * `userId` is what the field means. The document id is the fallback for legacy
 * imported rows that predate it, which is the same pair every other reader in
 * this module uses.
 *
 * AND IT READ ONE ROW
 * -------------------
 * `.limit(1)`, no ordering: with the caller's own row beside somebody else's,
 * which one answered depended on row order — the #227 shape. The whole matching
 * set is scanned, and a foreign owner wins whichever order the rows arrive in.
 */

import { COLLECTIONS } from "@/lib/types/firestore";
import { normalisePhone } from "@/lib/phone";

/** How many rows sharing one identity are examined before deciding. */
export const IDENTITY_SCAN_LIMIT = 20;

/** Does this row belong to `userId`? */
function ownedBy(doc: { id: string; data: () => any }, userId: string): boolean {
    const rowUserId = doc.data()?.userId;
    return rowUserId ? rowUserId === userId : doc.id === userId;
}

/**
 * The refusal message, or null when nothing conflicts.
 *
 * `db` is the Firestore-compat adapter; `phone` and `email` are the values about
 * to be written.
 */
export async function cooperativeIdentityConflict(
    db: any,
    userId: string,
    phone: string | null | undefined,
    email: string | null | undefined,
): Promise<string | null> {
    const members = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS);

    if (phone) {
        // Both forms, because rows already exist in each: the onboarding form
        // stores what was typed and the bulk import stored E.164. Matching only
        // one form is #80, which made the guard blind to every imported member.
        const forms = [...new Set([phone, normalisePhone(phone)].filter(Boolean))] as string[];
        const snap = await members
            .where("phone", "in", forms)
            .limit(IDENTITY_SCAN_LIMIT)
            .get();

        if (!snap.empty && snap.docs.some((d: any) => !ownedBy(d, userId))) {
            return "A cooperative member with this phone number already exists.";
        }
    }

    if (email) {
        // Both the as-given and lowercased forms. Today's two callers validate
        // through cooperativeMembershipSchema, whose strictEmailSchema
        // lowercases — so for them the two collapse to one — but this helper
        // must not depend on every future caller doing that.
        //
        // KNOWN LIMIT: a STORED row whose email carries capitals (a legacy
        // import wrote unvalidated data) cannot be matched by equality at all —
        // its casing is arbitrary and PostgREST JSONB equality is
        // case-sensitive. Closing that needs a normalised column or a backfill,
        // not a longer `in` list; recorded here so the gap reads as a decision
        // rather than an oversight. Same family as #83.
        const forms = [...new Set([
            String(email).trim(),
            String(email).trim().toLowerCase(),
        ].filter(Boolean))];

        const snap = await members
            .where("email", "in", forms)
            .limit(IDENTITY_SCAN_LIMIT)
            .get();

        if (!snap.empty && snap.docs.some((d: any) => !ownedBy(d, userId))) {
            return "A cooperative member with this email address already exists.";
        }
    }

    return null;
}
