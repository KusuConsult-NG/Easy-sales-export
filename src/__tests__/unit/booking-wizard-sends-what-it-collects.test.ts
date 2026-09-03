/**
 * @jest-environment node
 */

/**
 *   #348 THE BOOKING WIZARD ASKED FOR FOUR SCREENS AND SENT THREE FIELDS.
 *
 *        BookingWizard.tsx will not let a member advance without:
 *
 *          stage 2   a moisture percentage, a foreign-matter percentage, and a
 *                    ticked declaration that they hold a valid Phytosanitary
 *                    Certificate
 *          stage 3   a port of origin and a cargo vessel
 *          stage 4   an UPLOADED Bill of Lading and Certificate of Origin
 *
 *        Then handleConfirm sent:
 *
 *            createBookingAction({ exportWindowId, quantity, totalPrice })
 *
 *        Everything from stages 2, 3 and 4 was discarded at the call site. The
 *        two documents are the sharpest part: the member selects them, the
 *        wizard accepts them and refuses to continue without them, and THERE
 *        WAS NO UPLOAD CODE ANYWHERE IN THE FILE. Nothing left the browser.
 *        `bolFile` and `coFile` were read by validateStep and by nothing else.
 *
 *        So the export team received a booking that had reserved real capacity
 *        against an export window, with no record of the cargo's quality, the
 *        port, the vessel or a single document — and the member believed they
 *        had supplied all four.
 *
 *        This is the same shape as #310 and #315: a screen that collects and
 *        then discards. It is bigger than either, because the discarded half
 *        included files the member had to obtain from a government agency.
 *
 *        THE SECOND EMAIL PROMISE, IN THE FILE #311 ALREADY FIXED.
 *        #311 corrected the success screen's "You will receive an email with
 *        payment details" because createBookingAction contains no email and no
 *        notification code. The REVIEW screen in the same component said
 *        "Payment details will be sent to your registered email after
 *        confirmation" — and #311's ratchet matched on the phrase "receive an
 *        email", which this wording does not contain. One fix, two copies, a
 *        ratchet shaped around the copy that was fixed. Fourth time.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { stripComments } from '@/lib/testing/strip-comments';

const source = (rel: string) => stripComments(readFileSync(rel, 'utf-8'));

const WIZARD = 'src/components/modals/BookingWizard.tsx';
const ACTION = 'src/app/actions/export-booking.ts';

const MEMBER = 'member-1';
const WINDOW = 'win-1';
const SLOT_PRICE = 50;

// The reservation is a Postgres CAS function; the sibling suite
// (export-booking-price.test.ts) mocks it for the same reason.
const mockIncrementWithinCeiling = jest.fn() as jest.Mock<any>;
jest.mock('@/lib/wallet-ledger', () => ({
    incrementWithinCeiling: (p: any) => mockIncrementWithinCeiling(p),
    creditWalletOnce: jest.fn(), debitWalletOnce: jest.fn(), claimPaymentOnce: jest.fn(),
    claimIdempotencyKey: jest.fn(), decrementManyOrFail: jest.fn(),
    claimSingleOpenLoanApplication: jest.fn(),
}));

function actAs(id: string): void {
    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id, roles: ['user'], email: `${id}@example.com`, name: id } },
        error: null,
    }));
}

async function book(extra: Record<string, unknown> = {}) {
    const { createBookingAction } = await import('@/app/actions/export-booking');
    return createBookingAction({
        exportWindowId: WINDOW, quantity: 100, totalPrice: 5000, ...extra,
    } as any);
}

/** The document the action wrote, out of the call recorder. */
function bookingWritten(): Record<string, any> {
    return (global as any).mockFirestoreAdd.mock.calls
        .map((c: any[]) => c[c.length - 1])
        .find((d: any) => d && 'exportWindowId' in d) ?? {};
}

