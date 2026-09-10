/**
 * The export buyer's cart — the server half. See #577.
 *
 * THIS PAGE FETCHES NOTHING FOR THE CART: the basket lives in localStorage and
 * the server cannot see it, which is why this screen sat on #545's ledger as
 * not convertible. It is a server component for a different reason.
 *
 * The screen quotes the order in naira, and the rate that converts it is a
 * SYSTEM SETTING the owner edits — the same `usdToNgn` the checkout action
 * charges at. Held in the browser as a constant it was a second copy of a
 * number that is meant to change, and the two disagreed the moment anybody
 * changed it. Read here, once, and handed down.
 *
 * The seed is only half the fix, and deliberately the weaker half: a rate can
 * still move between this render and the button being pressed, so the client
 * sends the total it displayed and the action refuses to charge anything else.
 * See the header of ExportCartClient.
 */

import { logger } from "@/lib/logger";
import { getExchangeRates } from "@/lib/system-settings";
import { DEFAULT_EXCHANGE_RATES } from "@/lib/system-settings-schema";
import ExportCartClient from "./ExportCartClient";

/**
 *   #577 EXPLICITLY DYNAMIC — and here it matters more than usual.
 *
 *   Prerendered, this page would bake one exchange rate into static HTML at
 *   build time and serve it until the next deploy, which is the very thing
 *   #381 removed from the source.
 */
export const dynamic = "force-dynamic";

export default async function ExportCartPage() {
    const rates = await getExchangeRates().catch((error) => {
        //   getExchangeRates swallows its own read failure and returns the
        //   defaults, so reaching this means the cache wrapper itself threw.
        //   The quote guard in the action still stands between a stale rate and
        //   a wrong charge; this only decides what the buyer is shown first.
        logger.error("[export-cart] exchange rate read failed; showing the default", error);
        return DEFAULT_EXCHANGE_RATES;
    });

    return <ExportCartClient usdToNgn={rates.usdToNgn} />;
}
