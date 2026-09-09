/**
 * Export bookings — the server half. See #543 / #545.
 *
 * A server read that FAILS passes null rather than an empty array, so the
 * client falls through to its own fetch and #307's rule — a failed list is not
 * an empty one — is preserved rather than quietly inverted.
 */

import { getUserBookingsAction } from "@/app/actions/export-booking";
import ExportBookingsClient from "./ExportBookingsClient";

/**
 *   #546 EXPLICITLY DYNAMIC — reads a session, so Next cannot prerender it.
 *   Saying so stops the build-time probe and its misleading stack traces (#543).
 */
export const dynamic = "force-dynamic";

export default async function ExportBookingsPage() {
    const result = await getUserBookingsAction().catch(() => null);
    const initial = result?.success && result.data ? (result.data as any[]) : null;

    return <ExportBookingsClient initial={initial} />;
}
