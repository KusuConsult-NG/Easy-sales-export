import { logger } from "@/lib/logger";
import { html, trustedHtml } from "@/lib/utils";
import { canSendEmail, sendEmailNotification, getBaseUrl } from "@/lib/email-notifications";
import { createNotification } from "@/infrastructure/notifications/service";
import { resolveNoticeEmail } from "@/lib/notice-email-address";

/**
 * Farm Nation notifications.
 *
 *   #862 FARM NATION TOLD NOBODY ANYTHING.
 *
 *   THE OWNER: "Inspection notification for seller when an inspector is
 *   assigned. All the details should be sent to the seller via notification or
 *   in-app messaging and it should be automatic."
 *
 *   Measured before writing any of this: `COLLECTIONS.NOTIFICATIONS` appears in
 *   NO Farm Nation action or route. Not for a dispatch, not for a listing, not
 *   for a sale. The module writes to the listing record and to the admin audit
 *   log, and the seller learns what happened by opening the page and noticing.
 *
 *   The dispatch route is the clearest case. It writes `inspectorName`,
 *   `scheduledDate` and `notes` onto the listing and records
 *   `inspector_dispatched` in the audit log — a complete account of an
 *   appointment, kept where only an administrator can read it. Somebody is
 *   going to visit her land on a date she has not been told.
 *
 * ── THE FIRST DRAFT OF THIS FILE HAD THREE DEFECTS, ALL FOUND BY MEASURING ──
 *
 *   It wrote `db.collection(NOTIFICATIONS).add(...)` directly, which is how five
 *   other writers on this platform got it wrong (#687) and skips what
 *   createNotification exists to do: #738 redirects a notice addressed to a
 *   SUPERSEDED profile to the row the person actually signs in as. A seller who
 *   has migrated profiles would have been recorded as told and seen nothing.
 *
 *   It typed the row `farm_nation_inspection_scheduled`, which is not in
 *   `Notification["type"]` and is in no tab of FILTER_TAB_TYPES. The notice
 *   would have existed, under All, and never drawn the Farm Nation tab it
 *   belongs to. `farm_nation` is the type that union and that table both name.
 *
 *   And it sent the email as plain text with `\n` line breaks, into
 *   sendEmailNotification's `html:` field — one run-on paragraph. The body is
 *   built with html`` now, like every other notice on this platform, which also
 *   escapes the interpolated values; an inspector's name and an admin's notes
 *   are operator input going into markup.
 *
 * ── MODELLED ON member-decision-notice, NOT COPIED FROM IT ──────────────────
 *
 *   `notifyMemberDecision` is the right home for a VERDICT — approved, rejected,
 *   completed — and it reads as one throughout: VERB, TITLE, "was not approved",
 *   a reason. A dispatch is not a verdict. It is an appointment, and widening
 *   DecisionOutcome to admit one would make the eight doors that carry verdicts
 *   worse to read. Same argument the header of that file makes for why it is not
 *   loan-decision-notice.
 *
 *   BOTH CHANNELS, and the owner's "notification or in-app messaging" is
 *   answered with both rather than a choice: the in-app row is what she sees
 *   next time she opens the site, and the email is what reaches her before the
 *   inspector arrives. An appointment she misses because she did not log in is
 *   the defect this exists to prevent.
 *
 * ── EVERY FAILURE HERE IS NON-FATAL, DELIBERATELY ───────────────────────────
 *
 *   By the time these run, the thing being announced has already happened: the
 *   status transition is claimed, the inspector is dispatched. Throwing would
 *   turn "we could not send an email" into "the dispatch failed", and an admin
 *   would dispatch again — sending a second inspector. member-decision-notice
 *   and loan-decision-notice state the same rule for the same reason.
 */

/** Everything in this module rings the bell through here. Never throws. */
async function ringBell(data: {
    userId: string;
    title: string;
    message: string;
    link: string;
    linkText: string;
}): Promise<void> {
    try {
        //   `farm_nation`: in Notification["type"], and the type FILTER_TAB_TYPES
        //   files under the Farm Nation tab. A type outside that table is
        //   reachable only under "All".
        const result = await createNotification({ ...data, type: "farm_nation" });
        //   #394's rule, one layer up: this returns its failures rather than
        //   throwing them, so a swallowed error is invisible unless it is read.
        if (!result.success) {
            logger.error("[farm-nation] in-app notice was not written", {
                userId: data.userId, title: data.title, error: result.error,
            });
        }
    } catch (error) {
        logger.error("[farm-nation] in-app notice threw", { userId: data.userId, error });
    }
}

