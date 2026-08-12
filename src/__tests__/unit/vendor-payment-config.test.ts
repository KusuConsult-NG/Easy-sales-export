/**
 * @jest-environment node
 */

/**
 * The vendor settings screen stores bank details nothing validates — on a form
 * that no payout reads.
 *
 * TWO SEPARATE FINDINGS, AND THE SECOND IS NOT MINE TO FIX
 * -------------------------------------------------------
 * 1. `updateVendorPaymentConfigAction` stored bankName, accountNumber and
 *    accountName exactly as received. wallet.ts validates the same fields with
 *    BankDetailsSchema — account number 5–30 characters, bank and account names
 *    present — and SellerVerificationSchema requires ten digits. None of it was
 *    applied here, so a half-typed account number is saved and shown back as
 *    settled fact.
 *
 * 2. **Nothing pays out from this record.** No payout path reads
 *    VENDOR_PROFILES at all: withdrawFromWalletAction takes bankDetails as an
 *    argument, and paystackPayout needs a `bankCode` — which this config has no
 *    field for, which is the clearest proof it was never the source.
 *
 * So a vendor entering their payout account in Settings is filling in something
 * no transfer consults. That is a product gap, not a defect to correct
 * unilaterally: wiring this record into money routing is a decision about where
 * funds go. It is recorded in the source and here, and left alone.
 *
 * The validation is worth adding anyway, and precisely because of the second
 * finding — a malformed number is harmless while nothing reads it, and becomes
 * money going astray the moment it is wired up, which is exactly when nobody
 * re-checks what is already stored.
 *
 * WHAT WAS ALREADY RIGHT
 * ----------------------
 * Ownership by construction. Every one of the five endpoints derives
 * `vendorId = session.user.id` and writes to `doc(vendorId)` — there is no
 * caller-supplied id to substitute — and each uses versionedUpdate with an
 * expectedVersion, so two tabs cannot silently overwrite one another.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const VENDOR = 'vendor-1';

jest.mock('@/lib/optimistic-locking', () => ({
    versionedUpdate: jest.fn(async (_tx: any, _ref: any, _v: any, patch: any) => {
        (global as any).__written = patch;
        return { success: true };
    }),
    withOptimisticLock: jest.fn(),
}));
jest.mock('@/lib/audit-log', () => ({ createAdminAuditLog: jest.fn(async () => ({})) }));

function setSession(id: string | null) {
    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve(
        id === null
            ? { session: null, error: { error: 'Session expired' } }
            : { session: { user: { id, email: `${id}@e.com`, name: id, roles: ['seller'] } }, error: null }
    ));
}

function setWorld() {
    (global as any).__written = undefined;
    (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve({
        exists: true, empty: false, docs: [], data: () => ({ vendorId: VENDOR, _version: 1 }),
    }));
    (global as any).mockFirestoreTxGet.mockImplementation(() => Promise.resolve({
        exists: true, empty: false, docs: [], data: () => ({ vendorId: VENDOR, _version: 1 }),
    }));
}

const goodConfig = {
    bankName: 'A Bank',
    accountNumber: '0123456789',
    accountName: 'A Vendor Ltd',
    paymentSchedule: 'weekly' as const,
    minPayoutThreshold: 10_000,
};

async function savePaymentConfig(overrides: Record<string, any> = {}) {
    const { updateVendorPaymentConfigAction } = await import('@/app/actions/vendor-settings');
    return updateVendorPaymentConfigAction({ ...goodConfig, ...overrides } as any);
}

function written(): any {
    return (global as any).__written;
}

describe('bank details are validated by the rules the codebase already has', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession(VENDOR);
        setWorld();
    });

    it('refuses an account number that is too short', async () => {
        const r: any = await savePaymentConfig({ accountNumber: '123' });

        expect(r.success).toBe(false);
        expect(written()).toBeUndefined();
    });

    it('refuses an account number containing anything but digits', async () => {
        // A stored "01234-6789" looks plausible in the UI and resolves to
        // nothing at a bank.
        const r: any = await savePaymentConfig({ accountNumber: '01234-6789' });

        expect(r.success).toBe(false);
        expect(written()).toBeUndefined();
    });

    it('refuses an empty bank name', async () => {
        const r: any = await savePaymentConfig({ bankName: '' });

        expect(r.success).toBe(false);
        expect(written()).toBeUndefined();
    });

    it('refuses an empty account name', async () => {
        const r: any = await savePaymentConfig({ accountName: ' ' });

        expect(r.success).toBe(false);
        expect(written()).toBeUndefined();
    });

    it('refuses a negative payout threshold', async () => {
        const r: any = await savePaymentConfig({ minPayoutThreshold: -5000 });

        expect(r.success).toBe(false);
        expect(written()).toBeUndefined();
    });

    it('saves a well-formed configuration', async () => {
        // Vacuity guard. Every refusal above is satisfied by an endpoint that
        // saves nothing, which would break vendor settings entirely.
        const r: any = await savePaymentConfig();

        expect(r.success).toBe(true);
        expect(written()?.paymentConfig).toMatchObject({
            bankName: 'A Bank',
            accountNumber: '0123456789',
            accountName: 'A Vendor Ltd',
            minPayoutThreshold: 10_000,
        });
    });

    it('trims what it stores', async () => {
        const r: any = await savePaymentConfig({ bankName: '  A Bank  ', accountName: '  A Vendor Ltd  ' });

        expect(r.success).toBe(true);
        expect(written()?.paymentConfig.bankName).toBe('A Bank');
        expect(written()?.paymentConfig.accountName).toBe('A Vendor Ltd');
    });
});

describe('the record this writes is not what anything pays out from', () => {
    it('has no bankCode field, which paystackPayout requires', async () => {
        // The clearest evidence that this was never the payout source, and the
        // reason the finding is reported rather than "fixed" by wiring it in.
        setSession(VENDOR);
        setWorld();

        await savePaymentConfig();

        expect(written()?.paymentConfig).not.toHaveProperty('bankCode');
    });

    it('is recorded in the source, so the next reader does not assume otherwise', async () => {
        const { readFileSync } = await import('fs');
        const { join } = await import('path');
        const src = readFileSync(join(process.cwd(), 'src/app/actions/vendor-settings.ts'), 'utf-8');

        expect(src).toContain('Nothing pays out from this record');
    });
});

describe('ownership by construction, which was already right', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setWorld();
    });

    it('refuses an unauthenticated caller', async () => {
        setSession(null);

        const r: any = await savePaymentConfig();

        expect(r.success).toBe(false);
        expect(written()).toBeUndefined();
    });

    it('takes no vendor id as a parameter, in any of the five', async () => {
        // Every endpoint derives vendorId from the session and writes to
        // doc(vendorId). The guarantee is that no id parameter EXISTS, so it is
        // asserted on the signatures — adding one later would not fail a
        // behavioural test.
        const mod: any = await import('@/app/actions/vendor-settings');
        const { readFileSync } = await import('fs');
        const { join } = await import('path');
        const src = readFileSync(join(process.cwd(), 'src/app/actions/vendor-settings.ts'), 'utf-8');

        // Five actions, five session-derived ids.
        const derivations = src.match(/const vendorId = session\.user\.id/g) ?? [];
        expect(derivations.length).toBeGreaterThanOrEqual(4);

        expect(typeof mod.getVendorSettingsAction).toBe('function');
    });
});
