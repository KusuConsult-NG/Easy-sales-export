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

/**
 * Every PHONE NUMBER on a tombstoned row, for an audience keyed by number.
 *
 *   #733 THIRTEEN OF THE FIFTEEN SMS AUDIENCES ASKED NOTHING BEFORE SENDING.
 *
 *   The in-app broadcast checks contactability in ONE place — inside its `add`,
 *   the funnel every audience goes through — which is why it has no per-audience
 *   gaps. The SMS broadcast has the same funnel and never checked in it, so the
 *   rule reached whichever `case` somebody remembered: `all_except_approved_coop`
 *   (#697) and, since #732, `wave_briefing_registrants`. The other thirteen read
 *   a number off a row and sent to it.
 *
 *   WHAT THAT COSTS, AND IT IS NOT THE ERASED MEMBER. #697 already established
 *   that an erased member has no number left to reach: ERASED_FIELDS deletes it
 *   from the user row and #376 scrubs it off the module rows. The cost is the
 *   SUPERSEDED one.
 *
 *   contactableVerdict refuses two states, and supersession is the other:
 *   `_migratedTo` pointing at a different uid. #724's duplicate-profile tool
 *   creates exactly that state, and it deliberately DESTROYS NOTHING — the
 *   superseded row keeps its name, its email and its phone number so the
 *   decision stays reversible. So the person whose duplicate an admin resolved
 *   is still in the users collection twice, with the same number on both rows,
 *   and every broadcast reached them twice.
 *
 *   KEYED BY NUMBER, NOT BY UID, because that is what this funnel has. The SMS
 *   `add` receives a phone string and nothing else; giving it a uid would mean
 *   editing fifteen call sites, and a rule applied at fifteen sites is the
 *   shape that produced this finding.
 *
 *   NORMALISED ON BOTH SIDES. #729 established that one number is stored under
 *   four spellings, so a raw comparison here would miss the row it is meant to
 *   catch — which is this same defect one layer down.
 *
 *   FAILS OPEN, LOUDLY, for the reason loadNonContactableUserIds gives above: a
 *   read error must not empty an admin's audience.
 */
export async function loadNonContactablePhones(
    db: { collection: (name: string) => any },
    usersCollection: string,
): Promise<Set<string>> {
    const { normalisePhone } = await import("@/lib/phone");
    const out = new Set<string>();

    const collect = async (run: () => Promise<any>) => {
        const snap = await run();
        for (const doc of snap.docs ?? []) {
            const data = doc.data?.() ?? {};
            for (const raw of [data.phone, data.phoneNumber, data.kyc?.phoneNumber]) {
                const normalised = normalisePhone(raw);
                if (normalised) out.add(normalised);
            }
        }
    };

    const FIELDS = ["phone", "phoneNumber", "kyc"] as const;

    try {
        await collect(() => db.collection(usersCollection)
            .where("deleted", "==", true).select(...FIELDS).all().get());
    } catch { /* fail open — see the header */ }

    try {
        await collect(() => db.collection(usersCollection)
            .where("_migratedTo", "!=", "").select(...FIELDS).all().get());
    } catch { /* fail open — see the header */ }

    return out;
}

/**
 * Is this address the erasure tombstone rather than a person's?
 *
 *   #734 — FOR THE PATHS THAT HAVE AN ADDRESS AND NO ROW TO ASK ABOUT.
 *
 *   broadcast-logic falls back to Supabase Auth for a user whose row carries no
 *   email, in FOUR places. There is no document there to hand
 *   isContactableAccount, so the tombstone has to be recognised from the
 *   address itself — and it can be: revokeAuthAccess rewrites the Auth email to
 *   `deleted_<uid>@redacted.local` when an account is erased, so that domain
 *   arriving from Auth IS the tombstone.
 *
 *   Sending there is not a privacy breach — the domain does not resolve — it is
 *   a guaranteed HARD BOUNCE, which is the thing BOUNCED_EMAILS and #694 exist
 *   to keep off this platform's sending reputation.
 *
 *   One function rather than four spellings of `endsWith`, because four copies
 *   of a rule is the defect this finding is an instance of.
 */
export function isErasedAddress(email: string | null | undefined): boolean {
    const value = String(email ?? "").toLowerCase().trim();
    return value.endsWith(ERASED_EMAIL_DOMAIN);
}
