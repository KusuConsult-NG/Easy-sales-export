import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { unstable_cache } from "next/cache";

/**
 *   #381 THE PLATFORM'S MONEY CONFIGURATION WAS A FAÇADE.
 *
 *        This module reads three documents out of `system_settings` and hands
 *        their values to live money paths: the marketplace platform fee, the
 *        order floor and ceiling, the delivery fee, the USD→NGN rate an export
 *        buyer is charged at, and the WAVE commission.
 *
 *        NOTHING IN THIS CODEBASE EVER WROTE `system_settings`. Three readers,
 *        zero writers, measured by sweep rather than assumed. So every one of
 *        those numbers was permanently whatever the DEFAULT constants below
 *        said, and changing any of them required a code change and a deploy.
 *
 *        THE SHARP ONE IS THE EXCHANGE RATE. export-payment.ts prices an
 *        international buyer's cart in USD and charges them in naira at
 *        `usdToNgn`, stamping the rate onto the order. An FX rate frozen in
 *        source is wrong the day after it is written, and being wrong here
 *        means charging the wrong amount — in whichever direction the naira
 *        has moved since.
 *
 *   AND TWO OF THE SEVEN WERE NOT EVEN READ BY THE PATH THAT CHARGES
 *
 *        `baseDeliveryFee` had exactly one consumer: createOrderAction in
 *        actions/orders.ts, which has ZERO CALLERS. `additionalItemFee` (#193)
 *        had none at all.
 *
 *        The delivery fee a buyer actually pays came from
 *        marketplace-cart.calculateDeliveryFee(items, location, _fees) — whose
 *        third parameter was named with a leading underscore because it was
 *        ACCEPTED AND DISCARDED. It hardcoded ₦2,000 within the city and
 *        ₦3,000 outside, ₦20 for every kilometre past 10, and ₦500 for every
 *        5kg past 5. So the platform had two delivery rules that disagreed
 *        (₦2,500 flat versus ₦2,000 plus surcharges), and the live one ignored
 *        the configuration entirely. That is #38/#179/#183/#324's shape — one
 *        rule in N copies — landing on the copy that charges.
 *
 *   WHAT CHANGED, AND WHAT DELIBERATELY DID NOT
 *
 *        Every number the live delivery rule hardcoded is now a named field
 *        here, and lib/delivery-fee.ts states the rule once for both doors.
 *        THE DEFAULTS BELOW ARE EXACTLY WHAT THE LIVE PATH CHARGED BEFORE, so
 *        no buyer's bill moves by one naira as a result of this change:
 *
 *            baseDeliveryFee          2000   was the hardcoded city-centre rate
 *            outsideCityDeliveryFee   3000   was the hardcoded outside rate
 *            freeDistanceKm             10   was `if (distance > 10)`
 *            distanceSurchargePerKm     20   was `(distance - 10) * 20`
 *            freeWeightKg                5   was `if (weight > 5)`
 *            weightSurchargeStepKg       5   was `(weight - 5) / 5`
 *            weightSurchargeAmount     500   was `* 500`
 *            additionalItemFee           0   see below
 *
 *        baseDeliveryFee's default moved 2500 → 2000 for that reason: 2500 was
 *        the figure the UNREACHABLE action used, and adopting it as the live
 *        base would have raised every delivery charge by ₦500. The live number
 *        wins; the unreachable action now uses the same shared rule.
 *
 *        #193's `additionalItemFee` is WIRED rather than retired — it is a
 *        real per-item delivery charge now — but its default is 0, so today's
 *        prices are unchanged and switching it on is a deliberate act by an
 *        admin who types a number into the screen. Wiring it at its old
 *        default of 500 would have raised the price of every multi-item order
 *        without anybody deciding to, and that is a pricing decision, not a
 *        wiring fix.
 *
 *        The writer is actions/admin/_settings.ts, gated on `config:update`,
 *        bounds-checked against SYSTEM_SETTINGS_FIELDS below, audited, and
 *        cache-invalidating — see invalidateSystemSettingsCache. Without that
 *        last part a save would report success and take up to an hour to
 *        apply, because these getters are unstable_cache with revalidate 3600.
 */

/**
 * THE DEFINITIONS LIVE IN system-settings-schema.ts — #382.
 *
 * They were here, and the admin fees screen (a browser component) imported them
 * from here, which pulled the Supabase adapter and next/cache into the client
 * bundle and broke `npm run build` outright. The schema module imports nothing
 * but lib/delivery-fee, so a screen can ask it.
 *
 * Re-exported rather than moved-and-repointed so that every existing server
 * import of this module keeps working, and so there is still exactly one place
 * a server file needs to know about.
 */
export * from "@/lib/system-settings-schema";

import {
    DEFAULT_FEES,
    DEFAULT_EXCHANGE_RATES,
    DEFAULT_WAVE_SETTINGS,
    type PlatformFees,
    type ExchangeRates,
    type WaveSettings,
} from "@/lib/system-settings-schema";

// ─────────────────────────────────────────────────────────────────────────────
// The readers
// ─────────────────────────────────────────────────────────────────────────────

export const getPlatformFees = unstable_cache(
    async (): Promise<PlatformFees> => {
        try {
            const doc = await db.collection(COLLECTIONS.SYSTEM_SETTINGS).doc("platform_fees").get();
            if (doc.exists) {
                return { ...DEFAULT_FEES, ...doc.data() } as PlatformFees;
            }
            return DEFAULT_FEES;
        } catch (error) {
            console.error("Failed to fetch platform fees:", error);
            return DEFAULT_FEES;
        }
    },
    ["platform-fees"],
    { revalidate: 3600, tags: ["platform-fees"] }
);

export const getExchangeRates = unstable_cache(
    async (): Promise<ExchangeRates> => {
        try {
            const doc = await db.collection(COLLECTIONS.SYSTEM_SETTINGS).doc("exchange_rates").get();
            if (doc.exists) {
                return { ...DEFAULT_EXCHANGE_RATES, ...doc.data() } as ExchangeRates;
            }
            return DEFAULT_EXCHANGE_RATES;
        } catch (error) {
            console.error("Failed to fetch exchange rates:", error);
            return DEFAULT_EXCHANGE_RATES;
        }
    },
    ["exchange-rates"],
    { revalidate: 3600, tags: ["exchange-rates"] }
);

export const getWaveSettings = unstable_cache(
    async (): Promise<WaveSettings> => {
        try {
            const doc = await db.collection(COLLECTIONS.SYSTEM_SETTINGS).doc("wave_settings").get();
            if (doc.exists) {
                return { ...DEFAULT_WAVE_SETTINGS, ...doc.data() } as WaveSettings;
            }
            return DEFAULT_WAVE_SETTINGS;
        } catch (error) {
            console.error("Failed to fetch wave settings:", error);
            return DEFAULT_WAVE_SETTINGS;
        }
    },
    ["wave-settings"],
    { revalidate: 3600, tags: ["wave-settings"] }
);
