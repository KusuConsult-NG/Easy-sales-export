/**
 * May this account sell on the marketplace?
 *
 * ONE QUESTION, SIX SPELLINGS, AND THE APPROVAL PATH ANSWERED IN A VOCABULARY
 * NONE OF THEM READ.
 *
 * Reported as "sellers still can't edit products". Two independent causes, both
 * executed against the real actions before this module existed:
 *
 *   A seller with `roles: ["seller"]` and `sellerVerificationStatus: "approved"`
 *       passed.
 *   A seller with `serviceRegistrations.marketplace.status: "approved"`
 *       was told "You must have seller role to update products".
 *   A seller holding `marketplace_seller`
 *       was told the same.
 *
 * CAUSE 1 — THE ROLE. `marketplace_seller` is a first-class role in
 * lib/types/roles.ts, commented there as "(new standardized role)", with an
 * entry in the hierarchy and a display name. admin/_marketplace.ts knows to
 * accept both spellings — `roles.includes("seller") || roles.includes("marketplace_seller")`
 * — and so does cms.ts. The gates that decide whether somebody may LIST or EDIT
 * a product asked for the literal "seller" alone.
 *
 * CAUSE 2 — THE APPROVAL. marketplace/_mp_onboarding.ts heals a seller whose
 * approval lives on their SELLER_VERIFICATIONS document by writing
 *
 *     "serviceRegistrations.marketplace.status": "approved"
 *     "serviceRegistrations.marketplace.accountType": accountType
 *
 * onto the user document — and neither `sellerVerificationStatus` nor the
 * `seller` role. Both product gates read exactly those two. So the marketplace
 * screens told the seller they were approved while the product screens refused
 * them, from the same user document, on the same page load.
 *
 * `serviceRegistrations[module].status` is the vocabulary the platform settled
 * on: lib/module-access-check.ts reads it for every module's access decision,
 * and every onboarding flow writes it. `sellerVerificationStatus` is the legacy
 * field — _mp_onboarding.ts's own resolution order puts it second.
 *
 * WHAT THIS MODULE IS NOT. It does not decide who becomes a seller, and it does
 * not widen who may. It reads the same approval the admin routes write, in both
 * of the vocabularies the platform uses to write it, so that six gates asking
 * one question cannot keep giving three answers.
 */

/**
 * Every role that means "this account may sell".
 *
 * Exported so a test can assert the set rather than restate it, and so a
 * seventh gate has something to import instead of typing a string.
 */
export const SELLER_ROLES: readonly string[] = ["seller", "marketplace_seller"];

/** Statuses that mean the seller application was granted. */
const APPROVED_STATUSES: readonly string[] = ["approved", "active"];

type Userish = Record<string, any> | null | undefined;

/** Account types on a marketplace registration that mean "sells". */
export const SELLING_ACCOUNT_TYPES: readonly string[] = ["seller", "both"];

/** Does this account hold a role that permits selling? */
export function holdsSellerRole(roles: unknown): boolean {
    if (!Array.isArray(roles)) return false;
    return roles.some((r) => typeof r === "string" && SELLER_ROLES.includes(r));
}

/**
 * Does the account's own APPROVED marketplace registration say it sells?
 *
 * THE ROLES ARRAY IS A CACHE OF THIS, AND THE HEALING PATH DOES NOT FILL IT.
 * _mp_onboarding.ts writes `serviceRegistrations.marketplace.status:
 * "approved"` and `.accountType: "seller"` when it heals a seller whose
 * approval lives on their SELLER_VERIFICATIONS document — and grants no role.
 * So the platform's own record says "approved seller" while the roles array is
 * silent, and a gate that reads only the roles array refuses the very account
 * the record describes.
 *
 * Same reasoning as module-access-check.ts, which grants a module's role from
 * exactly this field when the roles array has not caught up. This does not
 * widen anything: an unapproved or buyer-only registration is no answer at all.
 */
export function registrationSaysSeller(userData: Userish): boolean {
    const marketplace = userData?.serviceRegistrations?.marketplace;
    const status = marketplace?.status;
    if (typeof status !== "string" || !APPROVED_STATUSES.includes(status)) return false;

    const accountType = marketplace?.accountType;
    return typeof accountType === "string" && SELLING_ACCOUNT_TYPES.includes(accountType);
}

/**
 * Has this account's seller application been granted?
 *
 * Reads BOTH vocabularies: the canonical
 * `serviceRegistrations.marketplace.status` that every onboarding flow and
 * module-access-check use, and the legacy `sellerVerificationStatus` that the
 * admin approval routes still write.
 */
export function isSellerApproved(userData: Userish): boolean {
    const legacy = userData?.sellerVerificationStatus;
    if (typeof legacy === "string" && APPROVED_STATUSES.includes(legacy)) return true;

    const canonical = userData?.serviceRegistrations?.marketplace?.status;
    return typeof canonical === "string" && APPROVED_STATUSES.includes(canonical);
}

/**
 * The whole gate, and the reason when it refuses.
 *
 * Returns `null` when the caller may sell. The messages are the ones the
 * product actions already showed, kept verbatim so a seller who was seeing one
 * of them does not now see different words for the same refusal.
 */
export function sellerRefusalReason(userData: Userish, verb: "create" | "update"): string | null {
    if (!holdsSellerRole(userData?.roles) && !registrationSaysSeller(userData)) {
        return `You must have seller role to ${verb} products`;
    }
    if (!isSellerApproved(userData)) {
        return "Your seller account must be approved first";
    }
    return null;
}
