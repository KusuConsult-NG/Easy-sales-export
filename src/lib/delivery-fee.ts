/**
 * What the platform charges to deliver a basket — stated once.
 *
 *   #381 THERE WERE TWO DELIVERY RULES, AND THE LIVE ONE IGNORED THE SETTINGS.
 *
 *        marketplace-cart.calculateDeliveryFee(items, location, _fees) took the
 *        configured fees and DISCARDED them — the parameter carried a leading
 *        underscore, which is how it passed lint for however long it stood. It
 *        hardcoded ₦2,000 inside the city, ₦3,000 outside, ₦20 per kilometre
 *        past 10, and ₦500 per 5kg past 5.
 *
 *        actions/orders.ts charged `fees.baseDeliveryFee` — ₦2,500 — flat, per
 *        seller, with no surcharges at all.
 *
 *        Both are reachable code; only the first is reachable from a screen
 *        (/marketplace/checkout → calculateDeliveryAction, and the live Paystack
 *        door → _initializeOrderPaymentAction). createOrderAction, the only
 *        consumer of `baseDeliveryFee`, has zero callers.
 *
 *        So the number an admin would have set was not the number a buyer paid,
 *        and the two rules disagreed by ₦500 before either surcharge applied.
 *
 * THE RULE, AND WHERE EACH NUMBER CAME FROM
 * -----------------------------------------
 *     base                     baseDeliveryFee, or outsideCityDeliveryFee when
 *                              the address is outside the city centre
 *   + additionalItemFee × (item count − 1)          #193, default 0
 *   + distanceSurchargePerKm × (distance − freeDistanceKm)       when over
 *   + weightSurchargeAmount × ceil((weight − freeWeightKg) / weightSurchargeStepKg)
 *
 * Every figure is a field of PlatformFees, and every default is exactly what
 * the live path charged before this module existed, so no bill moved.
 *
 * WHY THE DEFAULTS LIVE HERE AND NOT IN system-settings
 * -----------------------------------------------------
 * This module is pure arithmetic and imports NOTHING. system-settings.ts pulls
 * in the database adapter and next/cache, so a rule that took its fallbacks
 * from there would stop working the moment a test mocked that module — which
 * three suites already do, and which is exactly how the first version of this
 * file broke them. The dependency runs the other way: DEFAULT_FEES is built
 * from these.
 *
 * They are applied per field rather than assumed, because this is also called
 * with a stored document written before these keys existed. A missing
 * weightSurchargeStepKg would otherwise divide by zero and return Infinity — an
 * unplaceable order, arriving silently.
 */

/** The delivery half of PlatformFees. Exactly what the live path charged. */
export const DEFAULT_DELIVERY_FEES = {
    baseDeliveryFee: 2000,
    outsideCityDeliveryFee: 3000,
    additionalItemFee: 0,
    freeDistanceKm: 10,
    distanceSurchargePerKm: 20,
    freeWeightKg: 5,
    weightSurchargeStepKg: 5,
    weightSurchargeAmount: 500,
} as const;

/** Only the fields this rule reads — not the whole PlatformFees shape. */
export type DeliveryFees = { [K in keyof typeof DEFAULT_DELIVERY_FEES]?: unknown };
export interface DeliveryLocation {
    /** Defaults to true when absent — the pre-existing behaviour. */
    isWithinCityCenter?: boolean;
    distance?: number;
    weight?: number;
}

/**
 * A number from configuration, or the default when it is unusable.
 *
 * The emptiness check is not decoration. `Number(null)` and `Number("")` are
 * both 0 — finite and non-negative — so a field that is absent from a stored
 * document, or blank in one, would read as a delivery fee of ZERO rather than
 * falling back. My own tests caught that on the first run.
 */
function num(value: unknown, fallback: number): number {
    if (value === null || value === undefined) return fallback;
    if (typeof value === "string" && value.trim() === "") return fallback;

    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function deliveryFeeFor(
    fees: DeliveryFees | null | undefined,
    location: DeliveryLocation | null | undefined,
    itemCount: number,
    weightKg: number,
): number {
    const f = fees ?? {};

    // Absent means inside, as it always has: a checkout that sends no location
    // must not be charged the higher rate.
    const inside = location?.isWithinCityCenter !== false;
    const base = inside
        ? num(f.baseDeliveryFee, DEFAULT_DELIVERY_FEES.baseDeliveryFee)
        : num(f.outsideCityDeliveryFee, DEFAULT_DELIVERY_FEES.outsideCityDeliveryFee);

    let fee = base;

    // #193 — the fee that was configured and charged by nothing. Beyond the
    // FIRST item, so a single-item basket is unaffected whatever it is set to.
    const items = Number.isFinite(itemCount) ? Math.max(0, Math.floor(itemCount)) : 0;
    fee += num(f.additionalItemFee, DEFAULT_DELIVERY_FEES.additionalItemFee) * Math.max(0, items - 1);

    const freeKm = num(f.freeDistanceKm, DEFAULT_DELIVERY_FEES.freeDistanceKm);
    const distance = Number.isFinite(Number(location?.distance)) ? Number(location?.distance) : freeKm;
    if (distance > freeKm) {
        fee += (distance - freeKm) * num(f.distanceSurchargePerKm, DEFAULT_DELIVERY_FEES.distanceSurchargePerKm);
    }

    const freeKg = num(f.freeWeightKg, DEFAULT_DELIVERY_FEES.freeWeightKg);
    const weight = Number.isFinite(Number(weightKg)) ? Number(weightKg) : freeKg;
    if (weight > freeKg) {
        // A zero step would divide by zero and make the whole fee Infinity, so
        // an unusable step falls back rather than propagating. The admin action
        // refuses to store one (exclusiveMin), and this is the second line of
        // defence for a document written before that check existed.
        const rawStep = Number(f.weightSurchargeStepKg);
        const step = Number.isFinite(rawStep) && rawStep > 0 ? rawStep : DEFAULT_DELIVERY_FEES.weightSurchargeStepKg;
        fee += Math.ceil((weight - freeKg) / step)
            * num(f.weightSurchargeAmount, DEFAULT_DELIVERY_FEES.weightSurchargeAmount);
    }

    return Math.round(fee);
}
