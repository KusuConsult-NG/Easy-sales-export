/**
 * Notification filter tabs, and the window both notification badges read.
 *
 *   #634 A NOTIFICATION ADDRESSED TO YOU WAS HIDDEN FROM YOU.
 *
 *   This module used to export `isNotificationVisible(type, serviceRegistrations,
 *   roles)`, and four places asked it before showing a member their own mail: the
 *   header bell, the notifications screen, the screen's unread tally, and the
 *   server-side badge count. Its rule was
 *
 *       a module-specific type is shown only if the member holds an
 *       approved / active / paid registration for that module
 *
 *   which sounds like tidiness and is, in practice, a way to lose mail. Every
 *   notification in this codebase is written TO ONE userId by the code that knows
 *   why that person should get it. Twenty-five writes carry a module type, and
 *   every one of them is addressed to a party of the transaction it is about:
 *
 *     escrow    ×18   buyerId / sellerId / otherPartyId
 *     dispute    ×6   initiatorId / respondentId
 *     export     ×1   booking.userId
 *     land       ×1   buyerId of the released reservation
 *
 *   None is a broadcast. So the filter could never suppress a notification that
 *   had reached the wrong person — there were none — and could only suppress ones
 *   that had reached the right person. It did:
 *
 *     an export booking      createBookingAction requires a session and nothing
 *                            else, so anybody may book. When the export team
 *                            confirmed or cancelled it, the notification was
 *                            typed "export" and needed an APPROVED export
 *                            registration to be seen. A member who simply booked
 *                            a slot has none, and was told nothing — which is the
 *                            defect #311 was fixed to prevent, one step later.
 *     a marketplace escrow   "Payment Confirmed", "Escrow Funded", "Funds
 *                            Released" need marketplace or farmNation. A seller
 *                            whose verification is still `pending`, or who has
 *                            been `suspended` mid-transaction, holds neither
 *                            status — and those are the people most in need of
 *                            hearing that money moved.
 *     a dispute              the same, for "A dispute has been opened against
 *                            you". A respondent who cannot see it cannot answer
 *                            it.
 *     a land reservation     `land` needs farmNation approved/active/paid, and
 *                            paying for Farm Nation writes `status: "pending"`.
 *                            The whole wait for approval was silent.
 *
 *   AND THE BADGE AGREED WITH THE PANEL ABOUT THE WRONG NUMBER. #416 made both
 *   badges apply this same filter so they would stop disagreeing; they did stop
 *   disagreeing, on zero. A member with five unread escrow rows saw no bell
 *   count, opened the panel, and read "No notifications yet".
 *
 *   THE RULE NOW: a notification written to you is shown to you. There is no
 *   visibility predicate left to get wrong, which is the point — see the note on
 *   the tabs below for the half of the original feature that was sound.
 *
 *   (It also carried #633's shape. Two hand-written copies of
 *   `r === "admin" || r === "super_admin" || r === "academy_admin"` decided who
 *   "bypasses all filters" — three of this platform's ten admin roles, so a
 *   moderator, a support agent or a wave_admin was filtered by their own consumer
 *   subscriptions. Both copies are gone rather than repaired: with no filter to
 *   bypass, nobody needs an exemption from it.)
 */

/**
 * Which notification types each filter tab collects.
 *
 * ONE TABLE, because there were two: `getVisibleFilterTabs` decided which tabs to
 * DRAW from a list of module keys, and NotificationsClient decided what each tab
 * SHOWS from a hand-written if-chain beside it. They already disagreed — the
 * chain folded `land` into the Farm Nation tab and the tab list did not, and
 * `escrow`, the single largest type this platform writes, had no tab at all and
 * was reachable only under All.
 *
 * "all" and "unread" are not here: they are not type filters, they are the
 * absence of one, and they are always drawn.
 */
export const FILTER_TAB_TYPES: Record<string, readonly string[]> = {
    payment:     ["payment", "payout", "transaction", "withdrawal"],
    order:       ["order", "transaction"],
    wave:        ["wave"],
    cooperative: ["cooperative"],
    academy:     ["academy"],
    loan:        ["loan"],
    export:      ["export"],
    farm_nation: ["farm_nation", "land"],
    escrow:      ["escrow"],
    dispute:     ["dispute"],
};

/** Tabs that are drawn whatever is in the inbox, in the order they appear. */
export const ALWAYS_VISIBLE_TABS: readonly string[] = ["all", "unread"];

/**
 * Does this notification belong under this tab?
 *
 * The one answer both the tab row and the list use, so a tab can never be drawn
 * over an empty list or filter out rows it was drawn for.
 */
export function notificationMatchesTab(type: string, tab: string): boolean {
    if (tab === "all") return true;
    const types = FILTER_TAB_TYPES[tab];
    if (!types) return type === tab;   // a tab nothing has classified — match it literally
    return types.includes(type);
}

/**
 * Which filter tabs to draw, given the types actually in the member's inbox.
 *
 * THE HALF OF THE ORIGINAL FEATURE THAT WAS SOUND, rebuilt on a fact instead of
 * a proxy. A tab is a shortcut to rows that exist; drawing ten of them for an
 * account with four notifications is noise, which is what the subscription list
 * was really there to prevent.
 *
 * Subscriptions were a poor stand-in for it in both directions: a member
 * subscribed to WAVE with no WAVE notifications got an empty tab, and a member
 * with escrow notifications and no marketplace registration got neither the tab
 * nor — before #634 — the notifications. Asking the inbox cannot be wrong about
 * either, and it needs neither registrations nor roles to answer.
 */
export function getVisibleFilterTabs(notificationTypes: Iterable<string>): string[] {
    const present = new Set(notificationTypes);
    const visible = [...ALWAYS_VISIBLE_TABS];

    for (const [tab, types] of Object.entries(FILTER_TAB_TYPES)) {
        if (types.some((type) => present.has(type))) visible.push(tab);
    }
    return visible;
}

/**
 *   #416 THE WINDOW BOTH NOTIFICATION BADGES READ.
 *
 *   NotificationCenter fetches this many and counts the unread ones for its bell;
 *   getMyUnreadNotificationCount reads the same many for the nav badge. Two
 *   numbers describing the same fact have to describe the same set, so the number
 *   lives here rather than in either of them.
 *
 *   It is NOT in my-data.ts because that module carries "use server", and a
 *   "use server" module may export only async functions — a plain const there
 *   fails the build.
 */
export const NOTIFICATION_BADGE_WINDOW = 50;

/**
 * How many notifications the notifications SCREEN shows at once — #534.
 *
 * It lives here for the same reason NOTIFICATION_BADGE_WINDOW does, and for one
 * more: the screen is a `"use client"` file and the service that pages the reads
 * is server-only. Putting the constant in the service and importing it from the
 * page pulled supabase-db into a client bundle, which #382's ratchet caught on
 * the first run — correctly. One number, in the one module both sides may read.
 */
export const NOTIFICATION_PAGE_SIZE = 25;
