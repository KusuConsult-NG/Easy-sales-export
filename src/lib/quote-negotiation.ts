/**
 * The rules of a price negotiation, in one place and with no database in them.
 *
 *   #873 A BUYER COULD ASK A SELLER FOR A PRICE AND THE SELLER COULD NOT ANSWER.
 *
 *   THE OWNER: "there is a senerio where a buyer wants to ask for discount on
 *   certain product/property, how can that be wired in the app?" — and then:
 *   "build the pending flow".
 *
 *   MEASURED FIRST. `marketplace_quotes` already exists and already means "a
 *   buyer is asking this seller about a price". What did not exist was the other
 *   half, and both quote screens say so in their own headers:
 *
 *       BuyerQuotesClient: "There is no seller-response flow in this codebase —
 *       nothing writes a quoted price, a rejection, or anything else onto a
 *       quote after it is created. Every quote is therefore 'pending'."
 *
 *       SellerQuotesClient: "Reply by email — there is no in-app quoting yet."
 *
 *   So the discount ask is not a new record. It is the record that is already
 *   there, with a FIGURE on it and a reply.
 *
 * ── WHY THE RULES LIVE HERE AND NOT IN THE ACTION ───────────────────────────
 *
 *   Every one of them decides what a buyer is charged. validateCartItems is the
 *   function that exists because "the price comes from the database, never from
 *   the client", and an accepted quote is the ONE case where the charged price
 *   is not the listed one. That exception has to be as hard to get wrong as the
 *   rule it bends, which means it has to be readable and directly testable —
 *   and a "use server" module cannot be either, because every export of one is a
 *   reachable endpoint.
 *
 * ── THE PART THAT TOUCHES MONEY ─────────────────────────────────────────────
 *
 *   An accepted quote is a licence to pay less than the listing says. Four
 *   things therefore have to be true of it at the moment of charging, and none
 *   of them can be taken from the request:
 *
 *     IT IS HERS.        Quote ids travel — a notification carries one. Without
 *                        the buyer check, anybody could spend anybody's
 *                        discount.
 *
 *     IT IS FOR THIS.    A quote names a product. Applied to a different line it
 *                        is a discount the seller never gave on goods they never
 *                        discussed.
 *
 *     IT IS FOR THIS MANY. A bulk price is cheap BECAUSE of the volume. The
 *                        agreed price applies to the agreed quantity and to no
 *                        other — this is the same rule #571 already enforces on
 *                        pricing tiers, where naming `bulk` with `quantity: 1`
 *                        bought one unit at the bulk rate.
 *
 *     IT IS STILL GOOD.  A price agreed in March cannot be spent in December.
 *                        The listing moves; the agreement does not.
 *
 *   And one that is not about the buyer at all: an accepted quote NEVER RAISES
 *   THE PRICE. If the listing has fallen below what was agreed, the listing
 *   wins. Nobody should be punished for having negotiated.
 */

/**
 * How long an accepted price stands.
 *
 *   Long enough to be useful and short enough that it cannot outlive the
 *   listing it was agreed against. Fourteen days is the same order as the
 *   thirty-day offer window #867 uses for a price reduction; shorter, because
 *   this is one seller's promise to one buyer rather than a public price.
 */
export const QUOTE_ACCEPTANCE_DAYS = 14;

/** The statuses a quote can hold. `pending` is what submission writes. */
export const QUOTE_STATUSES = ["pending", "countered", "accepted", "declined"] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export interface QuoteRecord {
    buyerId?: string;
    sellerId?: string;
    productId?: string;
    subjectType?: "product" | "export_window";
    quantity?: number;
    status?: string;
    /** What the buyer proposed per unit, if they proposed anything. */
    offeredPrice?: number;
    /** The listing's price when the request was made, read from the product. */
    listedPrice?: number;
    /** What the seller proposed back. */
    counterPrice?: number;
    /** The figure both sides settled on. Only meaningful when accepted. */
    agreedPrice?: number;
    /** ISO string. Written when the quote reaches `accepted`. */
    acceptedAt?: string;
    /** Set once the discount has been spent, so it cannot be spent twice. */
    consumedByOrderId?: string;
}

