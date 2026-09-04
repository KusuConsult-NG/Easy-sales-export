/**
 * Saving something for later — one operation, for both things the app offers it on.
 *
 *   #105 TWO CONTROLS PERSISTED NOTHING, AND BOTH LOOKED LIKE THEY WORKED.
 *
 *        (a) THE BUYER DASHBOARD'S "SAVED SELLERS" TILE.
 *
 *            _mp_buyer_dashboard.ts read it like this:
 *
 *                const savedSellers = buyerDoc.data()?.savedSellersCount ?? 0;
 *
 *            `savedSellersCount` was read in that one place and written in
 *            none. There was no save-a-seller action, no collection, and no
 *            control anywhere in the app that could have produced the number.
 *            The tile was structurally 0 for every buyer who has ever used the
 *            platform — the same shape as #100, where the Active Orders tile
 *            read a field nothing wrote.
 *
 *        (b) THE HEART ON A FARM NATION PROPERTY.
 *
 *            farm-nation/property/[id] rendered a filled/unfilled heart backed
 *            by `useState(false)`. It filled when clicked, and the state died
 *            with the component: navigating away, or reloading, lost it. And
 *            `favoriteCount`, which _fn_listings.ts initialises to 0 on every
 *            new listing, was incremented by nothing — so it was a second
 *            permanently-zero field, sitting beside the control that was
 *            supposed to move it.
 *
 *        BOTH ARE THE SAME OPERATION. A saved seller and a saved property are
 *        one idea — "keep this, I want to find it again" — differing only in
 *        what is pointed at. Building them separately would have produced two
 *        collections, two toggles and two counts that drift, which is the shape
 *        this codebase keeps having to unpick. So there is one collection, one
 *        toggle, and one definition of what a save IS, here.
 *
 * UNSAVING RETIRES THE ROW, IT DOES NOT DESTROY IT
 * ------------------------------------------------
 * `saved: false` — the row stays, with `unsavedAt` recording when. That is the
 * standing rule for this codebase (#300 through #304 converted four delete
 * doors to exactly this), and a bookmark is no exception: a row that is deleted
 * and re-created loses the fact that this buyer had saved this seller once
 * before, which is the only thing the row is for.
 *
 * A DETERMINISTIC ID IS THE UNIQUENESS GUARANTEE
 * ----------------------------------------------
 * savedItemDocId() derives the document id from (userId, itemType, targetId),
 * so a double-click, a retry, or two tabs cannot produce two rows for one
 * saved thing. There is no `where` query to race and no lock to take, because
 * there is only ever one row to write.
 *
 * NOT PART OF THE ERASURE SET, DELIBERATELY
 * -----------------------------------------
 * A saved_items row holds a user id, a type, a target id and two timestamps.
 * It carries no name, no contact detail and no identity document, so it is not
 * in the eight collections lib/module-application-erasure.ts scrubs — those
 * exist because a member's identity was COPIED onto them. Erasure scrubs the
 * user row this id points at; a bookmark pointing at a scrubbed row is not
 * personal data.
 *
 * This module is pure and imports nothing, so a suite that mocks the database
 * layer cannot break it — #381's lesson.
 */

/** The things this platform lets somebody save. */
export const SAVED_ITEM_TYPES = ["marketplace_seller", "land_listing"] as const;

export type SavedItemType = (typeof SAVED_ITEM_TYPES)[number];

export function isSavedItemType(value: unknown): value is SavedItemType {
    return (SAVED_ITEM_TYPES as readonly string[]).includes(String(value ?? ""));
}

/**
 * What separates the three parts of a saved-item document id.
 *
 * Two underscores rather than one because a user id or a listing id may well
 * contain a single one. savedItemDocId refuses any part containing this
 * sequence, which is what keeps the mapping one-to-one: without that refusal
 * ("a__b", "x") and ("a", "b__x") would collide, which is #104 — the escrow id
 * whose two halves could run together — in a different collection.
 */
export const SAVED_ITEM_ID_SEPARATOR = "__";

/**
 * The document id for one person saving one thing.
 *
 * Returns null when any part is unusable, and the caller refuses rather than
 * writing a row under a guessed id.
 */
export function savedItemDocId(
    userId: unknown,
    itemType: unknown,
    targetId: unknown,
): string | null {
    const uid = String(userId ?? "").trim();
    const tid = String(targetId ?? "").trim();

    if (!uid || !tid) return null;
    if (!isSavedItemType(itemType)) return null;
    if (uid.includes(SAVED_ITEM_ID_SEPARATOR)) return null;
    if (tid.includes(SAVED_ITEM_ID_SEPARATOR)) return null;

    return `${uid}${SAVED_ITEM_ID_SEPARATOR}${itemType}${SAVED_ITEM_ID_SEPARATOR}${tid}`;
}

/**
 * Is this stored row currently a save?
 *
 * A row with no `saved` key at all is treated as SAVED, because the only writer
 * that omits it would be one from before this field existed, and the row exists
 * because somebody saved something. An explicit `false` — and only that — is an
 * unsave.
 *
 * The comparison is written against the string as well as the boolean on
 * purpose: the adapter stores this document in raw_data JSONB and a `where`
 * on it compares as TEXT, so a row can come back with "false" where it was
 * written with false. Nothing here queries on the field for that reason, but a
 * row read back must still be read correctly.
 */
export function isSavedRow(row: { saved?: unknown } | null | undefined): boolean {
    const raw = row?.saved;
    if (raw === undefined || raw === null) return true;
    return raw !== false && raw !== "false";
}

/**
 * The most saved rows one person's list will read.
 *
 * A query with no limit returns at most 5,000 rows from this adapter and says
 * nothing about it, which is how a list silently becomes a partial list. This
 * is far above any real saved list and far below that ceiling, so the cap is
 * reached only by something that is not a person browsing.
 */
export const SAVED_ITEMS_PER_USER_CAP = 500;

/** Where each kind of saved thing lives, for the screens that list them. */
export const SAVED_ITEM_ROUTES: Readonly<Record<SavedItemType, string>> = {
    marketplace_seller: "/marketplace/sellers",
    land_listing: "/farm-nation/property",
};

/** The link to one saved thing. */
export function savedItemHref(itemType: SavedItemType, targetId: string): string {
    return `${SAVED_ITEM_ROUTES[itemType]}/${targetId}`;
}
