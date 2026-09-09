/**
 * An escrow chat — the server half. See #543 / #545.
 *
 * Two reads on mount: the escrow row, and the messages. In the browser they ran
 * one after the other — the messages poll only starts once the session resolves
 * — so a buyer opening a dispute conversation waited for the page, then the
 * escrow, then the thread.
 *
 * They are independent reads, so they are made together here.
 *
 * WHAT IS DELIBERATELY NOT DECIDED HERE: whether this viewer may see the chat.
 * The client compares the escrow row's buyerId and sellerId against its own
 * session and redirects if neither matches, and that stays exactly where it
 * was. The row is only ever handed to the browser that asked for it, and
 * getEscrowMessagesAction does its own check server-side regardless.
 */

import { getEscrowMessagesAction, getEscrowTransactionByIdAction } from "@/app/actions/marketplace";
import { rawSeed } from "@/lib/server-seed";
import EscrowChatClient from "./EscrowChatClient";

/**
 *   #560 EXPLICITLY DYNAMIC — reads a session, so Next cannot prerender it (#543).
 */
export const dynamic = "force-dynamic";

export default async function EscrowChatPage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id } = await params;

    const [escrowResult, messagesResult] = await Promise.all([
        getEscrowTransactionByIdAction(id).catch(() => null),
        getEscrowMessagesAction(id).catch(() => null),
    ]);

    const escrow = rawSeed("escrow transaction", escrowResult);
    const messages = rawSeed("escrow messages", messagesResult);

    //   All or nothing: a chat handed its escrow row while the thread was still
    //   on its way is a screen that looks loaded and is not.
    const complete = escrow !== null && messages !== null;

    return (
        <EscrowChatClient
            escrowId={id}
            initial={complete && escrow && messages ? { escrow, messages } : null}
        />
    );
}
