/**
 * @jest-environment node
 */

/**
 *   #311 THE EXPORT BOOKING RESERVES REAL CAPACITY, PROMISES AN EMAIL NOBODY
 *        SENDS, AND IS FILED WHERE NOTHING READS IT.
 *
 *        A member opens /export/opportunities, works through a four-step wizard
 *        — grade, moisture, foreign matter, phytosanitary certificate, port,
 *        vessel, Bill of Lading, Certificate of Origin — presses Confirm, and
 *        sees:
 *
 *            "Slot Booked! Your export slot is pending confirmation.
 *             You will receive an email with payment details."
 *
 *        createBookingAction contains no email code, no notification code, and
 *        no queue write. It reserves the volume, adds the row with
 *        status: 'pending', and returns. #290's shape — a screen announcing an
 *        email nobody sent — on the screen that takes a member's shipping
 *        documents.
 *
 *        THAT IS THE HALF THAT IS FIXED HERE. The copy now says what is true.
 *
 *   WHAT IS RECORDED AND NOT CHANGED
 *
 *        export_bookings has exactly three readers in the whole codebase, and
 *        this suite proves it by scanning rather than by assertion:
 *
 *          createBookingAction        writes it
 *          getUserBookingsAction      reads it — AND HAS ZERO CALLERS
 *          getDashboardStatsAction    folds it into one aggregate number
 *
 *        So no admin screen anywhere can see a booking; the member cannot see
 *        their own; nothing moves the status off 'pending'; and every export
 *        member screen (portfolio, transactions, dashboard) reads
 *        export_investments instead, a different collection. The booking is
 *        written into a room with no doors.
 *
 *        And it is not inert while it sits there. createBookingAction reserves
 *        the volume through the CAS helper against the window's targetVolume
 *        ceiling BEFORE writing the row, so each booking permanently removes
 *        export capacity that nobody can act on, approve, cancel or release.
 *        That is #141's shape ("the payout queue is read by nothing") on top of
 *        #140's ("a reservation that never expires") — and #140 is an open
 *        owner decision of exactly this kind, so this one is written up the
 *        same way rather than decided here. Building the admin queue, or a
 *        release policy, is a product call.
 *
 *        The assertions below pin the present state so that when somebody does
 *        build it, they find this note in the same search.
 *
 *   #380 SOMEBODY DID BUILD IT, AND THIS IS THAT SEARCH.
 *
 *        The owner decision #311 declined to take was taken: the export team
 *        gets a confirm/cancel queue, and CANCEL RELEASES THE RESERVED VOLUME.
 *        Automatic expiry was rejected because a booking records no agreed
 *        deadline to expire against — #140's field-nobody-reads defect is not
 *        worth reproducing here.
 *
 *        So four of the assertions written above as a record of the defect are
 *        now deliberately false, and each is replaced below by its opposite,
 *        pinned just as tightly:
 *
 *          "nothing outside its own module reads export_bookings"
 *              → the admin queue and the member screen both do.
 *          "NO ADMIN SCREEN CAN SEE A BOOKING AT ALL"
 *              → /admin/export/bookings, reachable from the sidebar.
 *          "getUserBookingsAction has no callers"
 *              → /export/bookings, its first caller, three years late.
 *          "nothing moves the status off 'pending'"
 *              → decideExportBookingAction, through a CAS claim.
 *
 *        What is NOT reversed is the first block. createBookingAction still
 *        sends nothing at booking time, so the wizard copy #311 corrected is
 *        still the true copy — and the assertion that proves it is narrowed to
 *        that function rather than the file, because the DECISION does notify.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

const ROOT = process.cwd();
const WIZARD = 'src/components/modals/BookingWizard.tsx';
const ACTION = 'src/app/actions/export-booking.ts';

function raw(rel: string): string {
    return readFileSync(join(ROOT, rel), 'utf-8');
}
function code(rel: string): string {
    return stripComments(raw(rel), { label: rel });
}

/**
 * One function's body, comments stripped. #380 made the file-wide assertions
 * about export-booking.ts too coarse: the file now holds a booking creator that
 * must stay silent and a decision that must notify.
 */
