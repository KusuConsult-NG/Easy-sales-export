/**
 * @jest-environment jsdom
 */

/**
 *   #590 A BILL OF LADING AND A CERTIFICATE OF ORIGIN, COLLECTED AND SHOWN TO
 *        NOBODY.
 *
 *   The booking wizard asks an exporter to upload both, uploads them to
 *   Cloudinary, and createBookingAction stores them on the booking:
 *
 *       documents: {
 *           billOfLading: String(data.billOfLadingUrl ?? ""),
 *           certificateOfOrigin: String(data.certificateOfOriginUrl ?? ""),
 *       },
 *
 *   Both readers hand the whole document over — getUserBookingsAction and the
 *   admin list both use serializeDocs — so the URLs arrive at the member's
 *   bookings screen AND the export team's admin screen. Neither drew them.
 *   Measured by sweep: `billOfLading` appears in three files, and the only one
 *   that is a screen is the wizard that uploads it. Neither screen's own
 *   `Booking` interface even declared the field.
 *
 *   So an exporter attaches the two papers that prove a consignment is real,
 *   and then the export team's screen does not show them — the team asks for
 *   them again by e-mail — and the exporter cannot see what they sent, so they
 *   cannot tell whether the right file went up.
 *
 *   #348 IS THIS FINDING, ONE FIELD SHORT. It rescued the moisture reading, the
 *   foreign-matter percentage, the phytosanitary flag, the shipping terms, the
 *   port and the vessel — "what the wizard collected and then threw away" — and
 *   both screens draw that line today. The two document URLs were stored in the
 *   same commit and drawn by neither.
 *
 * ── WHAT IS NOT CLAIMED ─────────────────────────────────────────────────────
 *
 *   Nothing was lost. Every URL ever uploaded is still on the booking and still
 *   in Cloudinary; what was missing was a screen that draws them.
 *
 *   No new permission: the member sees their own booking's papers and the
 *   export team sees every booking's, which is what both screens already show
 *   for every other field on the row.
 *
 *   AND THIS IS NOT A RATCHET. The class it belongs to — a field collected,
 *   stored and read by nothing — is real and recurring (#580 minOrderMT, #582
 *   availableQuantityMT, #583 rejectionReason), and I tried to measure it
 *   across the codebase: a sweep for fields written into a document payload and
 *   never referenced elsewhere returned 146 names. THE SWEEP WAS WRONG. It put
 *   `disbursementTransferCode` on the list, and a plain grep finds ten readers
 *   of it — the shell quoting inside the generated grep misfired. A ledger
 *   built on a measurement I cannot trust would be worse than none, so this
 *   finding is verified by hand and the instrument is not shipped.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     a missing documents key made to throw        KILLED (2 tests)
 *     the labels swapped for the raw keys          KILLED (2)
 *     the member's screen no longer drawing them   KILLED
 *     the admin screen no longer drawing them      KILLED
 *     the URL guard dropped                        KILLED
 *     reword the finding comment                   SURVIVED, as intended
 *
 *   ONE MUTANT SURVIVED THE FIRST RUN, AND IT WAS THE SAME FAULT AS #588's.
 *   The admin half was asserted by GREPPING ITS SOURCE for `bookingDocuments(b)`
 *   — and replacing the guard around that call with `false` left the text in
 *   place, so the screen drew nothing and the test passed. Checking for the
 *   word rather than the behaviour, for the third time in two sessions. The
 *   admin screen is rendered now.
 */

import React from 'react';
import { render } from '@testing-library/react';

import { bookingDocuments } from '@/lib/booking-documents';

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
    useSearchParams: () => new URLSearchParams(),
    usePathname: () => '/export/bookings',
}));
const getExportBookingsForAdminAction = jest.fn() as jest.Mock<any>;

jest.mock('@/app/actions/export-booking', () => ({
    getUserBookingsAction: jest.fn(async () => ({ success: true, error: null, data: [] })),
    getExportBookingsForAdminAction: (...a: any[]) => getExportBookingsForAdminAction(...a),
    decideExportBookingAction: jest.fn(),
}));

const BOL = 'https://res.cloudinary.com/demo/bol.pdf';
const COO = 'https://res.cloudinary.com/demo/coo.pdf';

