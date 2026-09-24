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

/**
 * Names that are not names.
 *
 * Two of the four old fallbacks are claims rather than labels: a seller with no
 * business name was *called* "Verified Seller" in the name field, independently
 * of any badge, and "Unknown Seller" says the row could not be read. Both were
 * written into product documents before this module existed, so they are still
 * sitting in rows created back then — which only matters for a reader that
 * shows a product's stored name without reading the seller.
 */
const NOT_A_NAME = new Set(["", "verified seller", "unknown seller"]);

/**
 * A product's stored seller name, made safe to show without a seller read.
 *
 * `hydrateSellerTrust` never needed this: it replaces the stored name with the
 * live one. A reader that deliberately does not read the seller does need it,
 * or a row written in 2024 puts the word "Verified" under a card that is
 * showing no badge at all.
 */
export function storedSellerName(name: unknown): string {
    const trimmed = typeof name === "string" ? name.trim() : "";
    return NOT_A_NAME.has(trimmed.toLowerCase()) ? SELLER_NAME_FALLBACK : trimmed;
}

/**
 * Show these products with NO badge, and read no seller to decide it.
 *
 * WHY A SECOND ANSWER EXISTS
 * --------------------------
 * `hydrateSellerTrust` is one round trip per unique seller, and it happens
 * after the products come back — the seller ids are not known until then, so it
 * cannot be started earlier. It is a second generation of latency, whatever the
 * read count says.
 *
 * On the screens where a buyer is judging a seller — the product detail page,
 * search results, the buyer catalogue — that round trip is the badge being
 * true, and it stays.
 *
 * On the three-card "recommended" strip on the marketplace landing page and the
 * buyer dashboard, neither card has ever rendered a shield: both render the
 * seller's NAME and nothing else. The round trip was buying a field no screen
 * displayed. Dropping the badge there is a product decision about where the
 * badge earns its latency, and this is what it means in code.
 *
 * `sellerVerified: false` is set EXPLICITLY, not left to the product's own
 * field. The stored value is the create-time snapshot — the thing this whole
 * module exists because of — so a reader that stops resolving the badge must
 * also stop serving the snapshot, or a revoked seller keeps a badge here that
 * every other screen has taken away. Absent, not stale.
 */
export function withoutSellerBadge<T extends { sellerName?: string }>(products: T[]): T[] {
    return products.map((p) => ({
        ...p,
        sellerName: storedSellerName(p.sellerName),
        sellerVerified: false,
    }));
}
