/**
 *   #485 "VERIFIED" MEANT "A NUMBER WAS TYPED", AND EVERY SCREEN SAID VERIFIED.
 *
 *   The owner asked for the external identity provider to be commented out and
 *   referenced nowhere. Doing only that would have left the platform in its
 *   worst possible state, because that provider was the only thing that could
 *   ever have made the word true — and it was already not being called.
 *
 *   Swept, every path that sets a KYC flag:
 *
 *     actions/kyc.ts            'kyc.bvnVerified': true, 'kyc.bvnStatus': 'verified'
 *                               written with no check of any kind
 *     api/kyc/verify-bvn        returns { isMatch: true }, never calls anything
 *     api/kyc/verify-nin        returns { isMatch: true }, never calls anything
 *     api/admin/kyc/verify-…    logs "Bypassing live verification", writes
 *                               verified, and tells the admin "BVN verified
 *                               successfully" under a button named after the
 *                               provider
 *     cooperative registration  bvnVerified: bvn ? true : false   (×3 sites)
 *     admin/_applications       userUpdate.bvnVerified = val("bvn") ? true : false
 *     admin/_legacy             bvnVerified: !!data.bvn
 *
 *   Seven places, one meaning: THE MEMBER SUPPLIED DIGITS. Nobody checked them
 *   against anything. The admin user list then renders a green "Verified" badge
 *   off that flag, and an operator deciding whether to trust a seller, approve a
 *   loan or release a payout reads it as an identity check that happened.
 *
 * ── WHAT THIS MODULE CHANGES, AND WHAT IT DELIBERATELY DOES NOT ──────────────
 *
 *   IT DOES NOT TOUCH `bvnVerified` / `ninVerified`. That was the tempting fix
 *   and it is the one that would have taken the platform down. Those booleans
 *   are load-bearing: export onboarding refuses to continue while `kycData.bvn`
 *   is set and `kycData.bvnVerified` is not (KYCVerificationStep.tsx, and again
 *   in export/onboarding/page.tsx), and updateOverallKYCStatus computes
 *   `kyc.status` from them — which broadcast targeting reads to build the
 *   "verified users" audience. Flipping them to false would have stopped
 *   onboarding for every new member and silently emptied a broadcast segment.
 *   The owner's complaint about this platform is that fixes break it. So the
 *   gates keep the exact value they have today.
 *
 *   WHAT IT ADDS IS THE MISSING FACT: HOW the flag came to be set. A number the
 *   member typed and an identity a named admin confirmed are both "verified"
 *   today and are not the same thing, and the screens can only tell the truth if
 *   the data records which one happened.
 *
 *       self_declared        the member supplied it; nothing checked it
 *       manual_admin_review  a named admin confirmed it, recorded with their id
 *
 *   `bvnStatus` moves from 'verified' to those values. Nothing gates on that
 *   string — swept: it is read by the admin list for display and by
 *   DynamicDetailModal's exclude list, and by nothing that decides anything —
 *   so it is the safe place to put the truth.
 *
 *   AND A RECORD WITH NO METHOD IS `self_declared`, NOT VERIFIED. Every row
 *   written before today carries no method, and every one of them was written
 *   by one of the seven paths above. Treating an absent method as "verified"
 *   would exempt the entire existing user base from the finding — which is the
 *   whole population it is about.
 *
 * ── THE PARKED PROVIDER ─────────────────────────────────────────────────────
 *
 *   Parked, per the owner, and referenced by nothing that runs. The provider
 *   module stays on disk — 378 lines of real, repaired integration (#184's
 *   resolveMatch allowlist among them) — because the owner's standing rule is to
 *   fix rather than destroy, and deleting it would throw away work that has to
 *   be redone if it ever returns. Nothing imports it, and
 *   the-identity-provider-is-parked.test.ts asserts that, so it cannot creep
 *   back in through a new file. That module is the ONE place its name still
 *   appears, deliberately: a name scattered through thirty files is a name
 *   somebody re-wires by accident.
 */

/** How a KYC identity number came to carry a verification flag. */
export type IdentityVerificationMethod = 'self_declared' | 'manual_admin_review';

/**
 * The automated identity provider currently in service.
 *
 * `none` is the true answer and is stated once, here, so a screen or an action
 * asking "is this checked automatically?" cannot get a different answer in two
 * places (#390). Restoring the provider means changing this and re-wiring the
 * routes it names — not flipping a flag somewhere and hoping the rest follows.
 */
export const IDENTITY_PROVIDER = 'none' as const;

/** The field names a KYC identity uses, for a given prefix. */
export type IdentityField = 'bvn' | 'nin';

export interface IdentityRecord {
    verified?: boolean;
    status?: string;
    method?: string;
}

/**
 * The write a SELF-DECLARED identity produces.
 *
 * `verified` keeps the value the gates depend on. `status` and `method` say
 * what actually happened.
 */
export function selfDeclaredFields(field: IdentityField): Record<string, unknown> {
    return {
        [`${field}Verified`]: true,
        [`${field}Status`]: 'self_declared',
        [`${field}VerificationMethod`]: 'self_declared',
    };
}

/**
 * The write an ADMIN'S MANUAL CONFIRMATION produces.
 *
 * The admin's id is not decoration: it is the only thing that makes this
 * different from the line above, and the only thing an operator can follow up
 * when a verification turns out to be wrong.
 */
export function manuallyVerifiedFields(
    field: IdentityField,
    adminId: string,
): Record<string, unknown> {
    return {
        [`${field}Verified`]: true,
        [`${field}Status`]: 'verified',
        [`${field}VerificationMethod`]: 'manual_admin_review',
        [`${field}VerifiedBy`]: adminId,
    };
}

/**
 * The method a stored record carries.
 *
 * An unrecognised or absent value is `self_declared` — see the note above about
 * the existing user base.
 */
export function verificationMethod(record: IdentityRecord | undefined | null): IdentityVerificationMethod {
    return record?.method === 'manual_admin_review' ? 'manual_admin_review' : 'self_declared';
}

/**
 * Whether an identity has actually been CHECKED BY SOMEBODY.
 *
 * Distinct from the `verified` boolean on purpose. Use this wherever a screen
 * is about to tell an operator that an identity is confirmed.
 */
export function isIdentityChecked(record: IdentityRecord | undefined | null): boolean {
    return record?.verified === true && verificationMethod(record) === 'manual_admin_review';
}

/** Whether the member supplied the number at all. */
export function isIdentityProvided(record: IdentityRecord | undefined | null): boolean {
    return record?.verified === true;
}

/** What a badge should say. One statement, so no two screens disagree. */
export function identityBadge(
    provided: boolean,
    record: IdentityRecord | undefined | null,
): { label: string; tone: 'checked' | 'declared' | 'missing'; title: string } {
    if (!provided) {
        return { label: 'Not provided', tone: 'missing', title: 'Not provided' };
    }
    if (isIdentityChecked(record)) {
        return { label: 'Verified', tone: 'checked', title: 'Verified by an admin review' };
    }
    return {
        label: 'Self-declared',
        tone: 'declared',
        title: 'Supplied by the member and not independently checked',
    };
}
