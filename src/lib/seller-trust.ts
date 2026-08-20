/**
 * Is this seller verified, and what are they called? — one answer, read live.
 *
 * WHAT WAS WRONG
 * --------------
 * The buyer-facing "Verified" shield (marketplace/buyer/products/page.tsx) is
 * rendered from `product.sellerVerified`. That field reached it three different
 * ways, and none of them was the seller's actual badge at the time of display.
 *
 * 1. A SNAPSHOT THAT NEVER REFRESHES
 *    _createProductAction copies `SELLER_VERIFICATIONS.isVerifiedBadge` onto the
 *    product document when the product is created, and nothing updates it after.
 *    _toggleVerifiedBadgeAction writes the badge to the verification record and
 *    to the user document, and touches no products.
 *
 *    So granting the badge does not add it to listings the seller already has —
 *    while the grant email says, in those words, "The badge will now appear on
 *    your storefront and product listings". And REVOKING the badge does not
 *    remove it from any product created while they held it. Revocation did not
 *    revoke.
 *
 * 2. AN ARBITRARY VERIFICATION ROW
 *    That copy read `verificationSnap.docs[0]` from a query with no ordering. A
 *    seller with more than one verification record got whichever row the
 *    database returned first. The seller layout at marketplace/seller/layout.tsx
 *    sorts the same query by createdAt precisely because that happens.
 *
 * 3. A LITERAL `true`
 *    The flash-sale mappers — one in _mp_catalog.ts, one in the buyer products
 *    page — build a Product from a `flash_sale_products` row and hardcoded
 *    `sellerVerified: true`. Every Village Market product therefore claimed a
 *    verified seller, whether or not that seller had ever been verified.
 *
 *    The same mappers hardcoded `rating: 5` with `reviewCount: 0`. The card only
 *    shows a rating when `rating > 0`, so every flash product displayed a
 *    perfect score with no reviews behind it — and "Highest Rated" sorting put
 *    all of them above real products with genuine ratings below 5.
 *
 * ProductSchema already defaults all three of these correctly (`rating: 0`,
 * `sellerVerified: false`, `sellerName: "Easy Sales Seller"`). Every defect
 * above is a mapper overriding a safe default with a claim.
 *
 * THE RULE
 * --------
 * The badge is read from the seller's USER document at display time.
 * _toggleVerifiedBadgeAction already keeps `users.isVerifiedBadge` in sync in
 * the same transaction that writes the verification record, so it is the one
 * place that is correct for both a grant and a revoke. Reading it live means a
 * revoked badge disappears everywhere at once, which is the only behaviour a
 * revocation can have and still be one.
 *
 * The product's own `sellerVerified` field is still written on create — other
 * readers and the export catalog use the shape — but no buyer-facing path
 * trusts it now; it is overwritten from the live value before display.
 *
 * ON THE NAME
 * -----------
 * The fallback for a seller with no name was the string "Verified Seller" in
 * six places. A seller with no business name was therefore *labelled* verified
 * in the name field itself, independently of any badge. ProductSchema and
 * _createProductAction both already used "Easy Sales Seller"; that is the
 * fallback everywhere now. It claims nothing.
 */

/** What to call a seller whose account has no name recorded. Claims nothing. */
export const SELLER_NAME_FALLBACK = "Easy Sales Seller";

export interface SellerTrust {
    sellerName: string;
    sellerVerified: boolean;
}

/**
 * The seller's name and badge, from their user document.
 *
 * `undefined`/`null` userData means the account could not be read, which is not
 * evidence of a badge — it resolves to unverified, deliberately. The absent
 * case has to be the safe one: a deleted or unreadable seller must not inherit
 * a trust marker.
 */
export function resolveSellerTrust(userData: Record<string, any> | null | undefined): SellerTrust {
    const name =
        userData?.businessName ||
        userData?.displayName ||
        userData?.name ||
        SELLER_NAME_FALLBACK;

    return {
        sellerName: String(name),
        // Strictly true. A truthy string or 1 in this column is a data problem,
        // not a badge.
        sellerVerified: userData?.isVerifiedBadge === true,
    };
}

/**
 * Picks the verification record that decides, when a seller has several.
 *
 * `docs[0]` from an unordered query is whichever row came back first, which is
 * how a stale or superseded verification could grant a badge. Newest wins, by
 * the same createdAt comparison marketplace/seller/layout.tsx uses.
 */
export function newestVerification<T extends { createdAt?: any }>(rows: T[]): T | null {
    if (rows.length === 0) return null;

    const millis = (v: any): number => {
        if (!v) return 0;
        if (typeof v?.toMillis === "function") return v.toMillis();
        if (typeof v?.seconds === "number") return v.seconds * 1000;
        if (v instanceof Date) return v.getTime();
        const parsed = Date.parse(String(v));
        return Number.isFinite(parsed) ? parsed : 0;
    };

    return [...rows].sort((a, b) => millis(b.createdAt) - millis(a.createdAt))[0];
}

/**
 * Overwrites sellerName/sellerVerified on a list of products from their
 * sellers' live user documents.
 *
 * One read per UNIQUE seller, not per product — the pattern
 * getActiveFlashSaleProductsAction already used for names. `readUser` is passed
 * in so this module stays free of a database import and can be tested without
 * one.
 *
 * A product whose seller cannot be read keeps its name (there is nothing better
 * to show) but loses the badge, for the reason in resolveSellerTrust.
 */
export async function hydrateSellerTrust<T extends { sellerId?: string; sellerName?: string }>(
    products: T[],
    readUser: (sellerId: string) => Promise<Record<string, any> | null>,
): Promise<T[]> {
    const ids = Array.from(new Set(products.map((p) => p.sellerId).filter(Boolean))) as string[];
    if (ids.length === 0) {
        return products.map((p) => ({ ...p, sellerVerified: false }));
    }

    const trust = new Map<string, SellerTrust>();
    await Promise.all(
        ids.map(async (id) => {
            try {
                trust.set(id, resolveSellerTrust(await readUser(id)));
            } catch {
                // A failed read is not a verified seller.
                trust.set(id, { sellerName: SELLER_NAME_FALLBACK, sellerVerified: false });
            }
        }),
    );

    return products.map((p) => {
        const resolved = p.sellerId ? trust.get(p.sellerId) : undefined;
        return {
            ...p,
            sellerName:
                resolved && resolved.sellerName !== SELLER_NAME_FALLBACK
                    ? resolved.sellerName
                    : p.sellerName || SELLER_NAME_FALLBACK,
            sellerVerified: resolved?.sellerVerified === true,
        };
    });
}
