/**
 * The payout account screen — the server half. See #543 / #545.
 *
 * One read, no arguments, and the client did nothing with the answer but show
 * it. So the whole result is handed down and the first paint already carries
 * the banner: confirmed, unconfirmed, or "we could not check".
 *
 * The RESULT is passed rather than the account, because the three states are
 * told apart by `success` (#313) and the client owns that reading. A refusal is
 * logged here and still shown there.
 */

import { getBankAccountStatusAction } from "@/app/actions/bank-account";
import { rawSeed } from "@/lib/server-seed";
import BankAccountClient from "./BankAccountClient";

/**
 *   #556 EXPLICITLY DYNAMIC — reads a session, so Next cannot prerender it (#543).
 */
export const dynamic = "force-dynamic";

export default async function BankAccountPage() {
    const initial = rawSeed(
        "bank account status", await getBankAccountStatusAction().catch(() => null),
    );

    return <BankAccountClient initial={initial} />;
}
