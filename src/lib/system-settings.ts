import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { unstable_cache } from "next/cache";
import { DEFAULT_DELIVERY_FEES } from "@/lib/delivery-fee";

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

export interface PlatformFees {
    /** Delivery, before surcharges, for an address inside the city centre. */
    baseDeliveryFee: number;
    /** Delivery, before surcharges, for an address outside it. */
    outsideCityDeliveryFee: number;
    /** #193 — charged once per item beyond the first. 0 disables it. */
    additionalItemFee: number;
    /** Kilometres included in the base fee before the distance surcharge starts. */
    freeDistanceKm: number;
    /** Naira per kilometre beyond freeDistanceKm. */
    distanceSurchargePerKm: number;
    /** Kilograms included before the weight surcharge starts. */
    freeWeightKg: number;
    /** The step the weight surcharge is charged in. Must be above zero. */
    weightSurchargeStepKg: number;
    /** Naira per started step beyond freeWeightKg. */
    weightSurchargeAmount: number;
    /** The platform's cut of a marketplace order, as a fraction. */
    platformFeePercentage: number;
    minOrderAmount: number;
    maxOrderAmount: number;
}

export interface ExchangeRates {
    usdToNgn: number;
}

export interface WaveSettings {
    commissionRate: number;
}

export const DEFAULT_FEES: PlatformFees = {
    // The delivery half comes from lib/delivery-fee, which owns the rule and
    // therefore owns its fallbacks. Stating them again here is how two copies
    // of one number start to disagree.
    ...DEFAULT_DELIVERY_FEES,
    platformFeePercentage: 0.05,
    minOrderAmount: 500,
    maxOrderAmount: 10000000,
};

export const DEFAULT_EXCHANGE_RATES: ExchangeRates = {
    usdToNgn: 1650,
};

export const DEFAULT_WAVE_SETTINGS: WaveSettings = {
    commissionRate: 0.05,
};

// ─────────────────────────────────────────────────────────────────────────────
// The one definition of what is settable, and within what bounds.
//
// The admin action validates against this and the admin screen renders from it,
// so a field cannot exist on one side and not the other — the defect class this
// codebase keeps producing (#26, #38, #179, #183, #330).
// ─────────────────────────────────────────────────────────────────────────────

export const SYSTEM_SETTINGS_DOCS = ["platform_fees", "exchange_rates", "wave_settings"] as const;
export type SystemSettingsDoc = (typeof SYSTEM_SETTINGS_DOCS)[number];

/** The unstable_cache tag each document's getter is registered under. */
export const SYSTEM_SETTINGS_TAGS: Record<SystemSettingsDoc, string> = {
    platform_fees: "platform-fees",
    exchange_rates: "exchange-rates",
    wave_settings: "wave-settings",
};

export interface SystemSettingField {
    doc: SystemSettingsDoc;
    key: string;
    label: string;
    help: string;
    /** naira: whole currency. rate: a fraction of 1. number: a bare quantity. */
    kind: "naira" | "rate" | "number";
    min: number;
    max: number;
    /** The value must be strictly greater than `min`, not merely at least it. */
    exclusiveMin?: boolean;
}

export const SYSTEM_SETTINGS_FIELDS: readonly SystemSettingField[] = [
    // ── delivery ──────────────────────────────────────────────────────────
    {
        doc: "platform_fees", key: "baseDeliveryFee", kind: "naira",
        label: "Base delivery fee (inside city)",
        help: "Charged once per order for an address inside the city centre.",
        min: 0, max: 1_000_000,
    },
    {
        doc: "platform_fees", key: "outsideCityDeliveryFee", kind: "naira",
        label: "Base delivery fee (outside city)",
        help: "Charged instead of the above when the address is outside the city centre.",
        min: 0, max: 1_000_000,
    },
    {
        doc: "platform_fees", key: "additionalItemFee", kind: "naira",
        label: "Additional item fee",
        help: "Charged once for each item beyond the first. Leave at 0 to charge one flat delivery fee however many items are in the basket.",
        min: 0, max: 1_000_000,
    },
    {
        doc: "platform_fees", key: "freeDistanceKm", kind: "number",
        label: "Kilometres included",
        help: "Distance covered by the base fee before the per-kilometre surcharge starts.",
        min: 0, max: 10_000,
    },
    {
        doc: "platform_fees", key: "distanceSurchargePerKm", kind: "naira",
        label: "Surcharge per extra kilometre",
        help: "Charged for every kilometre beyond the included distance.",
        min: 0, max: 100_000,
    },
    {
        doc: "platform_fees", key: "freeWeightKg", kind: "number",
        label: "Kilograms included",
        help: "Weight covered by the base fee before the weight surcharge starts.",
        min: 0, max: 100_000,
    },
    {
        doc: "platform_fees", key: "weightSurchargeStepKg", kind: "number",
        label: "Weight surcharge step (kg)",
        help: "The block size the weight surcharge is charged in. Must be above zero.",
        min: 0, max: 100_000, exclusiveMin: true,
    },
    {
        doc: "platform_fees", key: "weightSurchargeAmount", kind: "naira",
        label: "Surcharge per weight step",
        help: "Charged for every started block beyond the included weight.",
        min: 0, max: 1_000_000,
    },

    // ── the platform's cut and the order bounds ───────────────────────────
    {
        doc: "platform_fees", key: "platformFeePercentage", kind: "rate",
        label: "Platform fee",
        help: "The platform's share of a marketplace order, withheld from the seller's escrow release. 0.05 is 5%.",
        min: 0, max: 0.5,
    },
    {
        doc: "platform_fees", key: "minOrderAmount", kind: "naira",
        label: "Minimum order",
        help: "An order below this is refused at checkout.",
        min: 0, max: 1_000_000_000,
    },
    {
        doc: "platform_fees", key: "maxOrderAmount", kind: "naira",
        label: "Maximum order",
        help: "An order above this is refused at checkout. Must be above the minimum.",
        min: 0, max: 1_000_000_000, exclusiveMin: true,
    },

    // ── the rate an export buyer is charged at ────────────────────────────
    {
        doc: "exchange_rates", key: "usdToNgn", kind: "number",
        label: "USD → NGN",
        help: "Export products are priced in dollars and charged in naira at this rate. The rate used is stamped onto every order.",
        min: 0, max: 100_000, exclusiveMin: true,
    },

    // ── WAVE ──────────────────────────────────────────────────────────────
    {
        doc: "wave_settings", key: "commissionRate", kind: "rate",
        label: "WAVE commission",
        help: "A WAVE agent's share of an order they brought in. 0.05 is 5%.",
        min: 0, max: 0.5,
    },
];

