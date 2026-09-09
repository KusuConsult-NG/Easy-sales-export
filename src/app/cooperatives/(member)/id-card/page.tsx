/**
 * A cooperative member's ID card — the server half. See #543 / #545.
 *
 * One read, no arguments. The result is passed down whole because the client
 * reads all three of its states — a card, a refusal, and a card that is missing
 * the fields the editor asks for — and that reading lives in one function
 * there (see `derive` in IdCardClient).
 */

import { getCooperativeMemberIdCardAction } from "@/app/actions/cooperative";
import { rawSeed } from "@/lib/server-seed";
import IdCardClient from "./IdCardClient";

/**
 *   #559 EXPLICITLY DYNAMIC — reads a session, so Next cannot prerender it (#543).
 */
export const dynamic = "force-dynamic";

export default async function CooperativeIdCardPage() {
    const initial = rawSeed(
        "cooperative id card",
        await getCooperativeMemberIdCardAction().catch(() => null),
    );

    return <IdCardClient initial={initial} />;
}
