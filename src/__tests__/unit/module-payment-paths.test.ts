/**
 * @jest-environment node
 */

/**
 * The remaining module payment paths: WAVE admin, academy, farm nation.
 *
 * WHAT WAS WRONG
 * --------------
 * processWaveWithdrawalAction was labelled "PHASE 1: ATOMIC STATE TRANSITION &
 * LOCKING", and its approve branch carried the comment "Lock for processing to
 * prevent double-payouts". Neither was true — every branch read the status,
 * compared it, and wrote, inside runTransaction, which takes no lock. Two of
 * the three branches move money:
 *
 *   reject   restores waveEarningsBalance, so two rejections of one withdrawal
 *            grew the member's earnings by the withdrawn amount twice.
 *   approve  moves the request into the state the automated payout runs from,
 *            so two approvals set up two payouts of one request.
 *
 * The WAVE application verdicts had the shape seen on cooperative withdrawals:
 * approve and reject read the same two statuses and write opposite answers, so
 * an approval and a rejection landing together both passed and the applicant
 * was granted the role AND marked rejected.
 *
 * The academy and farm-nation callbacks decided whether to fulfil by reading
 * processed_payments and writing the marker afterwards — the same client/webhook
 * double fulfilment fixed in the export module.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const mockClaim = jest.fn() as jest.Mock<any>;
const mockClaimFromAny = jest.fn() as jest.Mock<any>;
const mockClaimPaymentOnce = jest.fn() as jest.Mock<any>;

jest.mock('@/lib/status-transition', () => ({
    claimStatusTransition: (...args: any[]) => mockClaim(...args),
    claimStatusTransitionFromAny: (...args: any[]) => mockClaimFromAny(...args),
}));

jest.mock('@/lib/wallet-ledger', () => ({
    claimPaymentOnce: (...args: any[]) => mockClaimPaymentOnce(...args),
}));

const mockVerifyPaystack = jest.fn() as jest.Mock<any>;
jest.mock('@/lib/paystack-server', () => ({
    verifyPaystackPayment: (...args: any[]) => mockVerifyPaystack(...args),
    initializePaystackPayment: jest.fn(),
}));

function setSession(id: string, roles: string[] = ['admin', 'super_admin']) {
    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id, name: id, email: `${id}@example.com`, roles } },
        error: null,
    }));
}

function setDocs(data: Record<string, any>) {
    const snap = {
        exists: true,
        data: () => data,
        docs: [{ id: 'doc-1', data: () => data, ref: { update: jest.fn(), set: jest.fn() } }],
        empty: false,
        id: 'doc-1',
    };
    (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve(snap));
    (global as any).mockFirestoreTxGet.mockImplementation(() => Promise.resolve(snap));
}

describe('processWaveWithdrawalAction', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession('admin-A');
        mockClaim.mockResolvedValue({ claimed: true, status: 'rejected' });
        mockClaimFromAny.mockResolvedValue({ claimed: true, status: 'completed' });
        setDocs({ userId: 'member-1', amount: 30_000, status: 'pending' });
    });

    it('restores no earnings when the rejection claim is lost', async () => {
        // THE test. Two rejections both restored waveEarningsBalance, so the
        // member's earnings grew by the withdrawn amount twice.
        mockClaim.mockResolvedValue({ claimed: false, status: 'rejected' });

        const { processWaveWithdrawalAction } = await import('@/app/actions/wave/_wv_admin_withdrawals');
        const result = await processWaveWithdrawalAction({
            withdrawalId: 'wd-1', action: 'reject', adminNotes: 'no',
        } as any);

        expect(result.success).toBe(false);
        expect((global as any).mockFirestoreUpdate).not.toHaveBeenCalled();
    });

    it('claims pending → rejected before restoring the balance', async () => {
        const { processWaveWithdrawalAction } = await import('@/app/actions/wave/_wv_admin_withdrawals');
        await processWaveWithdrawalAction({
            withdrawalId: 'wd-1', action: 'reject', adminNotes: 'no',
        } as any);

        const call = mockClaim.mock.calls[0][0] as any;
        expect(call.from).toBe('pending');
        expect(call.to).toBe('rejected');

        // And the restore is an increment, never a computed total.
        const update = (global as any).mockFirestoreUpdate.mock.calls[0][1];
        expect(update['serviceRegistrations.wave.waveEarningsBalance']).toMatchObject({
            _methodName: 'FieldValue.increment',
            _operand: 30_000,
        });
    });

    it('locks the request for payout by claiming, not by writing', async () => {
        mockClaim.mockResolvedValue({ claimed: true, status: 'approved_processing' });

        const { processWaveWithdrawalAction } = await import('@/app/actions/wave/_wv_admin_withdrawals');
        await processWaveWithdrawalAction({ withdrawalId: 'wd-1', action: 'approve' } as any);

        const call = mockClaim.mock.calls[0][0] as any;
        expect(call.from).toBe('pending');
        expect(call.to).toBe('approved_processing');
    });

    it('does not set up a second payout when the approval claim is lost', async () => {
        mockClaim.mockResolvedValue({ claimed: false, status: 'approved_processing' });

        const { processWaveWithdrawalAction } = await import('@/app/actions/wave/_wv_admin_withdrawals');
        const result = await processWaveWithdrawalAction({ withdrawalId: 'wd-1', action: 'approve' } as any);

        expect(result.success).toBe(false);
    });
});

describe('WAVE application verdicts', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession('admin-A');
        mockClaimFromAny.mockResolvedValue({ claimed: true, status: 'approved' });
        setDocs({ userId: 'applicant-1', status: 'pending', email: 'a@e.com' });
    });

    it('claims the approval from the reviewable states only', async () => {
        const { approveWaveApplicationAction } = await import('@/app/actions/wave/_wv_admin_applications');
        await approveWaveApplicationAction('app-1');

        const call = mockClaimFromAny.mock.calls[0][0] as any;
        expect(call.fromAny).toEqual(['pending', 'under_review']);
        expect(call.to).toBe('approved');
    });

    it('grants no role when the approval claim is lost', async () => {
        // An approval racing a rejection: both passed, and the applicant was
        // granted the role AND marked rejected.
        mockClaimFromAny.mockResolvedValue({ claimed: false, status: 'rejected' });

        const { approveWaveApplicationAction } = await import('@/app/actions/wave/_wv_admin_applications');
        const result = await approveWaveApplicationAction('app-1');

        expect(result.success).toBe(false);
        expect((global as any).mockFirestoreUpdate).not.toHaveBeenCalled();
    });

    it('claims the rejection from the same states', async () => {
        mockClaimFromAny.mockResolvedValue({ claimed: true, status: 'rejected' });

        const { rejectWaveApplicationAction } = await import('@/app/actions/wave/_wv_admin_applications');
        await rejectWaveApplicationAction('app-1', 'incomplete');

        const call = mockClaimFromAny.mock.calls[0][0] as any;
        expect(call.fromAny).toEqual(['pending', 'under_review']);
        expect(call.to).toBe('rejected');
        expect(call.patch.rejectionReason).toBe('incomplete');
    });
});

describe('academy enrolment verification', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession('student-1', ['user']);
        mockClaimPaymentOnce.mockResolvedValue({ claimed: true, status: null });
        mockVerifyPaystack.mockResolvedValue({
            status: true,
            data: {
                status: 'success',
                amount: 5_000_00,
                metadata: { userId: 'student-1', courseId: 'course-1' },
            },
        });
        setDocs({ price: 5_000, students: 12 });
    });

    it('raises the student count by increment, never by a computed total', async () => {
        // `students: currentStudents + 1` lost a concurrent enrolment from the
        // course tally.
        const { verifyEnrollmentPaymentAction } = await import('@/app/actions/academy/_payment');
        await verifyEnrollmentPaymentAction('PSK-A');

        const updates = (global as any).mockFirestoreUpdate.mock.calls.map((c: any) => c[1]);
        const courseUpdate = updates.find((u: any) => u.students !== undefined);
        expect(courseUpdate.students).toMatchObject({
            _methodName: 'FieldValue.increment',
            _operand: 1,
        });
    });

    it('enrols nobody when the webhook already claimed the payment', async () => {
        mockClaimPaymentOnce.mockResolvedValue({ claimed: false, status: 'completed' });

        const { verifyEnrollmentPaymentAction } = await import('@/app/actions/academy/_payment');
        const result = await verifyEnrollmentPaymentAction('PSK-A');

        expect((global as any).mockFirestoreUpdate).not.toHaveBeenCalled();
        // A duplicate delivery is a success, not an error.
        expect(result.success).toBe(true);
    });

    it('records an enrolment fee as revenue, which it is', async () => {
        const { verifyEnrollmentPaymentAction } = await import('@/app/actions/academy/_payment');
        await verifyEnrollmentPaymentAction('PSK-A');

        const claim = mockClaimPaymentOnce.mock.calls[0][0] as any;
        // Unlike a disbursement or an escrow release, this one IS money in.
        expect(claim.status ?? 'completed').toBe('completed');
    });
});
