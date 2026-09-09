/**
 * Messages — the server half. See #543 / #545.
 *
 * The conversation list is the first thing this screen needs and it was read in
 * the browser, on a poll, after the page had already arrived. #540 fixed the
 * NAV that sits above this screen; the screen itself still made its own round
 * trip before showing a single conversation.
 *
 * Only the list is seeded. The thread inside a conversation is not, because
 * which conversation is open is decided in the browser — from a query
 * parameter, and then from every click after it — and #544's read receipt is
 * written on the first poll of a thread that CHANGED. Seeding a thread here
 * would either duplicate that rule or write a receipt for a conversation nobody
 * had opened yet.
 */

import { getConversationsAction } from "@/app/actions/messages";
import MessagesClient from "./MessagesClient";

/**
 *   #560 EXPLICITLY DYNAMIC — reads a session, so Next cannot prerender it (#543).
 */
export const dynamic = "force-dynamic";

export default async function MessagesPage() {
    //   getConversationsAction returns { error, conversations } rather than an
    //   ActionResponse, and #310 records why the two are told apart: a failed
    //   list must not read as an empty one. It is passed down whole so that
    //   distinction is made in exactly one place — the client.
    const initial = await getConversationsAction().catch(() => null);

    return <MessagesClient initial={initial} />;
}
