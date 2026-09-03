/**
 * @jest-environment node
 */

/**
 * wave/_actions.ts — 1,731 lines, 22 exported endpoints, 24 writes, no tests.
 *
 * THE DEFECT FOUND
 * ----------------
 * `enrollInWaveAction(userId)` wrote
 * `"serviceRegistrations.wave.status": "approved"` unconditionally.
 *
 * It is ownership-guarded — you may only enrol yourself — which is exactly what
 * made it useful to an attacker who is the applicant. The review path in
 * _admin.ts reaches that same field through `claimStatusTransition`, so an
 * approval or a rejection is claimed once, audited, and emailed. This endpoint
 * then overwrote the outcome with no claim and no reviewer.
 *
 * So a **rejected applicant could approve herself**, and one in
 * `revision_required` could skip the revisions she was asked for.
 * `checkModuleAccess` scores "approved" as full access (4 of 4), so the flip was
 * worth having.
 *
 * `checkWaveEligibilityAction` — the only gate enrolment consulted — never looks
 * at application status at all. It decides on gender, admin role and Academy
 * Elite membership, and returns `eligible: true` for everyone else. It was never
 * the review.
 *
 * The action has no UI caller. That is not a defence: every export of a
 * `"use server"` module is a POST endpoint whether the app calls it or not.
 *
 * WHAT WAS ALREADY CORRECT, AND IS NOW HELD
 * -----------------------------------------
 * The money and identity paths, which is why the rest of this file is
 * regression cover rather than fixes:
 *
 *   withdrawEarningsAction    debits with debitJsonbBalance before writing the
 *                             request, so two concurrent withdrawals cannot both
 *                             pass against one snapshot. Its own comment records
 *                             the earlier check-then-write bug.
 *   calculateEarningsAction   self-or-admin
 *   getShipmentTracking /
 *   getMemberCertificates     self only — these carry member PII
 *   generateCertificate,
 *   uploadWaveResource,
 *   requestWaveRevision,
 *   updateShipmentStatus      admin only
 *
 * WHAT IS NOT ASSERTED, DELIBERATELY
 * ----------------------------------
 * That `enrollInWaveAction` should refuse a user with no WAVE registration at
 * all. It should not — that is the case the endpoint exists for. The fix draws
 * the line at statuses the review owns, not at enrolment itself.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const MEMBER = 'member-1';
const OTHER = 'other-1';
const ADMIN = 'admin-1';

const mockDebitJsonb = jest.fn() as jest.Mock<any>;

jest.mock('@/lib/wallet-ledger', () => ({
    debitJsonbBalance: (...a: any[]) => mockDebitJsonb(...a),
    debitJsonbBalanceWithFloor: jest.fn(), claimPaymentOnce: jest.fn(),
    creditWalletOnce: jest.fn(), debitWalletOnce: jest.fn(), debitWalletLocked: jest.fn(),
    claimVersionedUpdate: jest.fn(), claimIdempotencyKey: jest.fn(),
    incrementWithinCeiling: jest.fn(), decrementManyOrFail: jest.fn(),
    claimSingleOpenLoanApplication: jest.fn(),
}));
jest.mock('@/lib/status-transition', () => ({
    claimStatusTransition: jest.fn(async () => ({ claimed: true })),
    claimStatusTransitionFromAny: jest.fn(async () => ({ claimed: true })),
}));
jest.mock('@/lib/audit-log', () => ({
    recordAdminAction: (p: any) => (global as any).mockRecordAdminAction(p),
    createAdminAuditLog: jest.fn(async () => ({})),
    logAdminAction: jest.fn(async () => ({})),
    logAdminFinancialAction: jest.fn(async () => ({})),
}));
jest.mock('@/app/actions/notifications', () => ({
    createNotificationAction: jest.fn(async () => ({})),
    createBulkNotificationsAction: jest.fn(async () => ({})),
}));

function setSession(id: string, roles: string[] = []) {
    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id, email: `${id}@e.com`, name: id, roles } },
        error: null,
    }));
}

/** The caller's own user document, with whatever WAVE registration is set. */
function setUser(wave: Record<string, any> | null, extra: Record<string, any> = {}) {
    (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve({
        exists: true, empty: false, docs: [],
        data: () => ({
            name: 'A Member', gender: 'Female', roles: [],
            serviceRegistrations: wave ? { wave } : {},
            ...extra,
        }),
    }));
}

/** The status patch enrolment tried to write, if it wrote one. */
function waveStatusWrites(): string[] {
    return (global as any).mockFirestoreUpdate.mock.calls
        .map((c: any[]) => c[c.length - 1])
        .filter((p: any) => p && 'serviceRegistrations.wave.status' in p)
        .map((p: any) => p['serviceRegistrations.wave.status']);
}

