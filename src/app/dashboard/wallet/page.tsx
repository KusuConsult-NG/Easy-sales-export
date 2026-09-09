/**
 * The wallet — the server half. See #543 / #545.
 *
 * Three reads on mount: the feature toggles that decide whether funding and
 * withdrawal are open at all, the wallet itself, and the first page of
 * transactions. The client already fired them concurrently rather than one
 * after another, so what this removes is not their ordering but the whole
 * round trip — all three happened AFTER the page had been sent, downloaded and
 * hydrated, which is four steps before a balance appeared.
 *
 * Each result is passed down whole and unflattened: the client derives the
 * withdrawal bank from the wallet and the paging cursor from the last
 * transaction, and that derivation stays in one place rather than being
 * restated here.
 *
 * Any of the three failing seeds null for that one only — a wallet that could
 * not be read still shows its own error, and the other two are still free.
 */

import {
    getWalletAction,
    getWalletTransactionsAction,
} from "@/app/actions/wallet";
import { getFeatureTogglesAction } from "@/app/actions/health";
import { rawSeed } from "@/lib/server-seed";
import WalletClient from "./WalletClient";

/**
 *   #558 EXPLICITLY DYNAMIC — reads a session, so Next cannot prerender it (#543).
 */
export const dynamic = "force-dynamic";

export default async function WalletPage() {
    const [toggles, wallet, transactions] = await Promise.all([
        getFeatureTogglesAction().catch(() => null),
        getWalletAction().catch(() => null),
        getWalletTransactionsAction({ limit: 15 }).catch(() => null),
    ]);

    return (
        <WalletClient
            initial={{
                toggles: rawSeed("wallet feature toggles", toggles),
                wallet: rawSeed("wallet", wallet),
                transactions: rawSeed("wallet transactions", transactions),
            }}
        />
    );
}
