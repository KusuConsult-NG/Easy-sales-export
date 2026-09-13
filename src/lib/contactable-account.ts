/**
 * Is there a person at the other end of this account? — one answer.
 *
 *   #697 THE PLATFORM WRITES TWO TOMBSTONES, AND THE ONE PLACE THAT DECIDES
 *        WHO GETS CONTACTED READS NEITHER.
 *
 *   ERASED. lib/user-soft-delete leaves a right-to-erasure request as
 *   `deleted: true`, `suspended: true`, `roles: ["deleted"]` and
 *   `email: deleted_<uid>@redacted.local`. All three audience builders read
 *   `users`, take `data.email` and send.
 *
 *   The address is built to look real and NOTHING READS IT BACK:
 *   `erasedEmailFor()` is imported by exactly three files and all three WRITE
 *   it. The broadcast's own gate, `isPlausibleEmail`, is
 *   `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` — an @ and a dot, which the placeholder has.
 *
 *   `.local` is a RESERVED TLD (RFC 6762, multicast DNS) and can never resolve,
 *   so every broadcast sends one guaranteed-undeliverable message per erased
 *   account. #694: "Continuing to send to a hard-bounced address is exactly what
 *   degrades a sending domain, and that degradation reaches the broadcasts the
 *   existing check was written to protect." The platform was manufacturing that
 *   out of its own erasure marker.
 *
 *   SUPERSEDED. #681 stopped the legacy import deleting a member's old profile
 *   and marks it `_migratedTo: <the live uid>`. #490 states the rule: "A ROW
 *   THAT SAYS `_migratedTo: <somebody else>` HAS BEEN SUPERSEDED." Identity
 *   resolution honours it everywhere — profile-choice, the payment processors,
 *   the profile actions all walk the pointer. The audiences did not. The
 *   owner's forensic report counts 33 addresses holding more than one profile,
 *   "the original kept and tombstoned, never deleted".
 *
 * ── WHAT IS DELIBERATELY STILL CONTACTABLE ──────────────────────────────────
 *
 *   A SUSPENDED OR BANNED ACCOUNT THAT WAS NOT ERASED. Suspension is an access
 *   decision an admin can reverse, and "your account has been suspended" is
 *   exactly the kind of thing a platform may still need to send. Only the two
 *   markers that mean "this is not a live person to contact" exclude.
 *
 *   That distinction is why this is not `!user.suspended`: an erasure sets
 *   `suspended` too, so testing that field would have swept in every suspension
 *   as well and quietly stopped a real category of mail.
 */

/** The domain lib/user-erasure puts on every erased account. */
const ERASED_EMAIL_DOMAIN = "@redacted.local";

export interface ContactableVerdict {
    contactable: boolean;
    /** Which tombstone matched, for a log line or a test that names it. */
    reason?: "erased" | "superseded";
}

/**
 * Decide whether an account row may be contacted.
 *
 * `id` is passed separately because a superseded row points at the LIVE uid,
 * and a row pointing at itself is not superseded — it is just a row that
 * survived a migration where it was also the winner.
 */
export function contactableVerdict(
    user: Record<string, unknown> | null | undefined,
    id?: string,
): ContactableVerdict {
    if (!user) return { contactable: false, reason: "erased" };

    if (user.deleted === true) return { contactable: false, reason: "erased" };

    //   The ADDRESS, independently of the flag. A row carrying the placeholder
    //   must never be mailed even if `deleted` were somehow absent — the
    //   address is the thing that would actually be sent to.
    const email = typeof user.email === "string" ? user.email.toLowerCase().trim() : "";
    if (email.endsWith(ERASED_EMAIL_DOMAIN)) return { contactable: false, reason: "erased" };

    const migratedTo = user._migratedTo;
    if (typeof migratedTo === "string" && migratedTo.trim() && migratedTo !== id) {
        return { contactable: false, reason: "superseded" };
    }

    return { contactable: true };
}

/** The same decision as a boolean, for the call sites that only branch. */
export function isContactableAccount(
    user: Record<string, unknown> | null | undefined,
    id?: string,
): boolean {
    return contactableVerdict(user, id).contactable;
}

/**
 * Every uid the platform has tombstoned, for an audience that reads MODULE rows.
 *
 *   The module collections carry their own copy of a member's contact details
 *   and know nothing about the marker on the user row, so an audience that
 *   supplements from them has to be told. This is that list.
 *
 *   TWO TARGETED QUERIES, NOT A SCAN. Both sets are small, and the `!=` form is
 *   exact for what is wanted here: this adapter emits `raw_data->>'f' <> 'x'`,
 *   which is NULL — and therefore NOT TRUE — for a row missing the key. So it
 *   matches rows that HAVE `_migratedTo` and no others, which is precisely the
 *   superseded set. (That property is asserted in fake-db-matches-postgres.)
 *
 *   FAILS OPEN, LOUDLY. A read error here must not empty an admin's audience —
 *   losing a broadcast to everybody is worse than including a handful of
 *   tombstones. The user-row check in the caller still catches every erased
 *   account it actually reads; this list only adds the module supplements.
 */
export async function loadNonContactableUserIds(
    db: { collection: (name: string) => any },
    usersCollection: string,
): Promise<Set<string>> {
    const out = new Set<string>();

    const collect = async (run: () => Promise<any>) => {
        const snap = await run();
        for (const doc of snap.docs ?? []) {
            const id = doc.id ?? doc.data?.()?.id;
            if (id) out.add(String(id));
        }
    };

    try {
        await collect(() => db.collection(usersCollection)
            .where("deleted", "==", true).select("deleted").all().get());
    } catch { /* fail open — see the header */ }

    try {
        await collect(() => db.collection(usersCollection)
            .where("_migratedTo", "!=", "").select("_migratedTo").all().get());
    } catch { /* fail open — see the header */ }

    return out;
}
