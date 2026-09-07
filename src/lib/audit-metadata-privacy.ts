/**
 * What an audit entry may show about a person, when it is read back.
 *
 *   #474 #468 FIXED THE WRITER AND LEFT EVERYTHING ALREADY WRITTEN ON SCREEN.
 *
 *   #468 stopped the WAVE application handler putting an applicant's name, home
 *   state and calculated age into audit metadata, and stopped the cooperative
 *   withdrawal handler putting a bank account number there. The owner then
 *   opened /admin/audit-logs and saw, still:
 *
 *       Target ID: WAVE-1786820450436-HMVQJKIV1
 *       Metadata: {
 *         "surname": "…", "firstName": "…",
 *         "ageVerification": "Verified 18+ (Auto-calculated: 26)",
 *         "stateOfResidence": "Adamawa"
 *       }
 *
 *   That entry was written on 15 August 2026. #468 landed on 7 September. The
 *   fix was real and it was only ever going to apply to entries written AFTER
 *   it — every entry from before still holds the data and the screen still
 *   renders it, in full, to every role that can read the log.
 *
 *   Fourth time in this audit that a fix reached some of the doors. The one left
 *   unfixed here is the door the owner was actually standing at.
 *
 *   NOTHING IS DELETED. The owner's standing instruction is that data is not
 *   destroyed to fix a defect, and it is the right instruction for an audit log
 *   in particular: the point of the record is that it cannot be quietly edited
 *   afterwards. So the rows are untouched and the READER redacts. The value is
 *   REPLACED, not removed, so the entry still shows that a field was recorded —
 *   an auditor can see the shape of what was captured and go to the record
 *   itself, which is where somebody entitled to those details reads them.
 *
 *   THE LIST IS SHARED WITH THE RATCHET. #468's test scans every `metadata: {}`
 *   literal in the tree for these same keys. It imports this list rather than
 *   restating it, so a key added here is both banned at the writer and redacted
 *   at the reader, and the two cannot drift — which is precisely how the writer
 *   came to be fixed while the reader was not.
 *
 *   `email` IS DELIBERATELY NOT ON THE LIST. An entry saying an admin unlocked
 *   an account has to say whose; that is the audit, not a leak. What is banned
 *   is the fields that describe a PERSON rather than identify the record acted
 *   on.
 */

import { PII_KEYS, stripSecrets } from "./admin-pii";

/**
 * Marker left in place of a redacted value.
 *
 * Deliberately not an empty string or a deleted key: an auditor must be able to
 * tell "this was never recorded" from "this was recorded and you may not read
 * it here", and only the second sends them to the record.
 */
export const REDACTED = "[redacted — see the record]";

/**
 * Keys an audit entry must not display.
 *
 * The financial and identity half comes from PII_KEYS — the platform's own
 * declared list — so a key added there is covered here without anybody
 * remembering to.
 *
 * The rest are the fields that describe a PERSON. They are deliberately NOT
 * pushed into PII_KEYS: stripPii() runs over admin screens that legitimately
 * show a member's name, and widening that list to make this one shorter would
 * blank them.
 */
export const PERSONAL_METADATA_KEYS: readonly string[] = [
    ...PII_KEYS,
    "firstName", "surname", "lastName", "fullName", "middleName", "otherName",
    "dateOfBirth", "dob", "age",
    "phone", "phoneNumber", "alternativePhone",
    "address", "residentialAddress", "stateOfResidence", "stateOfOrigin",
];

const BANNED = new Set(PERSONAL_METADATA_KEYS);

/**
 * Values that embed a person's details inside a free-text string.
 *
 * `ageVerification: "Verified 18+ (Auto-calculated: 26)"` is the entry the owner
 * saw: the KEY is unobjectionable — that an age gate ran is exactly what an
 * auditor needs — and the VALUE carries the age. A key-only redactor would have
 * left it on screen, which is the mistake this file exists to stop making
 * twice.
 */
const EMBEDDED_PERSONAL = /\bAuto-calculated:\s*\d+/i;

/**
 * A copy of `metadata` safe to display, with the record itself untouched.
 *
 * Recursive, because metadata is free-form and nothing stops a handler nesting
 * a whole document under one key.
 */
export function redactAuditMetadata<T>(metadata: T): T {
    return redact(stripSecrets(metadata));
}

function redact<T>(value: T): T {
    if (Array.isArray(value)) return value.map((v) => redact(v)) as unknown as T;
    if (value === null || value === undefined) return value;
    if (value instanceof Date) return value;

    if (typeof value === "string") {
        return (EMBEDDED_PERSONAL.test(value) ? REDACTED : value) as unknown as T;
    }

    if (typeof value !== "object") return value;

    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
        out[key] = BANNED.has(key) ? REDACTED : redact(v);
    }
    return out as unknown as T;
}

/**
 * The same redaction applied across a page of audit entries.
 *
 * Exists so the two readers — the screen and the CSV export — cannot apply it
 * differently, or one of them not at all.
 */
export function redactAuditEntries<T extends { metadata?: unknown }>(entries: T[]): T[] {
    return entries.map((entry) =>
        entry && entry.metadata !== undefined && entry.metadata !== null
            ? { ...entry, metadata: redactAuditMetadata(entry.metadata) }
            : entry,
    );
}
