/**
 * How a parcel is travelling, as the person who sent it said it was.
 *
 *   THE OWNER: "tracking should be realtime. when purchases are made how will
 *   seller notify buyers that goods are shipped?"
 *
 * ── THE ANSWER WAS ALREADY MOSTLY BUILT ─────────────────────────────────────
 *
 *   The seller's order screen says "Pack and ship the items, then enter a
 *   tracking number and mark as shipped", and pressing that button calls
 *   updateOrderStatusAction, which writes the status and notifies the buyer
 *   with the number. That fires the instant the seller acts, which is the only
 *   sense of "real time" this platform can honestly offer today.
 *
 *   TWO THINGS WERE NOT REAL, and this module replaces both.
 *
 *   1. A TRACKING NUMBER INVENTED WHEN THE SELLER HAD NONE. order-management
 *      read: if the status is "shipped" and no number was typed, call the
 *      logistics provider and use whatever it returns. The only provider is
 *      MockLogisticsProvider, whose createShipment is
 *
 *          `TRK-${Date.now()}-${Math.floor(Math.random() * 1000)}`
 *
 *      So a buyer was notified of a consignment number that no carrier has
 *      ever heard of, and could not be told from a real one.
 *
 *   2. A JOURNEY NOBODY TOOK. trackShipment returned a timeline through
 *      "Sorting Facility", "Regional Transit Hub" and "Regional Distribution
 *      Center", with timestamps computed from the ORDER'S OWN dates. The
 *      buyer's order page drew it as carrier scans. WAVE went further and
 *      MERGED those invented events into the stored shipment, so the
 *      fabrication reached the database.
 *
 * ── WHAT A SELLER ACTUALLY HAS ──────────────────────────────────────────────
 *
 *   Most of what moves on this platform moves by bike, by bus park, or in the
 *   seller's own van. There is no waybill to type. Requiring one would leave
 *   those sellers stuck or typing junk into a field the buyer would then be
 *   told to trust.
 *
 *     THE OWNER: let them ship without one, with a note.
 *
 *   So a shipment is one of two things, said plainly:
 *
 *     CARRIER         a named carrier and its tracking number
 *     SELF DELIVERY   a person and a phone number the buyer can call
 *
 *   Either way the buyer is told who has their goods and how to reach them,
 *   which is what the invented number was pretending to provide.
 *
 * ── AND A REAL CARRIER, WHEN THERE IS ONE ───────────────────────────────────
 *
 *   lib/logistics.ts keeps the LogisticsProvider interface — createShipment
 *   and trackShipment — because that is the right shape for GIG, DHL or Kwik
 *   when an account exists. What it no longer does is return a pretend one by
 *   default. Until a provider is wired, the timeline a buyer sees is the
 *   order's own events, which are true.
 */

/** The two ways a parcel leaves a seller's hands on this platform. */
export const SHIPMENT_METHODS = ["carrier", "self_delivery"] as const;

export type ShipmentMethod = (typeof SHIPMENT_METHODS)[number];

export function isShipmentMethod(value: unknown): value is ShipmentMethod {
    return typeof value === "string" && (SHIPMENT_METHODS as readonly string[]).includes(value);
}

/** What the seller said, as it is stored on the order and shown to the buyer. */
export interface ShipmentRecord {
    method: ShipmentMethod;
    /** The carrier's name — "GIG Logistics", "DHL". Carrier shipments only. */
    carrier?: string;
    /** The carrier's own tracking number. Carrier shipments only. */
    trackingNumber?: string;
    /** Who is carrying it, for a self delivery: a rider, a driver, the seller. */
    courierName?: string;
    /** A number the buyer can call. Self deliveries only. */
    courierPhone?: string;
}

/** One missing answer, keyed the way the seller's form keys its fields. */
export interface MissingShipmentField {
    field: "method" | "carrier" | "trackingNumber" | "courierName" | "courierPhone";
    message: string;
}

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/**
 * Everything a seller has not said about how this parcel is travelling.
 *
 *   Returns `[]` when the record is complete. A shared rule rather than a
 *   check on the button, for the reason lib/marketplace-application records:
 *   the button is one door and the action is another, and they drift.
 */
export function missingShipmentFields(input: unknown): MissingShipmentField[] {
    const held = (input ?? {}) as Record<string, unknown>;
    const method = text(held.method);

    if (!isShipmentMethod(method)) {
        return [{ field: "method", message: "Say how this order is being delivered." }];
    }

    const missing: MissingShipmentField[] = [];

    if (method === "carrier") {
        if (!text(held.carrier)) {
            missing.push({ field: "carrier", message: "Which carrier is taking it?" });
        }
        if (!text(held.trackingNumber)) {
            //   The one field the old code would have invented. A carrier
            //   shipment with no number is not a carrier shipment.
            missing.push({ field: "trackingNumber", message: "Enter the carrier's tracking number." });
        }
        return missing;
    }

    if (!text(held.courierName)) {
        missing.push({ field: "courierName", message: "Who is delivering it? A rider, a driver, or yourself." });
    }
    if (!text(held.courierPhone)) {
        //   The buyer's only way to chase a parcel that has no waybill. It is
        //   what makes "no tracking number" acceptable rather than a shrug.
        missing.push({ field: "courierPhone", message: "A phone number the buyer can call." });
    }
    return missing;
}

/**
 * The record as it should be stored — only the fields its method uses.
 *
 *   A carrier shipment carrying a courier's phone, or a self delivery carrying
 *   a tracking number, is a half-edited form reaching the database. The buyer's
 *   screen branches on `method`, so a stray field would be invisible there and
 *   confusing everywhere else.
 */
export function normaliseShipment(input: unknown): ShipmentRecord | null {
    const held = (input ?? {}) as Record<string, unknown>;
    const method = text(held.method);
    if (!isShipmentMethod(method)) return null;
    if (missingShipmentFields(held).length > 0) return null;

    return method === "carrier"
        ? { method, carrier: text(held.carrier), trackingNumber: text(held.trackingNumber) }
        : { method, courierName: text(held.courierName), courierPhone: text(held.courierPhone) };
}

/**
 * One line naming who has the goods, for a notification or a summary.
 *
 *   The buyer's screen renders the parts itself; this is for the places that
 *   have room for a sentence and no room for a panel.
 */
export function describeShipment(record: ShipmentRecord | null | undefined): string {
    if (!record) return "";
    if (record.method === "carrier") {
        return `${record.carrier} — tracking ${record.trackingNumber}`;
    }
    return `${record.courierName} — ${record.courierPhone}`;
}
