/**
 * Escrow detail — the server half. See #543 / #545.
 *
 * The route params are resolved here and the transaction fetched, so the client
 * receives an id it already has the data for. It keeps its own `load` because
 * the screen refreshes itself after a release or a dispute.
 */

import { getEscrowTransactionByIdAction } from "@/app/actions/marketplace";
import EscrowDetailClient from "./EscrowDetailClient";

/**
 *   #547 EXPLICITLY DYNAMIC — reads a session, so Next cannot prerender it (#543).
 */
export const dynamic = "force-dynamic";

export default async function EscrowDetailPage({ params }: { params: Promise<{ id: string }> }) {
    const { id: escrowId } = await params;

    const result = await getEscrowTransactionByIdAction(escrowId).catch(() => null);
    //   Null on refusal as well as on failure: "not found" and "not authorised"
    //   are messages this screen shows as themselves, and the client's own load
    //   is what produces them.
    const initial = result?.success && result.data ? (result.data as any) : null;

    return <EscrowDetailClient escrowId={escrowId} initial={initial} />;
}
