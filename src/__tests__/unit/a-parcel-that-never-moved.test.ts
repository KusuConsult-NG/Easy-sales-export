/**
 * @jest-environment node
 */

/**
 *   THE OWNER: "tracking should be realtime. when purchases are made how will
 *   seller notify buyers that goods are shipped?"
 *
 * ── THE NOTIFICATION WAS NEVER THE MISSING PART ─────────────────────────────
 *
 *   The seller's order screen has always said "Pack and ship the items, then
 *   enter a tracking number and mark as shipped", and pressing that button
 *   calls updateOrderStatusAction, which writes the status and notifies the
 *   buyer with the number — the instant the seller acts. What was missing was
 *   anything TRUE to put in the notification.
 *
 *   THE TRACKING FIELD WAS "(optional)", and the server filled it in:
 *
 *       if (newStatus === "shipped" && !finalTrackingNumber) {
 *           const provider = getLogisticsProvider();
 *           const shipment = await provider.createShipment({ … });
 *           finalTrackingNumber = shipment.trackingNumber;
 *       }
 *
 *   The only provider was MockLogisticsProvider, and its answer was
 *   `TRK-${Date.now()}-${Math.floor(Math.random() * 1000)}`. So the buyer was
 *   notified of a consignment number no carrier had ever issued, and could not
 *   tell it from one that had been.
 *
 * ── REQUIRING A WAYBILL WOULD HAVE BEEN THE WRONG REPAIR ────────────────────
 *
 *   Most of what moves on this platform moves by bike, by bus park, or in the
 *   seller's own van. A seller sending yam by bus has nothing to type.
 *
 *     THE OWNER: let them ship without one, with a note.
 *
 *   So there are two shapes and the seller picks the true one — a carrier with
 *   its number, or a person with a phone the buyer can call. That second shape
 *   is what makes "no tracking number" an answer rather than a shrug.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
    missingShipmentFields,
    normaliseShipment,
    describeShipment,
} from '@/lib/shipment-record';

const code = (rel: string) =>
    readFileSync(join(process.cwd(), rel), 'utf-8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .map((l) => l.replace(/\s\/\/.*$/, ''))
        .join('\n');

const carrier = () => ({ method: 'carrier', carrier: 'GIG Logistics', trackingNumber: 'GIG889321' });
const rider = () => ({ method: 'self_delivery', courierName: 'Musa Danjuma', courierPhone: '08031234567' });

describe('the two shapes a shipment can have', () => {
    it('A CARRIER SHIPMENT IS COMPLETE — the control', () => {
        expect(missingShipmentFields(carrier())).toEqual([]);
    });

    it('A SELF DELIVERY IS TOO, with no tracking number anywhere in it', () => {
        //   THE point. This is the case that used to invent one.
        expect(missingShipmentFields(rider())).toEqual([]);
        expect(normaliseShipment(rider())).not.toHaveProperty('trackingNumber');
    });

    it('and a method nobody chose is refused', () => {
        for (const bad of [{}, { method: '' }, { method: 'teleport' }, null, undefined]) {
            expect(missingShipmentFields(bad).map((m) => m.field)).toEqual(['method']);
        }
    });

    it('A CARRIER WITH NO NUMBER IS REFUSED — it is not a carrier shipment', () => {
        expect(missingShipmentFields({ method: 'carrier', carrier: 'GIG Logistics' }).map((m) => m.field))
            .toEqual(['trackingNumber']);
        expect(missingShipmentFields({ method: 'carrier', trackingNumber: 'GIG889321' }).map((m) => m.field))
            .toEqual(['carrier']);
    });

    it('AND A SELF DELIVERY NEEDS A PHONE, which is what replaces the waybill', () => {
        //   Without it the buyer has no way to chase a parcel that has no
        //   number, and "shipped" becomes a shrug.
        expect(missingShipmentFields({ method: 'self_delivery', courierName: 'Musa' }).map((m) => m.field))
            .toEqual(['courierPhone']);
        expect(missingShipmentFields({ method: 'self_delivery', courierPhone: '08031234567' }).map((m) => m.field))
            .toEqual(['courierName']);
    });

    it('a stored record carries only the fields its method uses', () => {
        //   A half-edited form reaching the database: the buyer's panel
        //   branches on `method`, so a stray field is invisible there and
        //   confusing everywhere else.
        expect(normaliseShipment({ ...carrier(), courierPhone: '08031234567' }))
            .toEqual({ method: 'carrier', carrier: 'GIG Logistics', trackingNumber: 'GIG889321' });
        expect(normaliseShipment({ ...rider(), trackingNumber: 'GIG889321' }))
            .toEqual({ method: 'self_delivery', courierName: 'Musa Danjuma', courierPhone: '08031234567' });
    });

    it('and an incomplete one is not stored at all', () => {
        expect(normaliseShipment({ method: 'carrier', carrier: 'GIG Logistics' })).toBeNull();
    });

    it('each describes itself in one line', () => {
        expect(describeShipment(normaliseShipment(carrier()))).toBe('GIG Logistics — tracking GIG889321');
        expect(describeShipment(normaliseShipment(rider()))).toBe('Musa Danjuma — 08031234567');
        expect(describeShipment(null)).toBe('');
    });
});

describe('nothing invents a tracking number any more', () => {
    const ORDERS = 'src/app/actions/order-management.ts';
    const WAVE_ADMIN = 'src/app/actions/wave/_wv_admin_shipments.ts';
    const WAVE_SYNC = 'src/app/actions/wave/_wv_shipments.ts';
    const LOGISTICS = 'src/lib/logistics.ts';

    it('THE MOCK PROVIDER IS GONE', () => {
        const src = code(LOGISTICS);

        expect(src).not.toContain('MockLogisticsProvider');
        expect(src).not.toContain('Regional Transit Hub');
        expect(src).not.toContain('Sorting Facility');
        //   `TRK-${Date.now()}-${random}` — the number a buyer was given.
        expect(src).not.toMatch(/TRK-/);
    });

    it('and getLogisticsProvider can say there is none', () => {
        //   It could not return null before, so no caller was ever written to
        //   ask — which is how a stub becomes load-bearing. The interface
        //   stays, for the day a real carrier is wired.
        const src = code(LOGISTICS);

        expect(src).toMatch(/getLogisticsProvider\(\): LogisticsProvider \| null/);
        expect(src).toContain('interface LogisticsProvider');
    });

    it('THE ORDER PATH ASKS THE SELLER INSTEAD', () => {
        const src = code(ORDERS);

        expect(src).not.toContain('provider.createShipment');
        expect(src).toContain('normaliseShipment(shipment)');
        expect(src).toContain('missingShipmentFields(shipment)');
    });

    it('and a carrier number is the only kind stored as one', () => {
        //   A self delivery leaving `trackingNumber` set would put an empty
        //   "Tracking:" line in front of the buyer.
        expect(code(ORDERS)).toMatch(/shipmentRecord\?\.method === "carrier"/);
    });

    it('WAVE STOPS INVENTING ONE TOO', () => {
        expect(code(WAVE_ADMIN)).not.toContain('provider.createShipment');
    });

    it('AND STOPS WRITING AN IMAGINED JOURNEY INTO THE DATABASE', () => {
        //   The worst of the three: this MERGED the invented events into the
        //   stored shipment and set its status from the last of them, so the
        //   fabrication persisted and then drove what a member was shown.
        const src = code(WAVE_SYNC);

        expect(src).toMatch(/if \(!provider\) \{/);
        expect(src).toMatch(/No carrier is connected yet/);
    });

    it('the member keeps the updates a person really recorded (control)', () => {
        //   Nothing is deleted. The sync refuses; it does not clear the list.
        const src = code(WAVE_SYNC);

        expect(src).not.toMatch(/updates: \[\]/);
        expect(src).toContain('shipmentData.updates');
    });
});
