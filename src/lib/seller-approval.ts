/**
 * IS THIS ACCOUNT AN APPROVED SELLER — asked once, for every door that asks it.
 *
 *   #885 THE PLATFORM APPROVED A SELLER IN ONE VOCABULARY AND ASKED ABOUT IT IN
 *        THE OTHER.
 *
 *   THE OWNER: "sellers still can't edit products".
 *
 *   MEASURED, and the seller really is approved — just not in the field the
 *   product doors read. Two vocabularies describe one fact:
 *
 *       serviceRegistrations.marketplace.status     the V2 field. What
 *                                                   checkMarketplaceStatus
 *                                                   returns, so it is what the
 *                                                   onboarding screen, the
 *                                                   seller dashboard and the
 *                                                   sidebar all believe.
 *       sellerVerificationStatus                    the legacy field.
 *                                                   _mp_onboarding.ts calls it
 *                                                   that in as many words —
 *                                                   "FALLBACK 2: Check legacy
 *                                                   sellerVerificationStatus".
 *
 *   FIVE DOORS GATE ON THE LEGACY FIELD ALONE:
 *
 *       _mp_products.ts            createProductAction, updateProductAction
 *       api/marketplace/create-product
 *       village-market.ts          joining a Village Market event
 *       order-management.ts        the seller's own orders (role half)
 *
 *   AND THE HEAL ONLY EVER RAN ONE WAY. _mp_onboarding.ts finds an approved
 *   SELLER_VERIFICATIONS record and backfills the user document with
 *   `serviceRegistrations.marketplace.status: "approved"` — and nothing else.
 *   Not the legacy field, not the `seller` role. Its own three fallbacks below
 *   copy legacy -> V2 and never V2 -> legacy, so once a seller is healed
 *   through that door the two fields disagree permanently.
 *
 *   WHAT THAT IS LIKE TO USE. Every screen tells her she is an approved seller.
 *   Her products are listed — the list read has no gate. Edit opens and
 *   prefills — the product read has no gate either. She changes a price, presses
 *   Save, and is told "Your seller account must be approved first". There is
 *   nothing she can do about it and nothing on any screen that agrees with it.
 *
 * ── WHY A PREDICATE AND NOT FIVE MORE CLAUSES ───────────────────────────────
 *
 *   Because five hand-written copies of one rule is how this arrived. #458 put
 *   it as well as it can be put: "two statements of one rule is the defect, not
 *   the cure." The rule is stated here and the doors ask it.
 *
 * ── AND THE ROLE HAS TWO SPELLINGS TOO ──────────────────────────────────────
 *
 *   `marketplace_seller` is a first-class UserRole — types/roles.ts calls it the
 *   "new standardized role" — and it is NOT in LEGACY_ROLE_MAP, so
 *   canonicalRoles leaves it alone and `hasRole(roles, "seller")` is false for
 *   its holder. Six places already know to accept either spelling
 *   (admin/_marketplace, cms, dashboard, analytics); the three seller gates did
 *   not, and module-access-check's marketplace list carries `marketplace_buyer`
 *   while omitting `marketplace_seller` — the pair, half-written.
 *
 *   Today nothing GRANTS `marketplace_seller` (approve-seller grants `seller`),
 *   so this half is latent rather than live, and it is stated that way rather
 *   than claimed as the fix. It is included because the predicate is where the
 *   question belongs, and leaving one spelling out is what produced the other
 *   half of this finding.
 */

import { canonicalRoles } from "./role-aliases";

/**
 * The statuses that mean "this registration is live".
 *
 * Not invented here: getPostLoginRedirect accepts exactly `approved` and
 * `active` for a module registration and nothing else, and the cooperative
 * reader beside it uses the same pair. A third vocabulary for the same idea is
 * what this finding is about.
 */
const LIVE_REGISTRATION_STATUSES: readonly string[] = ["approved", "active"];

/** Both spellings of the marketplace selling role. See the header. */
export const SELLER_ROLES: readonly string[] = ["seller", "marketplace_seller"];

function text(value: unknown): string {
    return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/**
 * Does this user document hold the marketplace selling role, under either
 * spelling?
 *
 * Canonicalised first, so a legacy `vendor` — which LEGACY_ROLE_MAP already
 * resolves to `seller` — is answered the same way the rest of the platform
 * answers it.
 */
export function hasSellerRole(roles: unknown): boolean {
    if (!Array.isArray(roles)) return false;
    const held = canonicalRoles(roles as string[]).map((r) => text(r));
    return SELLER_ROLES.some((r) => held.includes(r));
}

/**
 * Is this account approved to sell, by EITHER of the two records that say so?
 *
 * `suspended` and `rejected` are not "approved" in either vocabulary, so a
 * suspended seller is still refused — which matters, because suspend-seller
 * writes BOTH fields (see its own note, "SUSPENSION SUSPENDED NOTHING") and
 * this must not re-open the door it closed.
 */
export function sellerIsApproved(userData: Record<string, any> | null | undefined): boolean {
    if (!userData) return false;

    if (text(userData.sellerVerificationStatus) === "approved") return true;

    const registration = userData.serviceRegistrations?.marketplace;
    return LIVE_REGISTRATION_STATUSES.includes(text(registration?.status));
}

/**
 * Why this account may not act as a seller, or null when it may.
 *
 * ONE FUNCTION RATHER THAN TWO CALLS AT EACH DOOR, because the doors that had
 * both checks had them in two different orders with two different messages, and
 * a person refused by one of them cannot tell which.
 *
 * `requireRole` is false for the doors that never asked about the role — the
 * Village Market join and the create-product route both gate on approval alone,
 * and widening a gate is not this finding's business.
 */
export function sellerRefusal(
    userData: Record<string, any> | null | undefined,
    { requireRole = true, verb = "update" }: { requireRole?: boolean; verb?: string } = {},
): string | null {
    if (!userData) return "Your seller account must be approved first";

    if (requireRole && !hasSellerRole(userData.roles)) {
        /*
         *   THE VERB IS THE CALLER'S, and this is not cosmetic. The first draft
         *   of this function returned one fixed sentence, so the CREATE door
         *   began telling sellers they could not "update" products. The
         *   behaviour suite pinned the existing wording and caught it — which is
         *   the whole argument for extracting a shared rule underneath messages
         *   rather than flattening the messages into it.
         */
        return `You must have seller role to ${verb} products`;
    }

    if (!sellerIsApproved(userData)) {
        return "Your seller account must be approved first";
    }

    return null;
}
