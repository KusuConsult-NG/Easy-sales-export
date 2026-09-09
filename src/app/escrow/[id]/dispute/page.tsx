/**
 * Raise an escrow dispute — the server half. See #543 / #545.
 *
 * The client keeps loadEscrow: it is what shows "Escrow transaction not found"
 * and redirects to /escrow, and a refusal here passes null so that path runs.
 */

import { getEscrowTransactionByIdAction } from "@/app/actions/marketplace";
import { seedOrNull } from "@/lib/server-seed";
import CreateDisputeClient from "./CreateDisputeClient";

/**
 *   #553 EXPLICITLY DYNAMIC — reads a session, so Next cannot prerender it (#543).
 */
export const dynamic = "force-dynamic";

export default async function CreateDisputePage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const initial = seedOrNull(
        "escrow dispute", await getEscrowTransactionByIdAction(id).catch(() => null),
    );

    return <CreateDisputeClient escrowId={id} initial={initial as any} />;
}
