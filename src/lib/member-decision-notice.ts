import { logger } from "@/lib/logger";
import { html } from "@/lib/utils";
import { canSendEmail, sendEmailNotification } from "@/lib/email-notifications";
import { createNotification } from "@/infrastructure/notifications/service";
//   #862 The private copy of this that lived here is gone; loan-decision-notice
//   held a second, identical but for the log prefix. See the module for the rule.
import { resolveNoticeEmail } from "@/lib/notice-email-address";

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

/**
 *   #941 `revision` IS THE FOURTH, AND IT IS NOT A VERDICT.
 *
 *   WAVE, Export and the Cooperative each let an admin send an application
 *   back for changes — status `revision_required`, plus a note saying what to
 *   change — and NONE of the three told the applicant. An application that
 *   needed one correction therefore stopped dead: the applicant saw no message
 *   and the admin saw no resubmission, each waiting on the other.
 *
 *   It belongs beside approved and rejected because it is the same event from
 *   the member's side — somebody looked at their application and decided
 *   something — and it needs the same bell, the same never-throws rule and the
 *   same one copy of the wording. What it does NOT share is finality: this is
 *   the one outcome that asks the member to act, so its notice has to carry the
 *   note and the way back in.
 */
export type DecisionOutcome = "approved" | "rejected" | "completed" | "revision";

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
    /**
     * The member's name, for the email greeting.
     *
     *   #941 Added so the three hand-rolled revision emails could be routed
     *   through here without any of them losing something they had. Each opened
     *   "Dear <name>," and a consolidation that quietly dropped it would be
     *   paying for consistency with the part the reader notices.
     *
     *   Absent is fine — the email simply opens with the sentence, which is what
     *   every existing caller already produces.
     */
    recipientName?: string;
}

const VERB: Record<DecisionOutcome, string> = {
    approved: "has been approved",
    rejected: "was not approved",
    completed: "has been completed",
    //   Not "was declined". The application is alive and the member can finish
    //   it; wording that reads like a refusal would stop them trying.
    revision: "needs a few changes before it can be approved",
};

const TITLE: Record<DecisionOutcome, string> = {
    approved: "Approved",
    rejected: "Not approved",
    completed: "Completed",
    revision: "Changes requested",
};

/**
 * Outcomes whose whole point is the sentence explaining them.
 *
 * A rejection without a reason is rude; a REVISION request without one is
 * unusable — "change something, I will not say what". Both carry it, and an
 * absent one is logged rather than quietly sent as a bare status change.
 */
const CARRIES_REASON: ReadonlySet<DecisionOutcome> = new Set<DecisionOutcome>(["rejected", "revision"]);

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

    /*
     *   #941 THROUGH CARRIES_REASON, not `outcome === "rejected"` again.
     *
     *   `outcome === "rejected"` was tested in FIVE places in this function:
     *   whether to print the reason, whether to print the note instead, the
     *   bell's type, the email heading's colour and the panel's background. Four
     *   of the five are presentation and one decides whether the member is told
     *   WHY — and a fourth outcome that also needs its reason had to find that
     *   one among the other four.
     *
     *   Named here so the next outcome does not have to. A revision notice that
     *   said "needs a few changes" without saying which would be the exact
     *   defect this module exists to fix, committed by the fix for it.
     */
    const explains = CARRIES_REASON.has(outcome);
    const message = [
        sentence,
        explains && reason ? `${outcome === "revision" ? "What to change" : "Reason"}: ${reason}` : "",
        !explains && note ? note : "",
    ].filter(Boolean).join(" ");

    if (explains && !reason) {
        //   Worth a line: the caller reached a path where the note is the payload
        //   and had none. The notice still goes — silence is worse — but somebody
        //   should see that it went out empty.
        logger.warn("[decision] no reason on an outcome that needs one", { userId, subject, outcome });
    }

    //   THE BELL FIRST, because it is the channel that always exists. Email
    //   needs RESEND_API_KEY and an address on the record, and this platform is
    //   deployed today without the key in some environments.
    try {
        await createNotification({
            userId,
            //   #941 A revision is neither a success nor a failure — it is a
            //   thing to do, so it rings as info rather than green or amber.
            type: notice.channel ?? (outcome === "rejected" ? "warning" : outcome === "revision" ? "info" : "success"),
            title: `${subject} — ${TITLE[outcome]}`,
            message,
            link,
            linkText: notice.linkText ?? "View details",
        } as any);
    } catch (error) {
        logger.error("[decision] in-app notice failed", { userId, subject, outcome, error });
    }

    const to = await resolveNoticeEmail("decision", userId, notice.userEmail);
    if (!canSendEmail(`${subject} decision email`, to)) return;

    /*
     *   ABSOLUTE, because a relative href in an email client goes nowhere. The
     *   bell takes `link` as a path — it is rendering inside the app — so the
     *   same value has to be resolved differently for the two channels rather
     *   than the caller being asked to pass it twice.
     */
    const origin = (process.env.NEXT_PUBLIC_APP_URL || "https://easysalesexport.com").replace(/\/+$/, "");
    const linkHref = link
        ? (/^https?:\/\//i.test(link) ? link : `${origin}/${link.replace(/^\/+/, "")}`)
        : "";

    try {
        const { error: sendError } = await sendEmailNotification({
            from: process.env.EMAIL_FROM || "Easy Sales Export <info@easysalesexport.com>",
            to,
            subject: `${subject} — ${TITLE[outcome]}`,
            message: html`
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: ${outcome === "rejected" ? "#dc2626" : outcome === "revision" ? "#b45309" : "#10b981"};">
                        ${subject} — ${TITLE[outcome]}
                    </h2>
                    ${notice.recipientName ? html`<p>Dear ${notice.recipientName},</p>` : ""}
                    <div style="background: ${outcome === "rejected" ? "#fef2f2" : outcome === "revision" ? "#fffbeb" : "#f0fdf4"};
                                padding: 16px; border-radius: 8px; margin: 20px 0;">
                        <p>${message}</p>
                    </div>
                    ${outcome === "revision"
                        ? html`<p>Open your application, make the changes above and submit it again — you do not need to start over.</p>`
                        : html`<p>You can see the details in your dashboard.</p>`}
                    ${/*
                        *   #941 THE LINK WAS COLLECTED AND NEVER PUT IN THE EMAIL.
                        *
                        *   `notice.link` has been on this interface since #690 and
                        *   was passed to createNotification only, so the bell knew
                        *   where to send a member and the email — the channel that
                        *   reaches somebody who is not on the site — said "you can
                        *   see the details in your dashboard" and left them to find
                        *   it. Eleven callers were affected, every one of them a
                        *   decision somebody was waiting on.
                        *
                        *   It matters most on a revision: that member has to get
                        *   back to a specific form, and "your dashboard" is three
                        *   screens away from it.
                        */ ""}
                    ${linkHref
                        ? html`
                            <div style="text-align: center; margin: 28px 0 8px;">
                                <a href="${linkHref}"
                                   style="background-color: ${outcome === "rejected" ? "#dc2626" : outcome === "revision" ? "#b45309" : "#10b981"};
                                          color: #ffffff; padding: 12px 32px; border-radius: 8px;
                                          text-decoration: none; font-weight: bold; display: inline-block;">
                                    ${notice.linkText ?? "View details"}
                                </a>
                            </div>`
                        : ""}
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