beforeEach(() => {
    jest.clearAllMocks();
    actAs(MEMBER);
    (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve({
        exists: true, empty: false, docs: [],
        data: () => ({ slotPrice: SLOT_PRICE, targetVolume: 10_000, currentVolume: 0, status: 'open' }),
    }));
    mockIncrementWithinCeiling.mockResolvedValue({ ok: true, value: 100 });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#348 — the booking records what the wizard collected', () => {
    it('THE QUALITY, LOGISTICS AND DOCUMENTS ALL LAND ON THE ROW', async () => {
        // THE test. Every one of these was dropped at the call site.
        const result = await book({
            moisturePercent: 12.5,
            foreignMatterPercent: 1.2,
            hasPhytosanitaryCertificate: true,
            shippingTerms: 'CIF',
            portOfOrigin: 'Apapa',
            vessel: 'MV Test',
            billOfLadingUrl: 'https://storage.test/bol.pdf',
            certificateOfOriginUrl: 'https://storage.test/co.pdf',
        });

        expect(result.success).toBe(true);
        const row = bookingWritten();
        expect(row.moisturePercent).toBe(12.5);
        expect(row.foreignMatterPercent).toBe(1.2);
        expect(row.hasPhytosanitaryCertificate).toBe(true);
        expect(row.shippingTerms).toBe('CIF');
        expect(row.portOfOrigin).toBe('Apapa');
        expect(row.vessel).toBe('MV Test');
        expect(row.documents).toEqual({
            billOfLading: 'https://storage.test/bol.pdf',
            certificateOfOrigin: 'https://storage.test/co.pdf',
        });
    });

    it('and the fields it always recorded are still recorded', async () => {
        // Vacuity guard: adding a payload must not have disturbed the price,
        // the reservation or the status, which #311 and the price finding pin.
        await book();

        const row = bookingWritten();
        expect(row.quantity).toBe(100);
        expect(row.totalPrice).toBe(5000);       // 100 x the window's slotPrice
        expect(row.slotPriceAtBooking).toBe(50);
        expect(row.status).toBe('pending');
        expect(row.userId).toBe(MEMBER);
    });

    it('a percentage that is NOT a usable percentage is recorded as absent', async () => {
        // NaN reaches this from `parseFloat("")` in the browser, and a NaN in a
        // numeric field is worse than a missing one — it renders as "NaN" on
        // the export officer's screen and breaks every comparison.
        await book({ moisturePercent: NaN, foreignMatterPercent: 'lots' });

        const row = bookingWritten();
        expect(row).not.toHaveProperty('moisturePercent');
        expect(row).not.toHaveProperty('foreignMatterPercent');
    });

    it.each([
        ['negative', -1],
        ['over one hundred', 101],
    ])('and a %s percentage is refused rather than stored', async (_label, value) => {
        await book({ moisturePercent: value });

        expect(bookingWritten()).not.toHaveProperty('moisturePercent');
    });

    it('0 and 100 are kept — the boundaries are valid readings', async () => {
        await book({ moisturePercent: 0, foreignMatterPercent: 100 });

        const row = bookingWritten();
        expect(row.moisturePercent).toBe(0);
        expect(row.foreignMatterPercent).toBe(100);
    });

    it('the declaration is coerced to a boolean, not stored as whatever arrived', async () => {
        await book({ hasPhytosanitaryCertificate: 'yes' as any });

        expect(bookingWritten().hasPhytosanitaryCertificate).toBe(true);
    });

    it('and a booking with none of it still succeeds — these are additions', async () => {
        // The other two callers (BookingModal) send no such fields.
        const result = await book();

        expect(result.success).toBe(true);
        expect(bookingWritten().documents).toEqual({ billOfLading: '', certificateOfOrigin: '' });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#348 — the wizard uploads the documents it demanded', () => {
    const code = source(WIZARD);

    it('IT ACTUALLY UPLOADS, THROUGH THE AUTHENTICATED ROUTE', () => {
        // There was no upload code in this file at all.
        expect(code).toContain('fetch("/api/upload"');
        expect(code).toContain('body.append("file", file)');
    });

    it('and refuses to book when an upload fails', () => {
        // Ordering matters: createBookingAction RESERVES export-window volume.
        // Booking first would consume capacity for paperwork that never
        // arrived.
        expect(code).toMatch(/if \(bolFile && !bolUrl\) \{ setSubmitting\(false\); return; \}/);
        expect(code).toMatch(/if \(coFile && !coUrl\) \{ setSubmitting\(false\); return; \}/);
        expect(code.indexOf('uploadDocument(bolFile')).toBeLessThan(code.indexOf('createBookingAction({'));
    });

    it('every field the wizard validates on is in the payload', () => {
        // The ratchet for this finding: a stage that refuses to advance without
        // a value, and then does not send it, is the defect.
        const call = code.slice(code.indexOf('createBookingAction({'));
        const payload = call.slice(0, call.indexOf('});') + 3);

        for (const field of [
            'moisturePercent', 'foreignMatterPercent', 'hasPhytosanitaryCertificate',
            'shippingTerms', 'portOfOrigin', 'vessel',
            'billOfLadingUrl', 'certificateOfOriginUrl',
        ]) {
            expect(payload).toContain(field);
        }
    });

    it('and the validator still demands them, so the payload is not optional in practice', () => {
        // Vacuity guard on the test above.
        expect(code).toContain('return "You must confirm you hold a valid Phytosanitary Certificate."');
        expect(code).toContain('return "Please upload your Bill of Lading."');
        expect(code).toContain('return "Please upload your Certificate of Origin."');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#348 — and the second email promise in the file #311 fixed', () => {
    it('THE REVIEW SCREEN NO LONGER PROMISES AN EMAIL EITHER', () => {
        const code = source(WIZARD);

        expect(code).not.toMatch(/sent to your registered email/i);
        expect(code).not.toMatch(/receive an email/i);
    });

    it('and the claim it rests on is still true — nothing sends one', () => {
        // Pinned against the action rather than remembered, exactly as #311
        // does. If a notification is ever added, this fails and the copy can
        // go back.
        const action = source(ACTION);

        expect(action).not.toMatch(/sendEmail|EmailNotification|resend|Resend/);
        expect(action).not.toMatch(/createNotification|notifyUser/);
    });

    it('the raw file still quotes the old wording, so the record survives', () => {
        expect(readFileSync(WIZARD, 'utf-8')).toMatch(/Payment details will be sent to your registered email/);
    });
});