describe('enrollInWaveAction — a review decision is not the applicant\'s to overwrite', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession(MEMBER);
    });

    async function enroll(target = MEMBER) {
        const { enrollInWaveAction } = await import('@/app/actions/wave/_wv_membership');
        return enrollInWaveAction(target);
    }

    it('refuses a rejected applicant, rather than approving her', async () => {
        // THE test. An admin rejected this application through a claimed,
        // audited transition; enrolment wrote "approved" over the top.
        setUser({ status: 'rejected', applicationId: 'app-1' });

        const r: any = await enroll();

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/rejected/i);
        expect(waveStatusWrites()).not.toContain('approved');
    });

    it('refuses an applicant asked for revisions', async () => {
        setUser({ status: 'revision_required', applicationId: 'app-1' });

        const r: any = await enroll();

        expect(r.success).toBe(false);
        expect(waveStatusWrites()).not.toContain('approved');
    });

    it('refuses an application still awaiting review, rather than skipping it', async () => {
        setUser({ status: 'pending', applicationId: 'app-1' });

        const r: any = await enroll();

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/awaiting review/i);
        expect(waveStatusWrites()).not.toContain('approved');
    });

    it('refuses a suspended member', async () => {
        setUser({ status: 'suspended', applicationId: 'app-1' });

        const r: any = await enroll();

        expect(r.success).toBe(false);
        expect(waveStatusWrites()).not.toContain('approved');
    });

    it('still enrols someone the admins have not ruled on', async () => {
        // Vacuity guard. Every refusal above is satisfied by an action that
        // enrols nobody, which would remove the endpoint's whole purpose — and
        // the four tests above would still pass.
        setUser(null);

        const r: any = await enroll();

        expect(r.success).toBe(true);
        expect(waveStatusWrites()).toContain('approved');
    });

    it('still refuses to enrol somebody else', async () => {
        // The guard that was already there. The fix must not disturb it.
        setUser(null);

        const r: any = await enroll(OTHER);

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/another user/i);
    });

    it('checks the status before writing the members row', async () => {
        // The read used to happen AFTER the WAVE_MEMBERS write, so a refused
        // caller still left an active membership record behind.
        setUser({ status: 'rejected', applicationId: 'app-1' });

        await enroll();

        const memberWrites = (global as any).mockFirestoreSet.mock.calls
            .map((c: any[]) => c[c.length - 1])
            .filter((d: any) => d && 'enrolledAt' in d);
        expect(memberWrites).toHaveLength(0);
    });
});

/**
 * withdrawEarningsAction is SWITCHED OFF, and that is the headline about it.
 *
 * The first line of the function body is an unconditional
 *
 *     // WAVE withdrawals are currently disabled
 *     return { success: false, error: "...disabled for maintenance..." }
 *
 * so the ~90 lines below it — the ₦5,000 floor, the atomic debit, the
 * withdrawal record — never run. WAVE members who have sold goods have earnings
 * credited to `serviceRegistrations.wave.waveEarningsBalance` by
 * order-management.ts and no way to draw them.
 *
 * This was found by writing the three tests that used to be here. They asserted
 * the debit, the floor and the insufficient-funds message; all three failed with
 * "withdrawals are currently disabled", which is the same shape as the wallet
 * feature toggle that made an earlier suite vacuous. Had they asserted only
 * `success === false` they would have passed, and this file would have claimed
 * to cover a money path that cannot execute.
 *
 * It is NOT re-enabled here. Whether members may draw earnings is a product
 * decision — the same one the operator took deliberately for `wallet_deposits`
 * and `wallet_withdrawals` — and this is a hardcoded return, not a toggle
 * anybody can flip back without a deploy. Reported rather than reversed.
 *
 * So the behaviour asserted below is the real one, plus a structural check that
 * the dormant code is still correct for whenever the return is removed. The
 * structural half is weaker than executing it, and is labelled that way rather
 * than dressed up.
 */
