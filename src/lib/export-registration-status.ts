/**
 * The status an export application leaves on the USER's registration.
 *
 *   #911 `pending_review` IS WRITTEN ONTO THE REGISTER AND COUNTED BY NOBODY.
 *
 *   THE OWNER, looking at the module breakdown 049 now produces: Export Hub 5,
 *   Export Onboarding 1 — against 20,435 WAVE and 1,791 Marketplace. Then:
 *   "check the export registration statuses".
 *
 *   TWO COLLECTIONS, ONE VOCABULARY, AND A GAP BETWEEN THEM.
 *
 *     export_onboarding_applications   the detailed form. Created with
 *                                      `status: "pending_review"`.
 *     serviceRegistrations.export      the REGISTER — #835's word — maintained
 *                                      by every enrolment path, and what every
 *                                      count reads.
 *
 *   `pending_review` is NOT in ACTIVE_REGISTRATION_STATUSES and never was. It
 *   is the application vocabulary, not the registration vocabulary, and three
 *   code paths copy one to the other:
 *
 *     _ex_onboarding.ts:351   status = appData.status === "pending_review"
 *                                 ? "pending_approval" : appData.status
 *     data-recovery.ts:279    status = exportData.status === "pending_review"
 *                                 ? "pending" : exportData.status
 *     _ex_onboarding.ts:372   "serviceRegistrations.export.status": legacyStatus
 *
 *   THE THIRD ONE NORMALISES NOTHING. `legacyStatus` is `legacyData?.status`
 *   straight off the application row — so the legacy sync writes
 *   `pending_review` onto the register, where it matches neither
 *   ACTIVE_REGISTRATION_STATUSES (so the account is not an Export Hub
 *   registration) nor the onboarding slice (so it is not in review either).
 *   The person has applied, and appears in no count.
 *
 *   AND THE FIRST TWO DISAGREE WITH EACH OTHER — one maps to
 *   `pending_approval`, the other to `pending`. Both are accepted, so the
 *   totals are unaffected today; it is two spellings of one fact, which is how
 *   the third path came to have none.
 *
 * ── WHAT THIS DOES NOT CLAIM ────────────────────────────────────────────────
 *
 *   That this explains Export Hub reading 5. It cannot be established from
 *   here: the register may genuinely hold five, or it may hold hundreds of
 *   `pending_review` rows this repairs. #835 already records that the register
 *   and the detailed collection can disagree, which is why
 *   `registerIsUsable()` exists to choose between them.
 *
 *   `scripts/export-registration-statuses.sql` answers it in one read — every
 *   distinct status on both sides, side by side. This fixes the leak; that
 *   query measures it.
 */

import { ACTIVE_REGISTRATION_STATUSES } from "@/lib/module-registration-status";

/**
 * The application vocabulary's spelling, and the registration vocabulary's.
 *
 * Only ONE entry, and it is the whole finding: `pending_review` is what
 * _ex_onboarding writes onto the application, and it means the same thing the
 * register calls `pending_approval` — the value that same file writes onto the
 * register on the live path.
 */
const APPLICATION_TO_REGISTER: Record<string, string> = {
    pending_review: "pending_approval",
};

/**
 * Translate an application status into the register's vocabulary.
 *
 * A status already in ACTIVE_REGISTRATION_STATUSES passes through untouched.
 * So does anything else — `rejected` is a real outcome that belongs on the
 * register and is deliberately not an active registration, and an unknown
 * value is preserved rather than guessed at, for the reason #908 gives about
 * accountType: rewriting a stored value because this function has not heard of
 * it is a quiet loss, and the read side already falls through safely.
 *
 * Absent or blank becomes `pending_approval`: the caller has an application in
 * hand, so the person has applied.
 */
export function registerStatusForExportApplication(applicationStatus: unknown): string {
    const raw = typeof applicationStatus === "string" ? applicationStatus.trim() : "";
    if (!raw) return "pending_approval";

    return APPLICATION_TO_REGISTER[raw.toLowerCase()] ?? raw;
}

/** Is this a status the module-registration counts will see as live? */
export function isCountedAsActiveRegistration(status: unknown): boolean {
    const raw = typeof status === "string" ? status.trim().toLowerCase() : "";
    return (ACTIVE_REGISTRATION_STATUSES as readonly string[]).includes(raw);
}