/** And every email goes out through here. Never throws. */
async function send(context: string, to: unknown, subject: string, body: string): Promise<void> {
    //   canSendEmail already logs at error level, and distinguishes the two
    //   cases that matter: "there is no address on the record" is a data problem,
    //   "RESEND_API_KEY is not configured" is an outage.
    if (!canSendEmail(context, to)) return;
    try {
        const { error } = await sendEmailNotification({
            to,
            subject,
            message: body,
            metadata: { type: "farm_nation" },
        });
        if (error) logger.error(`[farm-nation] ${context} email failed`, { error });
    } catch (error) {
        logger.error(`[farm-nation] ${context} email threw`, { error });
    }
}

/**
 * The shell every Farm Nation email shares, so they look like one platform.
 *
 *   `body` IS ALREADY-ESCAPED MARKUP AND SAYS SO. html`` escapes what it is
 *   given, so a fragment built with html`` and interpolated raw comes out as
 *   literal `&lt;p&gt;` — the defect loan-decision-notice's header records
 *   hitting, and the reason trustedHtml exists. The VALUES inside the fragment
 *   are still escaped by the inner tag; only the tags it produced are trusted.
 */
function shell(heading: string, body: string, cta: string, ctaLabel: string): string {
    return html`
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #15803d;">${heading}</h2>
            ${trustedHtml(body)}
            <p style="margin: 24px 0;">
                <a href="${cta}"
                   style="background: #15803d; color: #ffffff; padding: 12px 20px;
                          border-radius: 6px; text-decoration: none;">${ctaLabel}</a>
            </p>
        </div>
    `;
}

/**
 * Tell the seller that an inspector is coming, and when.
 *
 * EVERY DETAIL THE DISPATCH RECORDED. The route writes the inspector's name, the
 * date and the admin's notes onto the listing; all three are what she needs in
 * order to be there, so all three are in the message rather than an "an
 * inspection has been scheduled, log in to see more".
 */
export async function notifyInspectorDispatched(params: {
    ownerId: string;
    ownerEmail?: string | null;
    ownerName?: string | null;
    listingId: string;
    listingTitle?: string | null;
    inspectorName: string;
    scheduledDate: string;
    notes?: string | null;
}): Promise<void> {
    const {
        ownerId, ownerEmail, ownerName, listingId, listingTitle,
        inspectorName, scheduledDate, notes,
    } = params;

    //   Without an owner there is nobody to tell, and a notification row with no
    //   userId is one nobody can ever read. Logged rather than ignored: it means
    //   the listing lost its owner, not that no notice was wanted.
    if (!ownerId) {
        logger.error(
            "[farm-nation] an inspector was dispatched for a listing with no ownerId; "
            + "the seller cannot be told",
            { listingId },
        );
        return;
    }

    const property = listingTitle?.trim() || "your land listing";
    const trimmedNotes = notes?.trim() ?? "";
    const link = `/farm-nation/property/${listingId}`;

    //   THE BELL FIRST, because it is the channel that always exists. Email needs
    //   RESEND_API_KEY and an address, and this platform runs in environments
    //   with neither.
    await ringBell({
        userId: ownerId,
        title: "An inspection has been scheduled",
        message:
            `${inspectorName} will inspect ${property} on ${scheduledDate}.`
            + (trimmedNotes ? ` Notes: ${trimmedNotes}` : "")
            + " The inspection decides whether your listing is verified and shown to buyers.",
        link,
        linkText: "View listing",
    });

    const to = await resolveNoticeEmail("farm-nation", ownerId, ownerEmail);
    await send(
        "Farm Nation inspection scheduled",
        to,
        `Inspection scheduled for ${property}`,
        shell(
            "An inspection has been scheduled",
            html`
                <p>Hello ${ownerName?.trim() || "there"},</p>
                <p>An inspector has been assigned to <strong>${property}</strong>.</p>
                <div style="background: #f0fdf4; padding: 16px; border-radius: 8px;">
                    <p><strong>Inspector:</strong> ${inspectorName}</p>
                    <p><strong>Scheduled date:</strong> ${scheduledDate}</p>
                    ${trimmedNotes
                        ? trustedHtml(html`<p><strong>Notes:</strong> ${trimmedNotes}</p>`)
                        : ""}
                </div>
                <p>
                    The inspection decides whether your listing is verified and shown to
                    buyers, so please make sure the land is accessible on the day.
                </p>
            `,
            `${getBaseUrl()}${link}`,
            "View listing",
        ),
    );
}
