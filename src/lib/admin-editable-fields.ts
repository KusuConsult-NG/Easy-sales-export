/**
 * What an admin may correct on each module's record.
 *
 *   #783 THE FIELD LISTS LIVED INSIDE SIX SCREENS AND DRIFTED TO FIVE, TO
 *        FOURTEEN, TO SEVENTEEN, AND TO NONE AT ALL.
 *
 *   The owner: "when admin clicks edit, admin should be able to see all the
 *   fields and should be able to edit it."
 *
 *   Collected here rather than in each screen for the reason #775 recorded on
 *   the WAVE one: a list that lives beside its dialog gets extended when
 *   somebody is looking at that dialog, and not otherwise. Three of the six
 *   screens had no dialog at all, so their list was never written.
 *
 * ── EVERY KEY HERE IS CHECKED AGAINST THE SERVER ────────────────────────────
 *
 *   The test beside this finding parses ALLOWED_EDIT_FIELDS out of
 *   actions/admin/_applications.ts and fails if any key below is missing from
 *   it. A box whose key the server drops accepts typing, reports success and
 *   changes nothing — which is what "Date of Birth" and "Ward" did on the
 *   cooperative screen, found by that very sweep.
 */

import type { AdminEditableField } from "@/components/admin/AdminRecordEditor";

/** Name and contact — every module collects these. */
const IDENTITY: AdminEditableField[] = [
    { key: "firstName", label: "First Name", group: "Identity" },
    { key: "lastName", label: "Surname", group: "Identity" },
    { key: "otherName", label: "Other Names", group: "Identity" },
    { key: "dateOfBirth", label: "Date of Birth", group: "Identity" },
    { key: "phone", label: "Phone", group: "Contact" },
    { key: "email", label: "Email", group: "Contact" },
];

/** Where they are. */
const LOCATION: AdminEditableField[] = [
    { key: "residentialAddress", label: "Residential Address", group: "Location", wide: true },
    { key: "stateOfOrigin", label: "State of Origin", group: "Location" },
    { key: "lga", label: "LGA", group: "Location" },
    { key: "stateOfResidence", label: "State of Residence", group: "Location" },
    { key: "lgaOfResidence", label: "LGA of Residence", group: "Location" },
];

/** Who to contact if they cannot be reached. */
const NEXT_OF_KIN: AdminEditableField[] = [
    { key: "nextOfKin.name", label: "Next of Kin", group: "Next of Kin" },
    { key: "nextOfKin.phone", label: "Next of Kin Phone", group: "Next of Kin" },
    { key: "nextOfKin.relationship", label: "Relationship", group: "Next of Kin" },
    { key: "nextOfKin.address", label: "Next of Kin Address", group: "Next of Kin", wide: true },
];

/** Where money goes. */
const BANKING: AdminEditableField[] = [
    { key: "bankName", label: "Bank Name", group: "Banking" },
    { key: "accountNumber", label: "Account Number", group: "Banking" },
    { key: "accountName", label: "Account Name", group: "Banking" },
];

export const EXPORT_EDITABLE_FIELDS: ReadonlyArray<AdminEditableField> = [
    ...IDENTITY,
    ...LOCATION,
    { key: "occupation", label: "Occupation", group: "Livelihood" },
    ...BANKING,
];

export const ACADEMY_EDITABLE_FIELDS: ReadonlyArray<AdminEditableField> = [
    ...IDENTITY,
    ...LOCATION,
    { key: "occupation", label: "Occupation", group: "Livelihood" },
];

export const FARM_NATION_EDITABLE_FIELDS: ReadonlyArray<AdminEditableField> = [
    ...IDENTITY,
    ...LOCATION,
    { key: "occupation", label: "Occupation", group: "Livelihood" },
    ...BANKING,
];

/**
 * The seller record, which is a BUSINESS as well as a person.
 *
 * Widened from the five fields that screen carried — a seller's bank details
 * decide where their payouts land and were not correctable at all.
 */
export const MARKETPLACE_EDITABLE_FIELDS: ReadonlyArray<AdminEditableField> = [
    { key: "businessName", label: "Business Name", group: "Business" },
    { key: "cacNumber", label: "CAC Number", group: "Business" },
    ...IDENTITY,
    ...LOCATION,
    ...BANKING,
];

export const COOPERATIVE_EDITABLE_FIELDS: ReadonlyArray<AdminEditableField> = [
    ...IDENTITY,
    ...LOCATION,
    //   #783 `ward` and `dateOfBirth` were rendered by this screen and dropped
    //   by the server. Both are on the allow-list now.
    { key: "ward", label: "Ward", group: "Location" },
    { key: "occupation", label: "Occupation", group: "Livelihood" },
    ...NEXT_OF_KIN,
    ...BANKING,
];

/** Every list, for the sweep that checks them against the server. */
export const ALL_EDITABLE_FIELD_SETS: Record<string, ReadonlyArray<AdminEditableField>> = {
    export: EXPORT_EDITABLE_FIELDS,
    academy: ACADEMY_EDITABLE_FIELDS,
    farmNation: FARM_NATION_EDITABLE_FIELDS,
    marketplace: MARKETPLACE_EDITABLE_FIELDS,
    cooperative: COOPERATIVE_EDITABLE_FIELDS,
};

/**
 * Read a value that may be stored flat or nested.
 *
 * `nextOfKin.phone` is a real allow-list key and a NESTED path on the record.
 * Seeding it with `record["nextOfKin.phone"]` finds undefined and opens the box
 * blank on a member who has one — #775's defect with a dot in it.
 */
export function readRecordPath(record: Record<string, any> | null | undefined, key: string): string {
    if (!record) return "";
    if (key in record && record[key] != null) return String(record[key]);
    if (key.includes(".")) {
        const v = key.split(".").reduce<any>((acc, part) => (acc == null ? acc : acc[part]), record);
        if (v != null) return String(v);
    }
    return "";
}

/**
 * Seed an edit draft from the SAME list the form draws.
 *
 *   #783 THE SCREENS EACH KEPT A SECOND LIST, AND EACH ONE DISAGREED.
 *
 *   The cooperative editor seeded thirteen fields; the marketplace one seeded
 *   `address` and `state` while its form drew `residentialAddress` and
 *   `stateOfOrigin`, so both boxes opened BLANK on records that had them. #775
 *   found this shape on the WAVE screen and fixed it there. One function now,
 *   so a field added to a list is loaded without anybody remembering to.
 */
export function seedEditDraft(
    record: Record<string, any> | null | undefined,
    fields: ReadonlyArray<AdminEditableField>,
): Record<string, string> {
    const draft: Record<string, string> = {};
    for (const { key } of fields) draft[key] = readRecordPath(record, key);
    return draft;
}
