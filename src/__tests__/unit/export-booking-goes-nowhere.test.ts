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

    it('BECAUSE THE ACTION SENDS NOTHING — the premise, checked not assumed', () => {
        // If somebody later adds the email, this fails, and that failure is
        // correct: it says the copy above can go back to promising one.
        const src = code(ACTION);

        expect(src).not.toMatch(/sendEmail|EmailNotification|resend|Resend/);
        expect(src).not.toMatch(/createNotification|notifyUser/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#311 — what is recorded rather than fixed', () => {
    /**
     * These assert the DEFECT, not a fix. Each one failing means somebody has
     * built the missing half, and the write-up above should be revisited.
     */
    it('nothing outside its own module reads export_bookings', () => {
        const readers = sourceFiles().filter((f) =>
            /COLLECTIONS\.EXPORT_BOOKINGS/.test(code(f)));

        expect(readers.sort()).toEqual([
            'src/app/actions/dashboard.ts',
            'src/app/actions/export-booking.ts',
        ]);
    });

    it('NO ADMIN SCREEN CAN SEE A BOOKING AT ALL', () => {
        const admin = sourceFiles().filter((f) => f.startsWith('src/app/admin/'));
        const seesBookings = admin.filter((f) => /EXPORT_BOOKINGS|getUserBookingsAction/.test(code(f)));

        // Vacuity guard: the admin tree is not empty.
        expect(admin.length).toBeGreaterThan(20);
        expect(seesBookings).toEqual([]);
    });

    it('and the member cannot either — getUserBookingsAction has no callers', () => {
        // Exported, correct, and dead. A reader written for a screen that was
        // never built.
        const callers = sourceFiles()
            .filter((f) => f !== ACTION)
            .filter((f) => /getUserBookingsAction/.test(code(f)));

        expect(callers).toEqual([]);
    });

    it('every export member screen reads investments, a different collection', () => {
        // Why the booking is invisible rather than merely unstyled: the screens
        // that would show it are looking somewhere else entirely.
        for (const screen of ['portfolio', 'transactions', 'dashboard']) {
            const src = code(`src/app/export/(app)/${screen}/page.tsx`);
            expect({ screen, mentionsBookings: /[Bb]ookings?Action|EXPORT_BOOKINGS/.test(src) })
                .toEqual({ screen, mentionsBookings: false });
        }
    });

    it('THE VOLUME IS RESERVED BEFORE THE ROW IS WRITTEN, and never released', () => {
        // The part that costs something. The reservation is a CAS increment
        // against targetVolume — a real ceiling — and no code path anywhere
        // decrements it or moves the booking off 'pending'.
        const src = code(ACTION);

        expect(src).toMatch(/ceilingField:\s*"targetVolume"/);
        expect(src).toMatch(/status:\s*'pending'/);

        const movesItOn = sourceFiles().filter((f) =>
            /EXPORT_BOOKINGS/.test(code(f)) && /status:\s*['"](confirmed|paid|cancelled|rejected)['"]/.test(code(f)));
        expect(movesItOn).toEqual([]);
    });
});