/** A finite, positive number, or null. Strings arrive from forms and JSONB. */
export function positiveNumber(value: unknown): number | null {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Did the caller give a figure at all?
 *
 *   NOT THE SAME QUESTION AS "is it a usable figure", and conflating the two is
 *   how a typed 0 turns into a blank field. `positiveNumber` answers null for
 *   BOTH "nothing was sent" and "-50 was sent", so a buyer who types 0 into the
 *   offer box would have their quote filed as a plain "what would you charge?"
 *   and never learn the number was dropped.
 *
 *   An empty string counts as absent: that is what an untouched number input
 *   submits, and it genuinely means the buyer did not offer anything.
 */
export function offerWasGiven(value: unknown): boolean {
    if (value === undefined || value === null) return false;
    if (typeof value === "string" && value.trim() === "") return false;
    return true;
}

/**
 * When an accepted quote stops being spendable.
 *
 *   Returns null when the quote has no acceptance date — which is not the same
 *   as "never expires". Callers treat a missing date as unusable; see
 *   quoteRefusal.
 */
export function quoteExpiresAt(quote: QuoteRecord): Date | null {
    if (!quote.acceptedAt) return null;
    const at = new Date(quote.acceptedAt);
    if (Number.isNaN(at.getTime())) return null;
    return new Date(at.getTime() + QUOTE_ACCEPTANCE_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * Why this quote may NOT be used to price this cart line, or null if it may.
 *
 *   A refusal STRING rather than a boolean, and every branch names something the
 *   buyer can act on. "Invalid quote" on a checkout screen is a dead end; "the
 *   agreed price was for 500 bags" tells them what to change.
 *
 *   REFUSING, NOT QUIETLY REPRICING. A cart line that names a quote it cannot
 *   use could be charged the list price instead, and that is the one thing this
 *   must not do: charging a total the buyer was never shown is the defect this
 *   audit has spent most of its time removing.
 */
export function quoteRefusal(
    quote: QuoteRecord | null | undefined,
    line: {
        buyerId: string;
        productId: string;
        quantity: number;
        productName?: string;
        /**
         *   Who is being paid. Optional, because a caller that cannot establish
         *   it should not be forced to invent one — when it IS known it is
         *   checked, because an agreement is with a PERSON and not with a row.
         */
        sellerId?: string;
    },
    now: Date = new Date(),
): string | null {
    const name = line.productName || "this item";

    if (!quote) return `The agreed price for ${name} could not be found.`;

    //   Ownership before anything else: the remaining messages describe a quote,
    //   and describing somebody else's quote to a stranger is a disclosure.
    if (!quote.buyerId || quote.buyerId !== line.buyerId) {
        return `That agreed price does not belong to this account.`;
    }

    if (quote.subjectType === "export_window") {
        //   An export window is a booking, not a cart line. Its own flow prices
        //   it; letting one through here would charge a marketplace order
        //   against a figure agreed for a container.
        return `Export window quotes cannot be used in the marketplace cart.`;
    }

    if (quote.productId !== line.productId) {
        return `The agreed price for ${name} was for a different listing.`;
    }

    /*
     *   AND WITH THE PERSON WHO AGREED IT.
     *
     *   A listing can change hands — fulfilling a land purchase rewrites
     *   `ownerId`, which is the whole point of it. An agreed price is one
     *   seller's promise, and honouring it against a NEW owner pays somebody
     *   else a discount they never gave.
     */
    if (line.sellerId && quote.sellerId && quote.sellerId !== line.sellerId) {
        return `The agreed price for ${name} was with a different seller.`;
    }

    if (quote.status !== "accepted") {
        return quote.status === "countered"
            ? `The seller countered your offer for ${name}. Accept or decline it before checking out.`
            : quote.status === "declined"
                ? `The seller declined your offer for ${name}.`
                : `The seller has not responded to your offer for ${name} yet.`;
    }

    if (quote.consumedByOrderId) {
        return `The agreed price for ${name} has already been used on order ${quote.consumedByOrderId}.`;
    }

    const expires = quoteExpiresAt(quote);
    if (!expires) {
        //   Accepted with no date is a row this code did not write. It cannot be
        //   aged, so it cannot be trusted with a discount.
        return `The agreed price for ${name} is missing its date and cannot be used.`;
    }
    if (now.getTime() > expires.getTime()) {
        return `The agreed price for ${name} expired on ${expires.toISOString().slice(0, 10)}.`;
    }

    const agreed = positiveNumber(quote.agreedPrice);
    if (agreed === null) return `The agreed price for ${name} is not a usable figure.`;

    //   EXACTLY the agreed quantity. See the header: a volume price is cheap
    //   because of the volume, and #571 already refuses the same trick on tiers.
    const agreedQuantity = positiveNumber(quote.quantity);
    if (agreedQuantity === null || agreedQuantity !== line.quantity) {
        return agreedQuantity === null
            ? `The agreed price for ${name} records no quantity and cannot be used.`
            : `The agreed price for ${name} was for ${agreedQuantity}, not ${line.quantity}.`;
    }

    return null;
}

/**
 * What to charge per unit for a line that carries a usable quote.
 *
 *   NEVER ABOVE THE LISTING. The seller's own current price is the ceiling, so
 *   a quote can only ever make a line cheaper. A buyer who agreed ₦1,000 and
 *   comes back to find the listing at ₦900 pays ₦900.
 */
export function chargeablePrice(agreedPrice: number, listedPrice: number): number {
    if (!Number.isFinite(listedPrice) || listedPrice <= 0) return agreedPrice;
    return Math.min(agreedPrice, listedPrice);
}

/**
 * Why this offer may not be made, or null.
 *
 *   The buyer's own figure, checked before anything is written. A request to pay
 *   MORE than the listing is not a discount request — it is either a mistake or
 *   a misread field, and a seller who "accepts" it has agreed to overcharge
 *   somebody.
 */
export function offerRefusal(
    offeredPrice: number | null,
    listedPrice: number,
    /**
     *   The RAW value, so "nothing was typed" and "0 was typed" can be told
     *   apart. Omitted, it defaults to the parsed figure, and a caller that has
     *   already established the field was blank loses nothing.
     */
    raw: unknown = offeredPrice,
): string | null {
    if (offeredPrice === null) {
        //   Asking with no figure is still a valid RFQ — but only when there
        //   really was no figure.
        return offerWasGiven(raw)
            ? "Your offer must be a number greater than zero."
            : null;
    }
    if (Number.isFinite(listedPrice) && listedPrice > 0 && offeredPrice > listedPrice) {
        return "Your offer is higher than the listed price. Buy it at the listed price instead.";
    }
    return null;
}

/**
 * Why this seller response may not be recorded, or null.
 *
 *   A counter with no figure is a decline wearing a different word, and a
 *   counter ABOVE the listing charges the buyer more for having negotiated.
 */
export function responseRefusal(
    decision: string,
    price: number | null,
    listedPrice: number,
    /** The raw value, for the same reason offerRefusal takes one. */
    raw: unknown = price,
): string | null {
    if (decision !== "accept" && decision !== "counter" && decision !== "decline") {
        return "Choose whether to accept, counter or decline.";
    }
    if (decision !== "counter") return null;

    if (price === null) {
        return offerWasGiven(raw)
            ? "A counter offer must be a number greater than zero."
            : "A counter offer needs a price.";
    }
    if (Number.isFinite(listedPrice) && listedPrice > 0 && price > listedPrice) {
        return "A counter offer cannot be higher than your listed price.";
    }
    return null;
}
