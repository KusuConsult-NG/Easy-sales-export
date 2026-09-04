/**
 * @jest-environment node
 */

/**
 *   #380 A BOOKING RESERVED EXPORT CAPACITY THAT NOBODY COULD ACT ON.
 *
 *        THE MEASUREMENT, which #311 made and this suite re-makes rather than
 *        inherits: `export_bookings` had ONE writer and TWO readers.
 *
 *          createBookingAction      writes it, status 'pending', AND reserves
 *                                   volume against the window's targetVolume
 *                                   through incrementWithinCeiling
 *          getUserBookingsAction    reads the member's own — zero callers
 *          getDashboardStatsAction  folds it into one aggregate number
 *
 *        Nothing anywhere wrote that status a second time. So every booking
 *        removed export capacity permanently: a window filled up with pending
 *        bookings the export team could neither confirm nor cancel, and the
 *        next genuine member was refused "Only 0kg available" for slots that
 *        were never taken up. The refusal is real code — createBookingAction
 *        returns exactly that when incrementWithinCeiling declines.
 *
 *        THE DECISION, TAKEN RATHER THAN DEFERRED: the export team gets the two
 *        actions the flow already implies, and CANCELLING RELEASES THE VOLUME.
 *
 *        An automatic expiry was considered and rejected. A booking records no
 *        agreed deadline — nothing in the row says when payment was promised —
 *        so an expiry would have to invent one, and would then cancel bookings
 *        the team is actively arranging payment for. That is #140's defect
 *        (`pendingSince` written and never read) rebuilt deliberately. A person
 *        decides; this makes the decision possible, atomic and recorded.
 *
 *   WHAT THIS SUITE PINS
 *
 *        1. The premise, executed: a pending booking holds volume, and a second
 *           booking for the same window is refused because of it.
 *        2. Confirm and cancel both move the status, through a CAS CLAIM, so
 *           two officers racing cannot both act.
 *        3. Cancel releases exactly the booked quantity. Confirm releases
 *           NOTHING — the shipment is going ahead.
 *        4. A release that fails is reported as a failure naming the window,
 *           not swallowed and not rolled back to pending.
 *        5. Both screens exist, are reachable, and the notification's link
 *           points at one of them.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { stripComments } from '@/lib/testing/strip-comments';
import { COLLECTIONS } from '@/lib/types/firestore';

// ─── mocks ───────────────────────────────────────────────────────────────────

const mockRequireAdmin = jest.fn() as jest.Mock<any>;
jest.mock('@/lib/require-admin', () => ({
    requireAdmin: (...a: any[]) => mockRequireAdmin(...a),
}));

const mockClaim = jest.fn() as jest.Mock<any>;
jest.mock('@/lib/status-transition', () => ({
    claimStatusTransition: jest.fn(),
    claimStatusTransitionFromAny: (...a: any[]) => mockClaim(...a),
}));

const mockReserve = jest.fn() as jest.Mock<any>;
const mockRelease = jest.fn() as jest.Mock<any>;
jest.mock('@/lib/wallet-ledger', () => ({
    incrementWithinCeiling: (...a: any[]) => mockReserve(...a),
    debitJsonbBalanceWithFloor: (...a: any[]) => mockRelease(...a),
}));

const mockNotify = jest.fn() as jest.Mock<any>;
jest.mock('@/infrastructure/notifications/service', () => ({
    createNotification: (...a: any[]) => mockNotify(...a),
}));

const mockAudit = jest.fn() as jest.Mock<any>;
jest.mock('@/lib/audit-log', () => ({
    createAdminAuditLog: (...a: any[]) => mockAudit(...a),
    // A local override must cover every export the actions layer reaches, or a
    // caller of the uncovered one gets `undefined is not a function` from a
    // file this suite never meant to touch — audit-log-mock-is-complete.test.ts
    // holds that rule across all the local overrides.
    recordAdminAction: jest.fn(),
}));

// ─── fixtures ────────────────────────────────────────────────────────────────

const ROOT = process.cwd();
const ACTION = 'src/app/actions/export-booking.ts';
const ADMIN_SCREEN = 'src/app/admin/export/bookings/page.tsx';
const MEMBER_SCREEN = 'src/app/export/(app)/bookings/page.tsx';

const ADMIN = 'admin-7';
const MEMBER = 'member-3';
const WINDOW = 'win-1';
const BOOKING = 'bk-1';

const BOOKINGS = COLLECTIONS.EXPORT_BOOKINGS;
const WINDOWS = COLLECTIONS.EXPORT_WINDOWS;
const USERS = COLLECTIONS.USERS;

let store: FakeDbHandle;

const actions = async () => await import('@/app/actions/export-booking');

function source(rel: string): string {
    return stripComments(readFileSync(join(ROOT, rel), 'utf-8'), { label: rel });
}

/** A pending booking of `quantity`kg against WINDOW, plus its window and member. */
function seedPendingBooking(quantity = 500): void {
    store.seed(WINDOWS, WINDOW, {
        title: 'Q3 Cashew', commodity: 'cashew',
        slotPrice: 20, targetVolume: 1000, currentVolume: quantity,
        createdAt: '2026-01-01T00:00:00.000Z',
    });
    store.seed(BOOKINGS, BOOKING, {
        userId: MEMBER, exportWindowId: WINDOW,
        quantity, totalPrice: quantity * 20, status: 'pending',
        portOfOrigin: 'Lagos', vessel: 'MV Ada',
        createdAt: '2026-02-01T00:00:00.000Z',
    });
    store.seed(USERS, MEMBER, {
        fullName: 'Amina Bello', email: 'amina@example.com', phone: '08030000000',
        bvn: '22222222222', nin: '11111111111',
    });
}

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();

    mockRequireAdmin.mockResolvedValue({ userId: ADMIN });
    mockClaim.mockResolvedValue({ claimed: true, status: 'pending' });
    mockRelease.mockResolvedValue({ ok: true, value: 0 });
    mockReserve.mockResolvedValue({ ok: true, value: 0 });
    mockNotify.mockResolvedValue(undefined);
    mockAudit.mockResolvedValue(undefined);

    (global as unknown as {
        mockRequireSession: { mockImplementation: (f: () => unknown) => void };
    }).mockRequireSession.mockImplementation(() => Promise.resolve(
        { session: { user: { id: MEMBER, email: 'amina@example.com' } } },
    ));
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#380 — the premise, executed rather than remembered', () => {
    it('A PENDING BOOKING HOLDS THE WINDOW\'S CAPACITY, and the next member is refused', async () => {
        // The cost, reproduced. The reservation is a CAS increment against
        // targetVolume, so once pending bookings fill the window, a genuine
        // booking is turned away — for slots nobody has taken up.
        seedPendingBooking(1000);
        // The window is full: 1000kg of a 1000kg target already reserved by
        // bookings nobody can act on. `at_capacity` is the helper's own reason
        // string, and the refusal reads the remaining volume off it.
        mockReserve.mockResolvedValue({ ok: false, reason: 'at_capacity', value: 1000 });

        const res = await (await actions()).createBookingAction({
            exportWindowId: WINDOW, quantity: 100, totalPrice: 2000,
        }) as any;

        expect(res.success).toBe(false);
        expect(res.error).toMatch(/Only 0kg available/);
        // Nothing was written, so the refusal did not itself consume anything.
        expect(store.size(BOOKINGS)).toBe(1);
    });

    it('and the reservation really is against targetVolume, not a free counter', async () => {
        seedPendingBooking(0);

        await (await actions()).createBookingAction({
            exportWindowId: WINDOW, quantity: 100, totalPrice: 2000,
        });

        const [args] = mockReserve.mock.calls[0] as [any];
        expect(args.field).toBe('currentVolume');
        expect(args.ceilingField).toBe('targetVolume');
        expect(args.amount).toBe(100);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#380 — the export team can now act', () => {
    it('the queue is gated on the export permission, not on being any admin', async () => {
        seedPendingBooking();

        await (await actions()).getExportBookingsForAdminAction();

        expect(mockRequireAdmin).toHaveBeenCalledWith('export:approve_applications');
    });

    it('and refuses when the gate refuses, without reading a booking', async () => {
        seedPendingBooking();
        mockRequireAdmin.mockResolvedValue({ error: 'Forbidden' });

        const res = await (await actions()).getExportBookingsForAdminAction() as any;

        expect(res).toEqual({ success: false, error: 'Forbidden', data: null });
    });

    it('lists the booking with the window title and the member\'s contact', async () => {
        // Arranging payment is the job, so the name, email and phone are the
        // point of the screen.
        seedPendingBooking();

        const res = await (await actions()).getExportBookingsForAdminAction() as any;

        expect(res.success).toBe(true);
        expect(res.data).toHaveLength(1);
        expect(res.data[0]).toMatchObject({
            id: BOOKING,
            windowTitle: 'Q3 Cashew',
            windowCommodity: 'cashew',
            memberName: 'Amina Bello',
            memberEmail: 'amina@example.com',
            memberPhone: '08030000000',
            status: 'pending',
        });
    });

    it('and #151\'s rule holds: it names the fields it needs, not the whole user row', async () => {
        // The member row carries a BVN and a NIN. An export officer arranging a
        // shipment has no need of either, and eleven admin lists have already
        // been closed for exactly this.
        seedPendingBooking();

        const res = await (await actions()).getExportBookingsForAdminAction() as any;

        expect(JSON.stringify(res.data)).not.toContain('22222222222');
        expect(JSON.stringify(res.data)).not.toContain('11111111111');
    });

    it('says the window is missing rather than rendering a blank row', async () => {
        seedPendingBooking();
        store.seed(BOOKINGS, BOOKING, {
            ...store.get(BOOKINGS, BOOKING)!, exportWindowId: 'gone',
        });

        const res = await (await actions()).getExportBookingsForAdminAction() as any;

        expect(res.data[0].windowTitle).toBe('(window not found)');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#380 — the decision', () => {
    const decide = async (d: 'confirmed' | 'cancelled', id = BOOKING) =>
        (await actions()).decideExportBookingAction(id, d) as any;

    it('is gated on the same permission as the queue', async () => {
        seedPendingBooking();

        await decide('confirmed');

        expect(mockRequireAdmin).toHaveBeenCalledWith('export:approve_applications');
    });

    it('REFUSES when the gate refuses — a permission refusal is not forgiven', async () => {
        // #365's defect: three admin actions read the refusal and carried on.
        // Nothing may be claimed, released, audited or announced.
        seedPendingBooking();
        mockRequireAdmin.mockResolvedValue({ error: 'Forbidden' });

        const res = await decide('cancelled');

        expect(res).toEqual({ success: false, error: 'Forbidden', data: null });
        expect(mockClaim).not.toHaveBeenCalled();
        expect(mockRelease).not.toHaveBeenCalled();
        expect(mockAudit).not.toHaveBeenCalled();
        expect(mockNotify).not.toHaveBeenCalled();
    });

    it('CLAIMS the status rather than checking it and writing', async () => {
        // Two officers cancelling at once must not both release the volume.
        seedPendingBooking();

        await decide('cancelled');

        const [args] = mockClaim.mock.calls[0] as [any];
        expect(args).toMatchObject({
            collection: BOOKINGS, id: BOOKING,
            fromAny: ['pending'], to: 'cancelled',
        });
        expect(args.patch.decidedBy).toBe(ADMIN);
        expect(typeof args.patch.decidedAt).toBe('string');
    });

    it('records the ADMIN WHO CALLED IT, not an id the caller supplied', async () => {
        // #129/#282/#375's defect: an audit row naming whoever the browser said.
        seedPendingBooking();
        mockRequireAdmin.mockResolvedValue({ userId: 'the-real-caller' });

        await decide('confirmed');

        const [claimArgs] = mockClaim.mock.calls[0] as [any];
        expect(claimArgs.patch.decidedBy).toBe('the-real-caller');

        const [auditArgs] = mockAudit.mock.calls[0] as [any];
        expect(auditArgs.userId).toBe('the-real-caller');
        expect(auditArgs.targetId).toBe(BOOKING);
    });

    it('REFUSES A SECOND DECISION on a booking that is already decided', async () => {
        seedPendingBooking();
        mockClaim.mockResolvedValue({ claimed: false, status: 'confirmed' });

        const res = await decide('cancelled');

        expect(res.success).toBe(false);
        expect(res.error).toMatch(/already 'confirmed'/);
        // And crucially, it does NOT release the volume a second time.
        expect(mockRelease).not.toHaveBeenCalled();
    });

    it('refuses a decision this action does not define', async () => {
        seedPendingBooking();

        const res = await decide('deleted' as never);

        expect(res.success).toBe(false);
        expect(res.error).toMatch(/Unknown decision "deleted"/);
        expect(mockClaim).not.toHaveBeenCalled();
    });

    it('refuses a booking that does not exist', async () => {
        seedPendingBooking();

        const res = await decide('confirmed', 'no-such-booking');

        expect(res.success).toBe(false);
        expect(res.error).toBe('Booking not found');
        expect(mockClaim).not.toHaveBeenCalled();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#380 — THE RELEASE, which is the whole finding', () => {
    const decide = async (d: 'confirmed' | 'cancelled') =>
        (await actions()).decideExportBookingAction(BOOKING, d) as any;

    it('CANCELLING GIVES THE VOLUME BACK — exactly what was booked', async () => {
        // THE test.
        seedPendingBooking(500);

        const res = await decide('cancelled');

        expect(res.success).toBe(true);
        expect(mockRelease).toHaveBeenCalledTimes(1);
        const [args] = mockRelease.mock.calls[0] as [any];
        expect(args).toMatchObject({
            collection: WINDOWS, id: WINDOW,
            field: 'currentVolume', amount: 500, floor: 0,
        });
    });

    it('CONFIRMING RELEASES NOTHING — the shipment is going ahead', async () => {
        // The other half. A confirm that gave capacity back would let the
        // window be oversold, which is the defect the ceiling exists to stop.
        seedPendingBooking(500);

        const res = await decide('confirmed');

        expect(res.success).toBe(true);
        expect(res.data).toEqual({ status: 'confirmed' });
        expect(mockRelease).not.toHaveBeenCalled();
    });

    it('is FLOORED at zero, so a hand-repaired window is not driven negative', async () => {
        seedPendingBooking(500);

        await decide('cancelled');

        expect((mockRelease.mock.calls[0] as [any])[0].floor).toBe(0);
    });

    it('claims BEFORE it releases, so a losing racer releases nothing', async () => {
        // Order matters and is not incidental: releasing first would let two
        // simultaneous cancels both give the volume back.
        seedPendingBooking();
        const order: string[] = [];
        mockClaim.mockImplementation(async () => {
            order.push('claim'); return { claimed: true, status: 'pending' };
        });
        mockRelease.mockImplementation(async () => {
            order.push('release'); return { ok: true, value: 0 };
        });

        await decide('cancelled');

        expect(order).toEqual(['claim', 'release']);
    });

    it('does not release for a booking whose quantity is unusable', async () => {
        // A zero or NaN release would either do nothing or throw inside the
        // helper; refusing to call it is the honest answer.
        seedPendingBooking();
        store.seed(BOOKINGS, BOOKING, { ...store.get(BOOKINGS, BOOKING)!, quantity: 'lots' });

        const res = await decide('cancelled');

        expect(res.success).toBe(true);
        expect(mockRelease).not.toHaveBeenCalled();
    });

    it('REPORTS A FAILED RELEASE AS A FAILURE, naming the window to correct', async () => {
        // #307's class: the booking IS cancelled by this point, and pretending
        // the whole thing worked would leave capacity silently held forever.
        seedPendingBooking(500);
        mockRelease.mockResolvedValue({ ok: false, reason: 'row missing' });

        const res = await decide('cancelled');

        expect(res.success).toBe(false);
        expect(res.error).toContain('500kg could not be released');
        expect(res.error).toContain(WINDOW);
        expect(res.error).toMatch(/cancelled/);
    });

    it('and does NOT roll the booking back to pending on that failure', async () => {
        // A re-pending booking could be cancelled again later and release the
        // same volume twice. The stated trade is a loud failure instead.
        seedPendingBooking(500);
        mockRelease.mockResolvedValue({ ok: false, reason: 'row missing' });

        await decide('cancelled');

        const rollbacks = mockClaim.mock.calls.filter(
            (c: any[]) => c[0]?.to === 'pending');
        expect(rollbacks).toEqual([]);
        expect(mockClaim).toHaveBeenCalledTimes(1);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#380 — the member is told, and told somewhere real', () => {
    const decide = async (d: 'confirmed' | 'cancelled') =>
        (await actions()).decideExportBookingAction(BOOKING, d) as any;

    it('a confirmation reaches the member who booked', async () => {
        seedPendingBooking();

        await decide('confirmed');

        const [args] = mockNotify.mock.calls[0] as [any];
        expect(args.userId).toBe(MEMBER);
        expect(args.title).toMatch(/Confirmed/);
        expect(args.link).toBe('/export/bookings');
    });

    it('so does a cancellation, and it says the slot was released', async () => {
        seedPendingBooking();

        await decide('cancelled');

        const [args] = mockNotify.mock.calls[0] as [any];
        expect(args.title).toMatch(/Cancelled/);
        expect(args.message).toMatch(/released/);
    });

    it('THE LINK IS A ROUTE THAT EXISTS — #51\'s defect, not repeated', () => {
        // Every escrow notification once linked to a 404. The member screen
        // this points at is in the tree, and it is a protected path.
        expect(existsSync(join(ROOT, MEMBER_SCREEN))).toBe(true);

        const manifest = source('src/lib/route-manifest.ts');
        expect(manifest).toContain('"/export/bookings"');
        // And the short form the dedicated export domain serves.
        expect(manifest).toContain('"/bookings"');
    });

    it('a failed notification does not fail a decision that already landed', async () => {
        // The status is written and the volume is back; throwing here would
        // report a failure for work that succeeded.
        seedPendingBooking();
        mockNotify.mockRejectedValue(new Error('notifications down'));

        const res = await decide('cancelled');

        expect(res.success).toBe(true);
    });

    it('and the member can actually open that screen — getUserBookingsAction has a caller', async () => {
        seedPendingBooking();

        const res = await (await actions()).getUserBookingsAction() as any;

        expect(res.success).toBe(true);
        expect(res.data.map((b: any) => b.id)).toEqual([BOOKING]);
        // The screen that calls it. An import is not a call — the name alone
        // would be satisfied by a screen that imports and never invokes.
        expect(source(MEMBER_SCREEN)).toContain('await getUserBookingsAction()');
    });

    it('scoped to the caller\'s own bookings, not everybody\'s', async () => {
        seedPendingBooking();
        store.seed(BOOKINGS, 'bk-other', {
            userId: 'somebody-else', exportWindowId: WINDOW,
            quantity: 10, totalPrice: 200, status: 'pending',
            createdAt: '2026-03-01T00:00:00.000Z',
        });

        const res = await (await actions()).getUserBookingsAction() as any;

        expect(res.data.map((b: any) => b.id)).toEqual([BOOKING]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#380 — both screens have a way in', () => {
    it('the admin queue is in the admin sidebar', () => {
        // #362: a built screen with no navigation entry is a screen nobody
        // finds, and this codebase has shipped several.
        expect(existsSync(join(ROOT, ADMIN_SCREEN))).toBe(true);
        // Quote-anchored: '/admin/export/bookings' as a bare substring is also
        // satisfied by '/admin/export/bookings-soon', which routes nowhere.
        expect(source('src/components/admin/AdminSidebar.tsx'))
            .toContain('href: "/admin/export/bookings",');
    });

    it('the member list is in the export module sidebar', () => {
        expect(source('src/components/layout/ModuleSidebar.tsx'))
            .toContain('href: "/export/bookings",');
    });

    it('and neither screen renders a failed load as an empty list', () => {
        // #307. Both call the action, check `success`, and set an error state.
        for (const screen of [ADMIN_SCREEN, MEMBER_SCREEN]) {
            const src = source(screen);
            expect({ screen, checks: /if \(result\.success && result\.data\)/.test(src) })
                .toEqual({ screen, checks: true });
            expect({ screen, reports: src.includes('setError(result.error') })
                .toEqual({ screen, reports: true });
        }
    });

    it('and each names its OWN load failure, so one message cannot cover both paths', () => {
        // The admin screen has two failure paths — loading the queue and
        // deciding a booking — and asserting only that `setError(result.error`
        // appears somewhere lets the load path be replaced by setBookings([]).
        expect(source(ADMIN_SCREEN))
            .toContain('setError(result.error || "Could not load export bookings")');
        expect(source(MEMBER_SCREEN))
            .toContain('setError(result.error || "Could not load your bookings")');
    });

    it('the admin screen shows the failed-release instruction verbatim', () => {
        // That error names a window an operator has to correct by hand.
        // Summarising it away would lose the only instruction that matters.
        expect(source(ADMIN_SCREEN)).toContain('setError(result.error || "Could not update this booking")');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#380 — the reserve and the release stay together', () => {
    it('both live in the same file, deliberately', () => {
        // This codebase's recurring defect is a pair like this drifting into
        // different files and then disagreeing — #38, #179, #183, #324.
        const src = source(ACTION);

        expect(src).toContain('incrementWithinCeiling({');
        expect(src).toContain('debitJsonbBalanceWithFloor({');
        expect((src.match(/field: "currentVolume"/g) ?? []).length).toBe(2);
    });

    it('and nothing else in the codebase moves a booking off pending', () => {
        // If a second decider ever appears, it has to be found and reconciled
        // with this one rather than quietly shipped beside it.
        const src = source(ACTION);
        expect(src).toContain('export async function decideExportBookingAction');

        expect(source('src/app/actions/dashboard.ts')).not.toContain('claimStatusTransitionFromAny');
    });

    it('and these sweeps read CODE, not the prose above it', () => {
        // The tombstone trap: every claim in this suite is made against
        // comment-stripped source, so the write-up quoting a symbol cannot
        // satisfy an assertion about the symbol existing. Pinned in both
        // directions, as #311 does for the wizard copy.
        const raw = readFileSync(join(ROOT, ACTION), 'utf-8');

        expect(raw).toContain('THE DECISION, TAKEN: give the export team');
        expect(source(ACTION)).not.toContain('THE DECISION, TAKEN: give the export team');
    });

    it('the decision vocabulary is one list, used by the validator and the type', () => {
        // #382 moved the list to lib/server-action-values: a "use server" module
        // may only export async functions, so an exported array in the action
        // file failed the production build outright. The assertion follows it
        // rather than being deleted — the point is still one list, and the
        // action still validating against that same list.
        const shared = source('src/lib/server-action-values.ts');
        const src = source(ACTION);

        expect(shared).toContain('export const EXPORT_BOOKING_DECISIONS = ["confirmed", "cancelled"] as const;');
        expect(shared).toContain('typeof EXPORT_BOOKING_DECISIONS)[number]');
        expect(src).toContain('from "@/lib/server-action-values"');
        expect(src).toContain('EXPORT_BOOKING_DECISIONS.includes(decision)');
    });
});
