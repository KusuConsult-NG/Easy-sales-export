"use client";

/**
 * How is this order coming — the seller's answer, in the two shapes there are.
 *
 *   THE OWNER: "tracking should be realtime. when purchases are made how will
 *   seller notify buyers that goods are shipped?"
 *
 * The notification was never the missing part: Mark as Shipped has always sent
 * the buyer one the instant it is pressed. What was missing was anything TRUE
 * to put in it. The tracking field was "(optional)", and leaving it empty made
 * the server invent `TRK-${Date.now()}-${random}` and send the buyer that —
 * see lib/shipment-record for the whole finding.
 *
 * Requiring a waybill instead would have been the wrong repair. Most of what
 * moves on this platform moves by bike, by bus park, or in the seller's own
 * van, and a seller sending yam by bus has nothing to type. So there are two
 * shapes, and the seller picks the one that is true:
 *
 *     CARRIER         a named carrier and its tracking number
 *     SELF DELIVERY   a person and a number the buyer can call
 *
 * The second is what makes "no tracking number" an answer rather than a shrug:
 * the buyer still learns who has their goods and how to reach them.
 *
 * The fields are here rather than inline because the seller's screen asks the
 * same question twice — once when fulfilling, once when correcting afterwards
 * — and two copies of a form are two places for it to drift.
 */

interface ShipmentFieldsProps {
    method: "carrier" | "self_delivery";
    onMethod: (value: "carrier" | "self_delivery") => void;
    carrier: string;
    onCarrier: (value: string) => void;
    trackingNumber: string;
    onTrackingNumber: (value: string) => void;
    courierName: string;
    onCourierName: (value: string) => void;
    courierPhone: string;
    onCourierPhone: (value: string) => void;
    /** Matches the panel it sits in; the two panels are orange and blue. */
    accent: "orange" | "blue";
}

export default function ShipmentFields({
    method, onMethod,
    carrier, onCarrier,
    trackingNumber, onTrackingNumber,
    courierName, onCourierName,
    courierPhone, onCourierPhone,
    accent,
}: ShipmentFieldsProps) {
    const border = accent === "orange" ? "border-orange-300" : "border-blue-300";
    const ring = accent === "orange" ? "focus:ring-orange-400" : "focus:ring-blue-400";
    const chosen = accent === "orange"
        ? "border-orange-500 bg-orange-100 text-orange-900"
        : "border-blue-500 bg-blue-100 text-blue-900";

    const field = `w-full px-4 py-2.5 border ${border} rounded-lg bg-white text-slate-900 text-sm ${ring} focus:ring-2 focus:border-transparent`;

    return (
        <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {([
                    { value: "carrier" as const, label: "A carrier is taking it", hint: "GIG, DHL, a haulage company" },
                    { value: "self_delivery" as const, label: "Self-delivery or local courier", hint: "A rider, a bus park, your own van" },
                ]).map((option) => (
                    <button
                        key={option.value}
                        type="button"
                        onClick={() => onMethod(option.value)}
                        aria-pressed={method === option.value}
                        className={`text-left px-4 py-3 border-2 rounded-lg transition-all ${
                            method === option.value ? chosen : "border-slate-300 bg-white hover:border-slate-400"
                        }`}
                    >
                        <span className="block text-sm font-semibold">{option.label}</span>
                        <span className="block text-xs text-slate-500 mt-0.5">{option.hint}</span>
                    </button>
                ))}
            </div>

            {method === "carrier" ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <input
                        type="text"
                        value={carrier}
                        onChange={(e) => onCarrier(e.target.value)}
                        placeholder="Carrier name"
                        aria-label="Carrier name"
                        className={field}
                    />
                    <input
                        type="text"
                        value={trackingNumber}
                        onChange={(e) => onTrackingNumber(e.target.value)}
                        placeholder="Tracking number"
                        aria-label="Tracking number"
                        className={field}
                    />
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <input
                        type="text"
                        value={courierName}
                        onChange={(e) => onCourierName(e.target.value)}
                        placeholder="Who is delivering it?"
                        aria-label="Courier name"
                        className={field}
                    />
                    <input
                        type="tel"
                        value={courierPhone}
                        onChange={(e) => onCourierPhone(e.target.value)}
                        placeholder="Phone the buyer can call"
                        aria-label="Courier phone"
                        className={field}
                    />
                </div>
            )}
        </div>
    );
}
