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
    try {
        //   INSIDE the try, which it was not at first. canSendEmail already logs
        //   at error level and distinguishes the two cases that matter — "there
        //   is no address on the record" is a data problem, "RESEND_API_KEY is
        //   not configured" is an outage — but a guard that sits outside the
        //   catch is the one line in a never-throws function that can throw.
        if (!canSendEmail(context, to)) return;
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

/**
 * Send the inspector the job: every detail of the listing, and every document.
 *
 *   #864 THE SCREEN ALREADY PROMISED THIS AND NOTHING SENT IT.
 *
 *   The dispatch tab closes with, in so many words: "An email notification will
 *   be sent to the inspector with the property location and document links."
 *   The route sent the inspector nothing. There was no field for their address
 *   anywhere in the form — the only thing collected was their NAME, as free
 *   text, so there was nobody to send to even in principle.
 *
 *   THE INSPECTOR IS NOT A USER OF THIS PLATFORM, which is the whole reason
 *   this is an email and not a notification. They cannot sign in to read a
 *   bell, they cannot open the admin queue, and they cannot follow a link into
 *   a member area. So everything they need to do the job has to be IN THE
 *   MESSAGE: where the land is, how big it is, what it is being sold as, who
 *   owns it, and a link to each document they are being asked to authenticate.
 *
 *   THE DOCUMENT LINKS GO OUT IN FULL, and that is a deliberate decision rather
 *   than an oversight. These are the C of O, the survey plan and the tax
 *   clearance — the exact files #148 established must not leak to admin roles
 *   who cannot act on them. An inspector's entire job is to authenticate them
 *   on site, so withholding them would make the dispatch pointless. What keeps
 *   this narrow is that only an admin holding farm_nation:verify_applications
 *   can name the address, and every dispatch is in the audit log.
 *
 *   NO OWNER CONTACT DETAILS. The inspector is told who owns the land, because
 *   they have to meet somebody there, but the seller's phone and email are not
 *   in this message: the admin arranges access, and an emailed address is a
 *   copy nobody can withdraw.
 */
export async function notifyInspectorAssigned(params: {
    inspectorEmail?: string | null;
    inspectorName: string;
    scheduledDate: string;
    notes?: string | null;
    listing: {
        id: string;
        title?: string | null;
        description?: string | null;
        size?: number | null;
        price?: number | null;
        type?: string | null;
        ownerName?: string | null;
        location?: { state?: string | null; lga?: string | null; address?: string | null } | null;
        gpsCoordinates?: { latitude?: number | null; longitude?: number | null } | null;
        documents?: unknown;
    };
}): Promise<void> {
    const { inspectorEmail, inspectorName, scheduledDate, notes, listing } = params;

    //   No address is a data problem worth naming: the admin dispatched
    //   somebody they cannot reach, and the job has not gone anywhere.
    if (!inspectorEmail?.trim()) {
        logger.error(
            "[farm-nation] an inspector was dispatched with no email address; "
            + "the job could not be sent to them",
            { listingId: listing.id, inspectorName },
        );
        return;
    }

    const property = listing.title?.trim() || "a land listing";
    const where = [listing.location?.address, listing.location?.lga, listing.location?.state]
        .map((part) => (typeof part === "string" ? part.trim() : ""))
        .filter(Boolean)
        .join(", ");

    //   An array from the live form, and older rows may hold something else.
    //   #856 is the record of what assuming this shape costs.
    const documents = Array.isArray(listing.documents)
        ? listing.documents.filter((d): d is string => typeof d === "string" && !!d.trim())
        : [];

    const gps = listing.gpsCoordinates;
    const hasGps = typeof gps?.latitude === "number" && typeof gps?.longitude === "number";

    const rows = [
        listing.title?.trim() ? html`<p><strong>Listing:</strong> ${listing.title.trim()}</p>` : "",
        where ? html`<p><strong>Location:</strong> ${where}</p>` : "",
        hasGps
            ? html`<p><strong>GPS:</strong> ${gps!.latitude}, ${gps!.longitude}</p>`
            : "",
        typeof listing.size === "number" ? html`<p><strong>Size:</strong> ${listing.size}</p>` : "",
        typeof listing.price === "number"
            ? html`<p><strong>Asking price:</strong> ₦${listing.price.toLocaleString()}</p>`
            : "",
        listing.type ? html`<p><strong>Offered as:</strong> ${listing.type}</p>` : "",
        listing.ownerName?.trim()
            ? html`<p><strong>Owner:</strong> ${listing.ownerName.trim()}</p>`
            : "",
        listing.description?.trim()
            ? html`<p><strong>Description:</strong> ${listing.description.trim()}</p>`
            : "",
    ].filter(Boolean).join("");

    const documentList = documents.length
        ? documents
            .map((url, i) => html`<li><a href="${url}">Document ${i + 1}</a></li>`)
            .join("")
        : html`<li>No documents were attached to this listing.</li>`;

    await send(
        "Farm Nation inspector dispatch",
        inspectorEmail.trim(),
        `Inspection request: ${property} on ${scheduledDate}`,
        shell(
            "You have been asked to inspect a property",
            html`
                <p>Hello ${inspectorName},</p>
                <p>
                    You have been assigned to inspect the property below on
                    <strong>${scheduledDate}</strong>.
                </p>
                <div style="background: #f0fdf4; padding: 16px; border-radius: 8px;">
                    ${trustedHtml(rows)}
                </div>
                ${notes?.trim()
                    ? trustedHtml(html`<p><strong>Instructions:</strong> ${notes.trim()}</p>`)
                    : ""}
                <p><strong>Documents to authenticate:</strong></p>
                <ul>${trustedHtml(documentList)}</ul>
                <p>
                    Please confirm the boundaries and the GPS position on site, check the
                    documents above against what the owner produces, and send your report
                    back to the administrator who contacted you. The listing is not shown
                    to buyers until that report is filed.
                </p>
            `,
            `${getBaseUrl()}/farm-nation`,
            "Farm Nation",
        ),
    );
}

/**
 * Tell the seller her listing arrived, and what happens next.
 *
 *   #863 THE OWNER: "After listing notification email to be sent".
 *
 *   THE BELL WAS ALREADY RUNG AND NOTHING ELSE WAS. submitLandListingAction
 *   wrote an in-app row — "Your land listing has been submitted for
 *   verification" — and sent no email. A seller who submits a listing and
 *   closes the tab, which is what submitting a form usually means, had no
 *   record that it arrived.
 *
 *   AND THE NOTICE SAYS THE PART SHE ACTUALLY NEEDS, which the old one left
 *   out: the listing is NOT visible to buyers yet. #856 is the finding that
 *   makes this matter — before it, an unverified listing wore a "Verified
 *   Land" badge, so a seller had every reason to think she was live. Telling
 *   her it is under review is the other half of that repair.
 *
 *   `manageLink` IS THE CALLER'S, and it is a parameter rather than a constant
 *   because the two callers land in different modules: /land/submit has no
 *   per-listing page at all, and a Farm Nation seller belongs on
 *   /farm-nation/my-properties. Sending her to the PUBLIC property page would
 *   be the confident wrong answer — that page is exactly what refuses to show
 *   an unverified listing.
 */
export async function notifyListingSubmitted(params: {
    ownerId: string;
    ownerEmail?: string | null;
    ownerName?: string | null;
    listingTitle?: string | null;
    manageLink: string;
}): Promise<void> {
    const { ownerId, ownerEmail, ownerName, listingTitle, manageLink } = params;

    if (!ownerId) {
        logger.error("[farm-nation] a listing was submitted with no ownerId; nobody can be told");
        return;
    }

    const property = listingTitle?.trim() || "your land listing";

    await ringBell({
        userId: ownerId,
        title: "Land listing submitted",
        message:
            `${property} has been submitted for verification. It is not visible to buyers `
            + `yet — an administrator reviews the documents first, and you will be told when `
            + `that is done.`,
        link: manageLink,
        linkText: "View my listings",
    });

    const to = await resolveNoticeEmail("farm-nation", ownerId, ownerEmail);
    await send(
        "Farm Nation listing submitted",
        to,
        `We have received ${property}`,
        shell(
            "Your listing has been received",
            html`
                <p>Hello ${ownerName?.trim() || "there"},</p>
                <p><strong>${property}</strong> has been submitted for verification.</p>
                <p>
                    It is <strong>not visible to buyers yet</strong>. An administrator
                    reviews the title documents and survey plan first, and may send an
                    inspector to the land. You will be told when that is done, and again
                    when a decision is made.
                </p>
            `,
            `${getBaseUrl()}${manageLink}`,
            "View my listings",
        ),
    );
}

/**
 * Tell the seller what the inspector found.
 *
 *   #864 EITHER WAY, and the failed case is the one that matters most.
 *
 *   A passed inspection is the news she has been waiting for. A FAILED one is
 *   the only chance she has to do anything about it — and #690's rule applies
 *   exactly: a refusal recorded without its reason leaves the person it is
 *   about nothing to act on. The finding goes in the message rather than onto a
 *   record only an admin can read, which is where every other verdict on this
 *   platform used to stop.
 *
 *   IT IS NOT THE DECISION. A failed inspection does not reject the listing —
 *   reject-land does that, with its own notice — so the wording says what was
 *   found and what happens next, and does not tell her she has been refused.
 */
export async function notifyInspectionRecorded(params: {
    ownerId: string;
    ownerEmail?: string | null;
    ownerName?: string | null;
    listingId: string;
    listingTitle?: string | null;
    outcome: "passed" | "failed";
    findings?: string | null;
}): Promise<void> {
    const { ownerId, ownerEmail, ownerName, listingId, listingTitle, outcome, findings } = params;

    if (!ownerId) {
        logger.error(
            "[farm-nation] an inspection was recorded for a listing with no ownerId; "
            + "the seller cannot be told",
            { listingId },
        );
        return;
    }

    const property = listingTitle?.trim() || "your land listing";
    const note = findings?.trim() ?? "";
    const link = `/farm-nation/property/${listingId}`;
    const passed = outcome === "passed";

    await ringBell({
        userId: ownerId,
        title: passed ? "Your land passed inspection" : "Your land did not pass inspection",
        message: passed
            ? `The inspector has been to ${property} and passed it. An administrator makes `
                + `the final decision next, and you will be told the outcome.`
            : `The inspector has been to ${property} and did not pass it.`
                + (note ? ` Findings: ${note}` : "")
                + ` You can correct what was found and ask for another inspection.`,
        link,
        linkText: "View listing",
    });

    const to = await resolveNoticeEmail("farm-nation", ownerId, ownerEmail);
    await send(
        "Farm Nation inspection result",
        to,
        passed
            ? `${property} passed inspection`
            : `${property} did not pass inspection`,
        shell(
            passed ? "Your land passed inspection" : "Your land did not pass inspection",
            html`
                <p>Hello ${ownerName?.trim() || "there"},</p>
                <p>
                    The inspector has visited <strong>${property}</strong> and
                    ${passed ? "passed it" : "did not pass it"}.
                </p>
                ${note
                    ? trustedHtml(html`
                        <div style="background: #f0fdf4; padding: 16px; border-radius: 8px;">
                            <p><strong>What the inspector found:</strong></p>
                            <p>${note}</p>
                        </div>
                    `)
                    : ""}
                <p>
                    ${passed
                        ? "An administrator makes the final decision next, and you will be told "
                            + "the outcome. Your listing is shown to buyers once it is approved."
                        : "Your listing has not been refused. You can correct what was found "
                            + "and ask for another inspection."}
                </p>
            `,
            `${getBaseUrl()}${link}`,
            "View listing",
        ),
    );
}

/**
 * Tell BOTH parties that a property has been paid for and is held in escrow.
 *
 *   #863 THE OWNER: "and also after a transaction".
 *
 *   MEASURED: lib/property-purchase-fulfilment.ts — the one place a Farm Nation
 *   property payment completes, deliberately extracted so the Paystack callback
 *   and the webhook cannot answer the same payment differently (#721) — contains
 *   no notification of any kind. Money moved, a parcel went into escrow, and
 *   neither side was told.
 *
 *   THE SELLER IS THE HALF THAT WAS MISSING ENTIRELY, and is the reason this
 *   sends two notices rather than one. The buyer at least sees the callback
 *   page when the callback door runs. The seller has no page in this flow: her
 *   land is sold, the money is held, and the only record is a status on a row
 *   she would have to go looking for. When the WEBHOOK door runs — a buyer who
 *   closed the tab, which is the case #721 exists for — nobody saw anything at
 *   all.
 *
 *   ONE FAILING NOTICE MUST NOT COST THE OTHER, and the guarantee is the
 *   EARLY RETURN below rather than the `allSettled`. That distinction was found
 *   by mutation-testing: swapping `allSettled` for `all` failed no test, because
 *   every leaf — ringBell, send, resolveNoticeEmail — already swallows, so
 *   neither branch can reject in the first place. `allSettled` is defence in
 *   depth against a future leaf that forgets, kept because it costs nothing;
 *   the behaviour that is real, and tested, is that a listing with no owner
 *   logs and still notifies the buyer.
 */
export async function notifyPropertyPaid(params: {
    buyerId: string;
    buyerEmail?: string | null;
    sellerId?: string | null;
    propertyId: string;
    propertyTitle?: string | null;
    amount: number;
    reference: string;
}): Promise<void> {
    const { buyerId, buyerEmail, sellerId, propertyId, propertyTitle, amount, reference } = params;

    const property = propertyTitle?.trim() || "a property";
    const money = `₦${Number(amount || 0).toLocaleString()}`;
    const link = `/farm-nation/property/${propertyId}`;

    const tellBuyer = async () => {
        if (!buyerId) return;
        await ringBell({
            userId: buyerId,
            title: "Payment received — held in escrow",
            message:
                `Your payment of ${money} for ${property} has been confirmed and is held in `
                + `escrow. The funds are released to the seller once the transfer of title is `
                + `completed. Reference ${reference}.`,
            link: "/farm-nation/my-purchases",
            linkText: "View my purchases",
        });

        const to = await resolveNoticeEmail("farm-nation", buyerId, buyerEmail);
        await send(
            "Farm Nation purchase confirmed",
            to,
            `Payment confirmed for ${property}`,
            shell(
                "Your payment is held in escrow",
                html`
                    <p>We have confirmed your payment of <strong>${money}</strong> for
                       <strong>${property}</strong>.</p>
                    <div style="background: #f0fdf4; padding: 16px; border-radius: 8px;">
                        <p><strong>Reference:</strong> ${reference}</p>
                        <p><strong>Amount:</strong> ${money}</p>
                    </div>
                    <p>
                        The money is held in escrow, not paid to the seller. It is released
                        once the transfer of title is completed. Keep the reference above —
                        it identifies this payment in any query.
                    </p>
                `,
                `${getBaseUrl()}/farm-nation/my-purchases`,
                "View my purchases",
            ),
        );
    };

    const tellSeller = async () => {
        //   No seller id means the listing lost its owner, which is worth a log
        //   line: a sale has completed against a parcel nobody is recorded as
        //   owning, and somebody has to be paid.
        if (!sellerId) {
            logger.error(
                "[farm-nation] a property was paid for but the listing carries no owner; "
                + "the seller cannot be told",
                { propertyId, reference },
            );
            return;
        }

        await ringBell({
            userId: sellerId,
            title: "Your property has been paid for",
            message:
                `${property} has been bought for ${money}. The money is held in escrow and is `
                + `released to you once the transfer of title is completed.`,
            link,
            linkText: "View listing",
        });

        const to = await resolveNoticeEmail("farm-nation", sellerId, null);
        await send(
            "Farm Nation sale confirmed",
            to,
            `${property} has been paid for`,
            shell(
                "Your property has been paid for",
                html`
                    <p><strong>${property}</strong> has been bought for
                       <strong>${money}</strong>.</p>
                    <p>
                        The money is held in escrow rather than paid out immediately. It is
                        released to you once the transfer of title is completed, so please
                        have the documents ready.
                    </p>
                `,
                `${getBaseUrl()}${link}`,
                "View listing",
            ),
        );
    };

    await Promise.allSettled([tellBuyer(), tellSeller()]);
}