describe('withdrawEarningsAction — disabled, with the money code dormant beneath', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession(MEMBER);
        setUser({ status: 'approved', waveEarningsBalance: 100_000 });
        mockDebitJsonb.mockResolvedValue({ ok: true, balance: 50_000, reason: null });
    });

    /**
     * One argument. The destination bank details are read from the member's own
     * user record inside the action, not accepted from the caller — which is
     * the right shape, and worth noting because a withdrawal endpoint that took
     * an account number as a parameter would be the defect this audit looks for.
     */
    async function withdraw(amount: number) {
        const { withdrawEarningsAction } = await import('@/app/actions/wave/_wv_earnings');
        return withdrawEarningsAction(amount);
    }

    it('refuses every withdrawal, and touches no balance doing it', async () => {
        const r: any = await withdraw(50_000);

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/disabled/i);
        expect(mockDebitJsonb).not.toHaveBeenCalled();
    });

    it('refuses a withdrawal that would otherwise be valid, not just an invalid one', async () => {
        // Distinguishes "switched off" from "rejected on its merits". A ₦5,000
        // request from a member holding ₦100,000 is refused for the same reason
        // as a ₦1 one.
        const r: any = await withdraw(5_000);

        expect(String(r.error)).toMatch(/disabled/i);
    });

    it('still debits atomically, and before writing the request, once re-enabled', async () => {
        // STRUCTURAL — the code cannot be executed while the early return
        // stands. It asserts the ordering that matters: two withdrawals
        // submitted together both passed against one snapshot and both debited,
        // because the hasPendingWithdrawal flag was a check-then-write inside
        // the same lock-free transaction. Taking the money first is what fixed
        // it, and a future edit that re-enables the endpoint must not undo that.
        const { readFileSync } = await import('fs');
        const { join } = await import('path');
        const src = readFileSync(join(process.cwd(), 'src/app/actions/wave/_wv_earnings.ts'), 'utf-8');

        const fn = src.slice(src.indexOf('async function _withdrawEarningsAction'));
        const body = fn.slice(0, fn.indexOf('\n}\n'));

        const debitAt = body.indexOf('debitJsonbBalance');
        const recordAt = body.indexOf('transaction.set(withdrawalRef');

        expect(debitAt).toBeGreaterThan(-1);
        expect(recordAt).toBeGreaterThan(-1);
        expect(debitAt).toBeLessThan(recordAt);
        expect(body).toContain('serviceRegistrations.wave.waveEarningsBalance');
    });
});

describe('the admin-only endpoints refuse a member', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession(MEMBER);
        setUser({ status: 'approved' });
    });

    const cases: Array<[string, any[]]> = [
        ['generateCertificateAction', [OTHER, 'Programme', 'completion']],
        ['uploadWaveResourceAction', [{ title: 'x', url: 'https://e', category: 'guide' }]],
        ['requestWaveRevisionAction', ['app-1', 'please fix']],
        ['updateShipmentStatusAction', ['ship-1', 'delivered']],
    ];

    for (const [name, args] of cases) {
        it(`${name} refuses a non-admin`, async () => {
            const mod: any = await import('@/app/actions/wave');

            const r = await mod[name](...args).catch((e: any) => ({ success: false, error: String(e) }));

            expect(r.success).toBe(false);
            // The assertion was /admin/i, which pinned the WORDING of the
            // refusal rather than the refusal. generateCertificateAction now
            // says "Permission required - wave:manage_training" (#158) — it
            // still refuses this member, and refuses more roles than before,
            // but the word "admin" is gone from the message. Matching either
            // vocabulary keeps the test about whether the member is turned away.
            expect(String(r.error)).toMatch(/admin|permission required|unauthorized/i);
        });
    }

    it('lets an admin through, so the refusals above mean something', async () => {
        // Without this, every case above passes against an endpoint that fails
        // for any caller — which is how a previous suite passed with the real
        // requireAdmin left unmocked.
        setSession(ADMIN, ['admin']);
        const { uploadWaveResourceAction } = await import('@/app/actions/wave/_wv_resources');

        const r: any = await uploadWaveResourceAction({ title: 'x', url: 'https://e', category: 'guide' } as any);

        expect(r.success).toBe(true);
    });
});

describe('the member-scoped reads refuse another member', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession(MEMBER);
        setUser({ status: 'approved' });
    });

    const cases: Array<[string, any[]]> = [
        ['getShipmentTrackingAction', [OTHER]],
        ['getMemberCertificatesAction', [OTHER]],
        ['calculateEarningsAction', [OTHER]],
    ];

    for (const [name, args] of cases) {
        it(`${name} refuses a caller asking about somebody else`, async () => {
            // These carry member PII and earnings. The platform has already had
            // one user-data exposure this month; these are the reads that would
            // be the next one.
            const mod: any = await import('@/app/actions/wave');

            const r = await mod[name](...args).catch((e: any) => ({ success: false, error: String(e) }));

            expect(r.success).toBe(false);
            expect(String(r.error)).toMatch(/unauthori[sz]ed/i);
        });
    }

    it('lets a member read her own certificates', async () => {
        // Vacuity guard for the three refusals above.
        (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve({
            exists: true, empty: true, docs: [], data: () => ({}),
        }));
        const { getMemberCertificatesAction } = await import('@/app/actions/wave/_wv_certificates');

        const r: any = await getMemberCertificatesAction(MEMBER);

        expect(r.success).toBe(true);
    });
});