const TO_END_OF_FILE = '';

function fn(rel: string, start: string, end: string): string {
    const src = code(rel);
    const a = src.indexOf(start);
    const b = end === TO_END_OF_FILE ? src.length : src.indexOf(end, a + 1);
    // A missing anchor slices to nothing and every assertion passes vacuously.
    expect({ rel, start, end, found: a > -1 && b > a }).toEqual({ rel, start, end, found: true });
    return src.slice(a, b);
}

/** Every non-test source file, walked rather than listed. */
function sourceFiles(): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
        for (const e of readdirSync(dir)) {
            if (e === 'node_modules' || e === '__tests__') continue;
            const full = join(dir, e);
            if (statSync(full).isDirectory()) walk(full);
            else if (full.endsWith('.ts') || full.endsWith('.tsx')) {
                out.push(full.slice(ROOT.length + 1));
            }
        }
    };
    walk(join(ROOT, 'src'));
    return out.sort();
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#311 — the wizard no longer promises an email', () => {
    it('DOES NOT TELL THE MEMBER TO EXPECT ONE', () => {
        // THE test. Asserted against stripped source so the explanation above
        // the JSX — which quotes the old sentence — cannot satisfy it.
        expect(code(WIZARD)).not.toMatch(/receive an email/i);
    });

    it('and the sentence survives in the comment, so the change is findable', () => {
        // The opposite direction: the old copy is deliberately quoted where the
        // fix is, and grepping raw text for it must still land here.
        expect(raw(WIZARD)).toMatch(/receive an email with payment details/i);
    });

    it('says what actually happens instead', () => {
        const src = code(WIZARD);

        expect(src).toMatch(/reserved and pending confirmation/i);
        expect(src).toMatch(/not confirmed automatically/i);
    });

    it('BECAUSE createBookingAction SENDS NOTHING — the premise, checked not assumed', () => {
        // If somebody later adds the email AT BOOKING TIME, this fails, and
        // that failure is correct: it says the copy above can go back to
        // promising one.
        //
        // Scoped to the one function, not the file. #380 added a decision that
        // DOES notify the member, several hundred lines below — asserting on
        // the whole file would now conflate "the booking is silent" with "the
        // module is silent", and only the first is what the wizard claims.
        const body = fn(
            ACTION,
            'export async function createBookingAction',
            'export async function getUserBookingsAction',
        );

        expect(body).not.toMatch(/sendEmail|EmailNotification|resend|Resend/);
        expect(body).not.toMatch(/createNotification|notifyUser/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#380 — what #311 recorded, corrected', () => {
    /**
     * Each of these is the OPPOSITE of an assertion #311 wrote as a record of
     * the defect. They are pinned as tightly as the originals so that the room
     * cannot lose its doors again.
     */
    const ADMIN_SCREEN = 'src/app/admin/export/bookings/page.tsx';
    const MEMBER_SCREEN = 'src/app/export/(app)/bookings/page.tsx';

    it('export_bookings now has readers outside the action file', () => {
        const readers = sourceFiles().filter((f) =>
            /COLLECTIONS\.EXPORT_BOOKINGS/.test(code(f)));

        // Named exhaustively rather than counted: a fifth file appearing here
        // is a new door onto a booking, and should be looked at.
        expect(readers.sort()).toEqual([
            'src/app/actions/dashboard.ts',
            'src/app/actions/export-booking.ts',
        ]);
    });

    it('AN ADMIN SCREEN CAN SEE A BOOKING — and it is the only one', () => {
        const admin = sourceFiles().filter((f) => f.startsWith('src/app/admin/'));
        const seesBookings = admin.filter((f) =>
            /getExportBookingsForAdminAction|decideExportBookingAction/.test(code(f)));

        // Vacuity guard: the admin tree is not empty.
        expect(admin.length).toBeGreaterThan(20);
        expect(seesBookings).toEqual([ADMIN_SCREEN]);
    });

    it('and the member can see their own — getUserBookingsAction HAS a caller', () => {
        // #311 found this reader exported, correct and dead: written for a
        // screen nobody built. This is that screen.
        const callers = sourceFiles()
            .filter((f) => f !== ACTION)
            .filter((f) => /getUserBookingsAction/.test(code(f)));

        expect(callers).toEqual([MEMBER_SCREEN]);
    });

    it('both screens have a way in, so neither is #362 again', () => {
        // A built screen with no navigation entry is a screen nobody finds.
        expect(code('src/components/admin/AdminSidebar.tsx')).toContain('/admin/export/bookings');
        expect(code('src/components/layout/ModuleSidebar.tsx')).toContain('/export/bookings');
    });

    it('and the decision notification points at a route that exists', () => {
        // #51's defect: every escrow notification linked to a 404.
        const body = fn(ACTION, 'export async function decideExportBookingAction', TO_END_OF_FILE);
        expect(body).toContain('link: "/export/bookings"');
    });

    it('THE RESERVED VOLUME IS RELEASED when the booking is cancelled', () => {
        // The part that cost something. The reservation is a CAS increment
        // against targetVolume; the release is the floored debit of the same
        // field, and it happens only on a cancel.
        const src = code(ACTION);

        expect(src).toMatch(/ceilingField:\s*"targetVolume"/);
        expect(src).toMatch(/status:\s*'pending'/);

        const decide = fn(ACTION, 'export async function decideExportBookingAction', TO_END_OF_FILE);
        expect(decide).toContain('if (decision === "cancelled") {');
        expect(decide).toContain('debitJsonbBalanceWithFloor({');
        // Exactly one release, inside that branch — not one per decision.
        expect((decide.match(/debitJsonbBalanceWithFloor\(\{/g) ?? []).length).toBe(1);
    });

    it('and the status is CLAIMED, so two officers cannot both release it', () => {
        const decide = fn(ACTION, 'export async function decideExportBookingAction', TO_END_OF_FILE);

        expect(decide).toContain('claimStatusTransitionFromAny({');
        expect(decide).toMatch(/fromAny:\s*\["pending"\]/);
        expect(decide).toContain('if (!claim.claimed) {');

        // Claim BEFORE release. The other order lets both cancels release.
        expect(decide.indexOf('claimStatusTransitionFromAny({'))
            .toBeLessThan(decide.indexOf('debitJsonbBalanceWithFloor({'));
    });

    it('a failed release is reported as a failure, naming the window to correct', () => {
        // The stated cost of that order, and the thing that stops it being a
        // silent loss of capacity. #307's class: not a success, not a shrug.
        const decide = fn(ACTION, 'export async function decideExportBookingAction', TO_END_OF_FILE);

        expect(decide).toContain('if (!release.ok) {');
        expect(decide).toContain('CANCELLED BUT NOT RELEASED');
        expect(decide).toMatch(/success: false as const,\s*\n\s*error: `The booking is cancelled/);
        expect(decide).toContain('window ${windowId}');
    });

    it('only pending and cancelled ever release — a confirm holds the volume', () => {
        // Confirming a booking must NOT give the capacity back: the shipment is
        // going ahead and the kilograms are spoken for.
        const decide = fn(ACTION, 'export async function decideExportBookingAction', TO_END_OF_FILE);
        const release = decide.slice(decide.indexOf('if (decision === "cancelled") {'));

        expect(release).toContain('debitJsonbBalanceWithFloor({');
        expect(decide.slice(0, decide.indexOf('if (decision === "cancelled") {')))
            .not.toContain('debitJsonbBalanceWithFloor({');
    });

    it('every OTHER export member screen still reads investments, a different collection', () => {
        // Unchanged by #380, and still the reason the booking was invisible.
        for (const screen of ['portfolio', 'transactions', 'dashboard']) {
            const src = code(`src/app/export/(app)/${screen}/page.tsx`);
            expect({ screen, mentionsBookings: /[Bb]ookings?Action|EXPORT_BOOKINGS/.test(src) })
                .toEqual({ screen, mentionsBookings: false });
        }
    });
});
