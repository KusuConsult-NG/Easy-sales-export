import { logger } from './logger';

/**
 *   #489 AN IDENTITY FIELD WITH A `|| ""` FALLBACK.
 *
 *   Two admin approvals create a user profile when the member has none, and
 *   both ended their email expression the same way:
 *
 *     _coop_admin_members.ts   email: memberData?.email || ""
 *     _fn_admin.ts             email: profile.email || appData.userEmail || ""
 *
 *   That is where the owner's "49 profiles with no email address" came from,
 *   and the split — 48 cooperative_member, 1 farmer — is the two paths, not
 *   scattered bad data.
 *
 *   WHY AN EMPTY STRING IS NOT A SMALL THING. #479 established it: a blank
 *   email is not an identity. Such a profile is findable ONLY by its document
 *   id — not by login, not by password reset, not by the admin search, and not
 *   by authAccountsWithProfiles, which joins an auth account to its profile by
 *   document id or by email. So the person cannot sign in, no admin can find
 *   them, and the platform's own forensic scan reports them as a GHOST — which
 *   is the owner's other standing finding, and one click from being "repaired"
 *   into a duplicate profile.
 *
 *   NEITHER PATH LOOKED WHERE THE ADDRESS ACTUALLY IS. A member being approved
 *   signed up with an email; it is on their auth record. Both paths looked only
 *   at the document in front of them and then gave up into a string.
 *
 *   THE AUTH LOOKUP IS LAST, NOT FIRST. It is a round trip per approval, and
 *   the record in hand is right almost every time. This runs the cheap
 *   candidates first and calls out only when they are all blank — so the common
 *   case costs nothing, and it can never overwrite an address that is already
 *   there.
 */

/** A trimmed, lower-cased address, or null when the value is not one. */
function usable(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    //   Not a format check. The only question here is whether there is an
    //   identity at all, and `""`, `"   "` and `undefined` are the same answer.
    return trimmed.length > 0 ? trimmed : null;
}

/**
 * The email to record on a profile being created for `uid`.
 *
 * `candidates` are the addresses already in hand, best first. Returns null only
 * when none of them holds one AND the auth record has none either — which is a
 * person the platform cannot identify, and the caller must refuse rather than
 * invent.
 */
export async function resolveProfileEmail(
    uid: string,
    candidates: Array<unknown>,
): Promise<string | null> {
    for (const candidate of candidates) {
        const email = usable(candidate);
        if (email) return email;
    }

    if (!uid) return null;

    //   The auth record. Imported here rather than at module scope so a caller
    //   that never reaches this line does not pull the admin SDK in.
    try {
        const { adminAuth } = await import('./firebase-admin');
        const record = await adminAuth.getUser(uid);
        const email = usable(record?.email);
        if (email) {
            logger.info('[profile-email] recovered the address from the auth record', { uid });
            return email;
        }
    } catch (err) {
        /**
         *   A MISSING AUTH RECORD IS THE CASE THE REFUSAL IS FOR, NOT AN ERROR.
         *
         *   An admin can create a membership for somebody who never signed up,
         *   and getUser throws for them. That must arrive at the admin as the
         *   caller's own "no email address on file" message, which they can act
         *   on, rather than as a stack trace they cannot.
         */
        logger.warn('[profile-email] no auth record to recover an address from', {
            uid,
            reason: err instanceof Error ? err.message : String(err),
        });
    }

    return null;
}
