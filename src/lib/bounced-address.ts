import { getAdminDb } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from "@/lib/logger";

/**
 *   #694 THE PLATFORM RECORDS WHICH ADDRESSES BOUNCE AND KEPT SENDING TO THEM.
 *
 *   api/webhooks/resend carefully writes every `email.bounced` and
 *   `email.complained` into BOUNCED_EMAILS, keyed by address. Two readers
 *   consult it — the admin broadcast and the (unreached) bulk sender — and
 *   `broadcast-logic.ts` says in its own words why it exists: "BOUNCED_EMAILS
 *   exists precisely because sender reputation matters here."
 *
 *   `sendEmailNotification` — the ONE path every transactional email takes, the
 *   thirteen #394 converted plus everything #688, #690 and #693 have since
 *   wired onto it — made no mention of bounces at all. So the rule protected
 *   the bulk door and not the busy one.
 *
 *   TWO COSTS, AND THE SECOND IS THE ONE THIS AUDIT CARES ABOUT.
 *
 *     REPUTATION. Continuing to send to a hard-bounced address is exactly what
 *     degrades a sending domain, and that degradation reaches the broadcasts
 *     the existing check was written to protect. The rule was being enforced on
 *     the mail that goes out in thousands and not on the mail that goes out all
 *     day.
 *
 *     "WE TOLD THE MEMBER" WAS FALSE. #688 and #690 just made thirteen more
 *     decisions announce themselves by email. For an address that cannot
 *     receive, the send is accepted by Resend, reported as sent, and arrives
 *     nowhere — the platform believing it has communicated something it has
 *     not. That is the shape those two findings exist to close, one layer down.
 *
 * ── A BOUNCE IS NOT A COMPLAINT ─────────────────────────────────────────────
 *
 *   The broadcast excludes on EITHER, and for bulk mail that is right: somebody
 *   who marked a newsletter as spam should not get the next one.
 *
 *   Transactional mail is a different question and gets a different answer.
 *   `email.bounced` means the address REFUSED the message — a loan decision
 *   sent there cannot arrive however much it is wanted. `email.complained`
 *   means it arrived and the person did not want THAT message; their bank
 *   details being wrong is still theirs to hear about. So only a bounce
 *   suppresses here, and the distinction is written down rather than inherited.
 *
 * ── IT FAILS OPEN ───────────────────────────────────────────────────────────
 *
 *   A database hiccup must not stop the platform telling somebody their loan
 *   was approved. A missed suppression costs a little reputation; a suppression
 *   that fires on a read error costs every transactional email on the platform
 *   until somebody notices. Logged and sent.
 */

/**
 *   Both spellings the webhook may have written.
 *
 *   It stores under `email.toLowerCase().replace(/\//g, "_")` — a slash is not
 *   legal in a document id — and the broadcast reader checks the raw lowercase
 *   AND the normalised form for that reason. The same two, for the same reason:
 *   checking one would miss every address the other shape was written under.
 */
export function bouncedDocIds(email: string): string[] {
    const lower = String(email ?? "").toLowerCase().trim();
    if (!lower) return [];
    const normalised = lower.replace(/\//g, "_");
    return normalised === lower ? [lower] : [lower, normalised];
}

/**
 *   Has this address refused mail?
 *
 *   True only for a recorded `email.bounced`. A spam complaint is deliberately
 *   not undeliverable — see the header.
 */
export async function isUndeliverable(email: unknown): Promise<boolean> {
    if (typeof email !== "string" || !email.trim()) return false;

    try {
        const db = getAdminDb();
        for (const id of bouncedDocIds(email)) {
            const snap = await db.collection(COLLECTIONS.BOUNCED_EMAILS).doc(id).get();
            if (!snap.exists) continue;
            const reason = (snap.data() ?? {}).reason;
            if (reason === "email.bounced") return true;
        }
        return false;
    } catch (error) {
        //   FAIL OPEN, loudly. See the header: the alternative is a read error
        //   silencing every transactional email on the platform.
        logger.error("[bounced-address] could not check an address; sending anyway", { error });
        return false;
    }
}
