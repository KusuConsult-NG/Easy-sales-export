/**
 * Notifications — the server half. See #543 / #545.
 *
 * THE ONE SCREEN IN THIS LEDGER WHOSE MOUNT READ IS A POLL, so the seed does
 * something slightly different here and the difference is worth stating.
 *
 * On the other converted screens the seed removes a round trip. A poller would
 * make that round trip anyway, 0ms after hydrating — so this seed removes the
 * empty first paint AND suppresses the first tick, and the eight-second cadence
 * simply starts from the data the page arrived with. See the effect in
 * NotificationsClient for why that is safe and where it is taken once.
 *
 * The read asks for ONE MORE row than the window, because that is how the
 * screen answers "are there older ones" (#534). The seed is the raw list and
 * the client windows it, so the boundary is decided in one place.
 */

import { getMyNotifications } from "@/app/actions/my-data";
import { NOTIFICATION_PAGE_SIZE } from "@/lib/notification-filter";
import NotificationsClient from "./NotificationsClient";

/**
 *   #558 EXPLICITLY DYNAMIC — reads a session, so Next cannot prerender it (#543).
 */
export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
    //   getMyNotifications throws rather than returning a refusal, so a failure
    //   seeds null and the client polls exactly as it did before.
    const initial = await getMyNotifications(NOTIFICATION_PAGE_SIZE + 1).catch(() => null);

    return <NotificationsClient initial={initial} />;
}