/** The stored defaults, by document — what a field falls back to. */
export const SYSTEM_SETTINGS_DEFAULTS: Record<SystemSettingsDoc, Record<string, number>> = {
    platform_fees: DEFAULT_FEES as unknown as Record<string, number>,
    exchange_rates: DEFAULT_EXCHANGE_RATES as unknown as Record<string, number>,
    wave_settings: DEFAULT_WAVE_SETTINGS as unknown as Record<string, number>,
};

export function systemSettingsFieldsFor(doc: SystemSettingsDoc): SystemSettingField[] {
    return SYSTEM_SETTINGS_FIELDS.filter((f) => f.doc === doc);
}

export type SystemSettingCheck =
    | { ok: true; value: number }
    | { ok: false; error: string };

/**
 * One field, checked against its own bounds.
 *
 * Rejects rather than clamps. A silently clamped exchange rate is a wrong
 * charge presented as a saved setting, and #296's lesson is that a refusal read
 * as a clean bill of health is worse than a refusal.
 */
export function checkSystemSetting(field: SystemSettingField, raw: unknown): SystemSettingCheck {
    // Trimmed FIRST and tested for emptiness before conversion. `Number("")`
    // and `Number("   ")` are both 0 — finite, and inside most of these bounds
    // — so an empty form field would otherwise save as a valid zero. Checking
    // `raw === ""` alone misses "  ", which is what a cleared input can send.
    const text = typeof raw === "string" ? raw.trim() : raw;
    const value = Number(text);

    if (text === null || text === undefined || text === "" || !Number.isFinite(value)) {
        return { ok: false, error: `${field.label} must be a number` };
    }
    if (field.exclusiveMin ? value <= field.min : value < field.min) {
        return {
            ok: false,
            error: field.exclusiveMin
                ? `${field.label} must be above ${field.min}`
                : `${field.label} cannot be below ${field.min}`,
        };
    }
    if (value > field.max) {
        return { ok: false, error: `${field.label} cannot be above ${field.max}` };
    }
    return { ok: true, value };
}

export type SystemSettingsPatchCheck =
    | { ok: true; values: Record<string, number> }
    | { ok: false; error: string };

/**
 * A whole document's worth of values, checked field by field and then against
 * the one rule that spans two fields.
 *
 * Only the keys SYSTEM_SETTINGS_FIELDS names are read, so a caller sending an
 * extra key cannot get it into the document — #43's class, and the same defect
 * #317 found in the general settings save, where a whole ActionResponse
 * envelope was spread into the row.
 */
export function checkSystemSettingsPatch(
    doc: SystemSettingsDoc,
    patch: Record<string, unknown>,
): SystemSettingsPatchCheck {
    const fields = systemSettingsFieldsFor(doc);
    const values: Record<string, number> = {};

    for (const field of fields) {
        const result = checkSystemSetting(field, patch[field.key]);
        if (!result.ok) return { ok: false, error: result.error };
        values[field.key] = result.value;
    }

    // The bounds are a pair, and each is legal alone. A maximum below the
    // minimum refuses EVERY order — the whole marketplace, silently.
    if (doc === "platform_fees" && values.maxOrderAmount <= values.minOrderAmount) {
        return {
            ok: false,
            error: "Maximum order must be above the minimum order, or no order can be placed",
        };
    }

    return { ok: true, values };
}

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
