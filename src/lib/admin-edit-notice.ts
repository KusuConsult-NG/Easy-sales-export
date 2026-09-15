/**
 * Telling a member that an administrator changed their record.
 *
 *   #782 AN ADMIN COULD CHANGE A MEMBER'S BANK ACCOUNT NUMBER AND THE MEMBER
 *        WAS NEVER TOLD.
 *
 *   The owner: "when admin edits or approves, users should get notification on
 *   what was done and should be able to read the notice of what was done."
 *
 *   SWEPT, and the two halves failed differently.
 *
 *   THE EDIT PATH TOLD NOBODY ANYTHING. editApplicationAction writes an admin
 *   audit log and stops. No email, no in-app notice, nothing the member can
 *   read. #775 then widened that editor from five fields to seventeen and made
 *   it actually write them — so the silence got louder, not quieter.
 *
 *   The fields it can change include `accountNumber`, `bankName`, `bvn` and
 *   `nin`. A payout destination altered without the account holder being told
 *   is the shape of every account-takeover story there is, and the platform's
 *   own audit trail records it as a legitimate admin edit — which it usually
 *   is. The member is the only person who can tell the difference, and they
 *   were the one person not informed.
 *
 *   THE APPROVE PATH SENT AN EMAIL AND NOTHING ELSE. WAVE approve and reject
 *   call sendWaveApplicationEmail and create no in-app notification. On this
 *   deployment RESEND_API_KEY is not set — the boot log says so on every start
 *   — so in practice the member is told nothing there either, and there is no
 *   record in the app for them to go back and read.
 *
 * ── WHAT THE NOTICE SAYS, AND WHAT IT DELIBERATELY DOES NOT ─────────────────
 *
 *   IT NAMES THE FIELDS AND NOT THE VALUES.
 *
 *   "Your bank account number was updated" — not the number. A notification is
 *   rendered in the notification centre, counted in an unread badge, and on
 *   this platform can be pushed to a device. Putting a BVN or an account number
 *   in one would move the exact data #779 just finished protecting into a
 *   channel with none of those protections.
 *
 *   Naming the field is enough for the only job the member has here: deciding
 *   whether the change was expected. If it was not, they open their profile and
 *   look — which is what the link is for.
 *
 * ── AND IT NEVER THROWS ─────────────────────────────────────────────────────
 *
 *   The same rule #688 and #690 settled: the edit is already committed when
 *   this runs. A failed notification must not turn a completed write into an
 *   error the admin retries, because a retried edit is a second write to a
 *   member's record.
 */

import { logger } from "@/lib/logger";
import { createNotification } from "@/infrastructure/notifications/service";

/**
 * Field keys the editor can write, in words a member would recognise.
 *
 *   NAMED, RATHER THAN HUMANISED FROM THE KEY. `bvn` humanises to "Bvn",
 *   `lgaOfResidence` to "Lga Of Residence", and `nextOfKin.phone` to something
 *   with a dot in it. A member reading "Your Lga Of Residence was updated"
 *   learns less than one reading "your LGA of residence", and this is the one
 *   sentence they get.
 */
const FIELD_LABELS: Record<string, string> = {
    firstName: "first name",
    lastName: "surname",
    surname: "surname",
    middleName: "middle name",
    otherName: "other names",
    otherNames: "other names",
    fullName: "full name",
    businessName: "business name",
    phone: "phone number",
    alternativePhone: "alternative phone number",
    email: "email address",
    stateOfOrigin: "state of origin",
    lga: "LGA",
    lgaOfOrigin: "LGA of origin",
    stateOfResidence: "state of residence",
    lgaOfResidence: "LGA of residence",
    residentialAddress: "residential address",
    occupation: "occupation",
    currentOccupation: "occupation",
    membershipTier: "membership tier",
    nextOfKinName: "next of kin",
    nextOfKinPhone: "next of kin's phone number",
    nextOfKinRelationship: "next of kin relationship",
    "nextOfKin.name": "next of kin",
    "nextOfKin.phone": "next of kin's phone number",
    "nextOfKin.relationship": "next of kin relationship",
    "nextOfKin.address": "next of kin address",
    bankName: "bank name",
    accountNumber: "bank account number",
    accountName: "bank account name",
    bankCode: "bank code",
    "bankDetails.bankName": "bank name",
    "bankDetails.accountNumber": "bank account number",
    "bankDetails.accountName": "bank account name",
    "bankDetails.bankCode": "bank code",
    "bankAccount.bankName": "bank name",
    "bankAccount.accountNumber": "bank account number",
    "bankAccount.accountName": "bank account name",
    "bankAccount.bankCode": "bank code",
    bvn: "BVN",
    nin: "NIN",
    cacNumber: "CAC number",
    title: "listing title",
    "location.state": "listing state",
    "location.lga": "listing LGA",
};

