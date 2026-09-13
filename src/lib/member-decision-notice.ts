import { logger } from "@/lib/logger";
import { html } from "@/lib/utils";
import { canSendEmail, sendEmailNotification } from "@/lib/email-notifications";
import { createNotification } from "@/infrastructure/notifications/service";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";

/**
 *   #690 AN ADMIN DECIDED, AND THE MEMBER WAS NOT TOLD — ELEVEN TIMES, ACROSS
 *        FIVE MODULES.
 *
 *   #688 found this on loan decisions and fixed it there. A sweep for the same
 *   shape — every write of an approved/rejected/verified verdict through
 *   update(), set() or a claimed transition, checked for a notice anywhere in
 *   the enclosing function — found the loan doors green and these eleven still
 *   silent:
 *
 *     WAVE       withdrawal approved / rejected / completed
 *     Land       listing verified, listing rejected
 *     FarmNation land approved, land rejected  (both API routes)
 *     FarmNation seller approved, seller rejected, property verified
 *     Academy    application REJECTED — while approval emails, four lines up
 *     Content    a member's product or land approved / rejected
 *
 *   THE ASYMMETRIES ARE THE TELL. Three of this platform's withdrawal systems
 *   decide a member's money: the cooperative one emails, wallet.ts rings the
 *   bell, and the WAVE one does neither — its file contains no notification of
 *   any kind. Academy's approve path sends an email and its reject path, in the
 *   same file, sends nothing. land-listings.ts notifies the ADMIN when a
 *   listing arrives and the member nothing when it is judged.
 *
 *   Nobody designed that. It is what happens when "tell the member" lives
 *   inside each caller instead of in one place, which is the finding #688 wrote
 *   down and this one is the rest of.
 *
 * ── WHY THIS IS NOT loan-decision-notice.ts ─────────────────────────────────
 *
 *   Deliberately two modules, not one by accident. A loan decision's email
 *   carries repayment terms — duration, interest rate, monthly payment, total
 *   repayment — and its own wording about disbursement. Nothing else here has
 *   terms, and generalising until it could hold them would make the common case
 *   worse to read. They share the shape, the channels and the never-throws
 *   rule; they differ in what a member needs to be told, which is the thing
 *   worth keeping specific.
 *
 *   IT NEVER THROWS. The decision is committed before this runs. A refused
 *   email must not turn a completed approval into an error the admin retries —
 *   and on the withdrawal paths a retry is a second claim attempt on money.
 */

export type DecisionOutcome = "approved" | "rejected" | "completed";

/** The notification type the bell renders with; see createNotificationAction. */
export type DecisionChannel =
    | "land" | "wave" | "withdrawal" | "payment" | "info" | "success" | "warning";

export interface MemberDecisionNotice {
    /** The member whose thing was decided. */
    userId: string;
    /**
     * What was decided, in the member's words and from their side.
     *
     * "Your land listing", "Your WAVE withdrawal" — it becomes the subject of
     * the sentence, so it reads as something of theirs rather than a row in a
     * table.
     */
    subject: string;
    outcome: DecisionOutcome;
    /** Why, when it was refused. The whole reason a rejection notice exists. */
    reason?: string;
    /** A money figure, when the decision is about one. */
    amount?: number;
    /** Where the member goes to see it. */
    link: string;
    linkText?: string;
    channel?: DecisionChannel;
    /** Read from the user record when the caller does not carry one. */
    userEmail?: string;
    /** Extra sentence for the approved case — "the funds are on their way". */
    note?: string;
}

async function resolveEmail(userId: string, given?: string): Promise<string | undefined> {
    if (typeof given === "string" && given.trim()) return given;
    try {
        const snap = await db.collection(COLLECTIONS.USERS).doc(userId).get();
        const email = snap.exists ? (snap.data() ?? {}).email : undefined;
        return typeof email === "string" && email.trim() ? email : undefined;
    } catch (error) {
        logger.error("[decision] could not resolve an address for the notice", { userId, error });
        return undefined;
    }
}

const VERB: Record<DecisionOutcome, string> = {
    approved: "has been approved",
    rejected: "was not approved",
    completed: "has been completed",
};

const TITLE: Record<DecisionOutcome, string> = {
    approved: "Approved",
    rejected: "Not approved",
    completed: "Completed",
};

export async function notifyMemberDecision(notice: MemberDecisionNotice): Promise<void> {
    const { userId, subject, outcome, reason, amount, link, note } = notice;
    if (!userId) {
        //   A decision with nobody to tell is worth a line in the log: it means
        //   the record lost its owner, not that no notice was wanted.
        logger.error("[decision] no member to notify", { subject, outcome });
        return;
    }

    const money = typeof amount === "number" && Number.isFinite(amount)
        ? ` of ₦${amount.toLocaleString()}`
        : "";

    const sentence = `${subject}${money} ${VERB[outcome]}.`;
    const message = [
        sentence,
        outcome === "rejected" && reason ? `Reason: ${reason}` : "",
        outcome !== "rejected" && note ? note : "",
    ].filter(Boolean).join(" ");

    //   THE BELL FIRST, because it is the channel that always exists. Email
    //   needs RESEND_API_KEY and an address on the record, and this platform is
    //   deployed today without the key in some environments.
    try {
        await createNotification({
            userId,
            type: notice.channel ?? (outcome === "rejected" ? "warning" : "success"),
            title: `${subject} — ${TITLE[outcome]}`,
            message,
            link,
            linkText: notice.linkText ?? "View details",
        } as any);
    } catch (error) {
        logger.error("[decision] in-app notice failed", { userId, subject, outcome, error });
    }

    const to = await resolveEmail(userId, notice.userEmail);
    if (!canSendEmail(`${subject} decision email`, to)) return;

    try {
        const { error: sendError } = await sendEmailNotification({
            from: process.env.EMAIL_FROM || "Easy Sales Export <info@easysalesexport.com>",
            to,
            subject: `${subject} — ${TITLE[outcome]}`,
            message: html`
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: ${outcome === "rejected" ? "#dc2626" : "#10b981"};">
                        ${subject} — ${TITLE[outcome]}
                    </h2>
                    <div style="background: ${outcome === "rejected" ? "#fef2f2" : "#f0fdf4"};
                                padding: 16px; border-radius: 8px; margin: 20px 0;">
                        <p>${message}</p>
                    </div>
                    <p>You can see the details in your dashboard.</p>
                </div>
            `,
            metadata: { type: "member_decision" },
        });
        //   #394 Resend RETURNS its errors rather than throwing them, so a
        //   refused or rate-limited send is invisible unless the result is read.
        if (sendError) logger.error("[decision] email send failed", { userId, subject, error: sendError });
    } catch (error) {
        logger.error("[decision] email threw", { userId, subject, error });
    }
}