const BOOKING = {
    id: 'b1', quantity: 500, totalPrice: 250_000, status: 'pending',
    shippingTerms: 'FOB', portOfOrigin: 'Apapa', vessel: 'MV Ada',
    documents: { billOfLading: BOL, certificateOfOrigin: COO },
};

// ─────────────────────────────────────────────────────────────────────────────
describe('#590 — what counts as a paper you can open', () => {
    it('BOTH URLS, IN A STABLE ORDER', () => {
        expect(bookingDocuments(BOOKING)).toEqual([
            { label: 'Bill of Lading', url: BOL },
            { label: 'Certificate of Origin', url: COO },
        ]);
    });

    it('AND NOTHING THAT CANNOT BE OPENED', () => {
        //   The writer stores `String(data.billOfLadingUrl ?? "")`, so an empty
        //   string is what a booking with no upload actually holds — and a bare
        //   storage key is what a different upload path would leave. Neither is
        //   a link.
        for (const documents of [
            undefined, null, {}, { billOfLading: '' },
            { billOfLading: 'export/bookings/bol.pdf' },
            { billOfLading: 42 }, { billOfLading: null },
        ]) {
            expect({ documents, links: bookingDocuments({ documents } as any) })
                .toEqual({ documents, links: [] });
        }
        //   And a booking with no documents key at all does not throw.
        expect(bookingDocuments({})).toEqual([]);
        expect(bookingDocuments(null)).toEqual([]);
    });

    it('AND ONE OF TWO IS STILL ONE', () => {
        expect(bookingDocuments({ documents: { billOfLading: BOL, certificateOfOrigin: '' } }))
            .toEqual([{ label: 'Bill of Lading', url: BOL }]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#590 — and both screens draw them', () => {
    it('THE EXPORTER CAN SEE WHAT THEY SENT', async () => {
        const { default: ExportBookingsClient } =
            await import('@/app/export/(app)/bookings/ExportBookingsClient');

        const { container } = render(<ExportBookingsClient initial={[BOOKING] as any} />);

        const links = Array.from(container.querySelectorAll('a'))
            .filter(a => /lading|origin/i.test(a.textContent || ''));
        expect(links.map(a => a.getAttribute('href'))).toEqual([BOL, COO]);
        //   Opened in a new tab, without handing the opener away.
        expect(links[0].getAttribute('rel')).toContain('noopener');
    });

    it('AND A BOOKING WITH NO PAPERS DRAWS NO LINKS', async () => {
        //   Vacuity guard: a row of dead links on every booking would be worse
        //   than none.
        const { default: ExportBookingsClient } =
            await import('@/app/export/(app)/bookings/ExportBookingsClient');

        const { container } = render(
            <ExportBookingsClient initial={[{ ...BOOKING, documents: undefined }] as any} />
        );

        expect(Array.from(container.querySelectorAll('a'))
            .filter(a => /lading|origin/i.test(a.textContent || ''))).toEqual([]);
        //   And the row is still there, with the details #348 rescued.
        expect(container.textContent).toContain('Apapa');
    });

    it('AND THE EXPORT TEAM CAN OPEN THEM FROM THE SCREEN THEY DECIDE ON', async () => {
        /**
         *   RENDERED, NOT GREPPED. This asserted that the source CONTAINED
         *   `bookingDocuments(b)` — and a mutant that replaced the guard around
         *   it with `false` left that text in place and passed. The same
         *   "checking for the word, not the behaviour" fault #588's ratchet had.
         */
        getExportBookingsForAdminAction.mockResolvedValue({
            success: true, error: null,
            data: [{ ...BOOKING, windowTitle: 'Cocoa Q1', memberName: 'Ada Obi' }],
        });

        const { default: AdminExportBookingsPage } =
            await import('@/app/admin/export/bookings/page');
        const { container, findByText } = render(<AdminExportBookingsPage />);

        await findByText(/Ada Obi/);
        const links = Array.from(container.querySelectorAll('a'))
            .filter(a => /lading|origin/i.test(a.textContent || ''));
        expect(links.map(a => a.getAttribute('href'))).toEqual([BOL, COO]);
    });
});