/**
 * The fields whose change a member should be able to act on immediately.
 *
 * Money and identity. A notice about these leads with what changed rather than
 * burying it in a list, because these are the ones worth interrupting somebody
 * for.
 */
const SENSITIVE = new Set([
    "accountNumber", "bankDetails.accountNumber", "bankAccount.accountNumber",
    "accountName", "bankDetails.accountName", "bankAccount.accountName",
    "bankName", "bankDetails.bankName", "bankAccount.bankName",
    "bankCode", "bankDetails.bankCode", "bankAccount.bankCode",
    "bvn", "nin", "cacNumber", "email", "phone",
]);

/** A field's name in words, falling back to the key rather than inventing one. */
export function fieldLabel(key: string): string {
    return FIELD_LABELS[key] ?? key;
}

/** True when a change to this field is worth flagging as security-relevant. */
export function isSensitiveField(key: string): boolean {
    return SENSITIVE.has(key);
}

/**
 * Which fields actually CHANGED, comparing what was stored with what was written.
 *
 *   BOTH SIDES COMPARED AS TRIMMED STRINGS, because the editor writes strings
 *   and the stored value may be a number, a null or an untrimmed string from an
 *   older generation. Without that, re-saving a form without touching it would
 *   report every field as changed and train the member to ignore these.
 */
export function changedFields(
    before: Record<string, unknown> | null | undefined,
    after: Record<string, unknown> | null | undefined,
): string[] {
    const b = before ?? {};
    const a = after ?? {};
    const norm = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());

    return Object.keys(a).filter(k => norm(b[k]) !== norm(a[k]));
}

/**
 * Build the sentence a member reads.
 *
 * Exported so it can be asked directly with known inputs — the wording is the
 * deliverable here, and a test that only checks "a notification was created"
 * would pass on an empty one.
 */
export function describeEdit(fields: string[], editNote?: string | null): {
    title: string;
    message: string;
    sensitive: boolean;
} {
    const sensitive = fields.some(isSensitiveField);
    const labels = fields.map(fieldLabel);

    //   Listed in words rather than as a comma-joined dump: "your bank account
    //   number and your BVN" reads as a sentence, which is what gets read.
    const list = labels.length === 0
        ? ""
        : labels.length === 1
            ? labels[0]
            : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;

    const title = sensitive
        ? "Your account details were changed"
        : "Your record was updated";

    const opening = list
        ? `An administrator updated your ${list}.`
        : "An administrator updated your record.";

    const message = [
        opening,
        editNote ? `Note: ${editNote}` : "",
        //   The call to action, and the reason the notice names no values.
        sensitive
            ? "If you did not expect this, check your profile and contact support immediately."
            : "You can review your details on your profile.",
    ].filter(Boolean).join(" ");

    return { title, message, sensitive };
}

export interface AdminEditNotice {
    userId: string;
    before: Record<string, unknown> | null | undefined;
    after: Record<string, unknown> | null | undefined;
    editNote?: string | null;
    /** Where the member goes to look. Relative, like every notification link. */
    link?: string;
}

/**
 * Tell the member what an administrator changed. Never throws.
 *
 * Returns the fields it reported, so a caller's test can assert the content
 * rather than only that something was sent.
 */
export async function notifyMemberRecordEdited(notice: AdminEditNotice): Promise<string[]> {
    try {
        const { userId, before, after, editNote, link } = notice;

        if (!userId) {
            //   Worth a line: it means the record lost its owner, not that no
            //   notice was wanted.
            logger.error("[admin-edit] no member to notify about an edit");
            return [];
        }

        const fields = changedFields(before, after);
        if (fields.length === 0) {
            //   A save that changed nothing is not news. Sending anyway would
            //   teach members that these notices do not mean anything.
            return [];
        }

        const { title, message, sensitive } = describeEdit(fields, editNote);

        await createNotification({
            userId,
            type: sensitive ? "warning" : "info",
            title,
            message,
            link: link ?? "/profile",
            linkText: "Review your profile",
        });

        return fields;
    } catch (err) {
        /*
         *   NEVER FATAL. The edit is committed before this runs, and #688/#690
         *   settled the rule: a failed notice must not turn a completed write
         *   into an error the admin retries, because a retried edit is a second
         *   write to a member's record.
         */
        logger.error("[admin-edit] could not notify the member of an edit", {
            reason: err instanceof Error ? err.message : String(err),
        });
        return [];
    }
}
