/**
 * @jest-environment node
 */

/**
 * Marketplace onboarding, EXECUTED — the seller/buyer application, the status
 * reconciliation behind it, and the access check.
 *
 * At 7.6%. checkMarketplaceStatusAction reconciles a status held in FOUR
 * places — the user's `serviceRegistrations.marketplace`, the seller
 * verification record, a legacy `marketplace_sellers` row and a legacy
 * `sellerVerificationStatus` field — writing back to the user record from
 * whichever it finds. None of that could be checked against a call recorder,
 * and the reconciliation is what decides whether somebody may sell.
 *
 * THE ORDERING THE SUBMISSION DEPENDS ON
 * --------------------------------------
 * Every validation runs BEFORE any upload. It used to be the other way round:
 * a submission that failed the location, bank or JSON checks had already
 * written a business registration, farm photos and product samples to storage,
 * and the seller retried and uploaded them all again — orphaned copies
 * accumulating on every failed attempt.
 *
 * That ordering is asserted here by counting uploads on a failed submission,
 * with a control that a good submission does upload. An assertion on the error
 * message alone would pass either way.
 *
 * BUYER-ONLY IS A DIFFERENT SHAPE, NOT A FLAG
 * -------------------------------------------
 * A buyer writes NO verification record, lands at `status: "active"` rather
 * than `pending`, and gains `marketplace_buyer`. A seller writes the
 * verification, lands at `pending`, and gains none of that. Both halves are
 * pinned, because "approved on submission" for one account type and not the
 * other is the sort of asymmetry that reads as a bug when it is a decision.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null,
    setCache: async () => undefined,
    deleteCache: async () => undefined,
    redis: null,
}));

const uploadFileToStorage = jest.fn(
    async (_file: unknown, destination: string, _public?: boolean) => `https://storage.test/${destination}`);
jest.mock('@/lib/storage-admin', () => ({
    uploadFileToStorage: (f: unknown, d: string, p?: boolean) => uploadFileToStorage(f, d, p),
}));

let store: FakeDbHandle;

const SELLER = 'seller-1';
const VERIFICATIONS = COLLECTIONS.SELLER_VERIFICATIONS;

function actAs(id: string | null, roles: string[] = ['user']): void {
    (globalThis as {
        mockRequireSession: { mockImplementation: (f: () => unknown) => void };
    }).mockRequireSession.mockImplementation(() => Promise.resolve(
        id === null
            ? { session: null, error: { error: 'Unauthorized' } }
            : { session: { user: { id, roles, email: 'ada@example.com', name: 'Ada Obi' } }, error: null },
    ));
}

beforeEach(() => {
    jest.clearAllMocks();
    uploadFileToStorage.mockImplementation(
        async (_f: unknown, destination: string) => `https://storage.test/${destination}`);
    store = installFakeDb();
    actAs(SELLER);
});

async function actions() {
    return import('@/app/actions/marketplace/_mp_onboarding');
}

function seedUser(extra: Record<string, unknown> = {}): void {
    store.seed(COLLECTIONS.USERS, SELLER, {
        email: 'ada@example.com',
        firstName: 'Ada',
        lastName: 'Obi',
        fullName: 'Ada Obi',
        roles: ['general_user'],
        ...extra,
    });
}

const readUser = () => store.get(COLLECTIONS.USERS, SELLER) as Record<string, any>;
const reg = () => readUser().serviceRegistrations?.marketplace ?? {};

/** A submission that satisfies every inline check. */
function submission(overrides: Record<string, unknown> = {}): FormData {
    const fd = new FormData();
    const fields: Record<string, unknown> = {
        accountType: 'seller',
        businessName: 'Obi Farms',
        businessType: 'farming',
        businessDescription: 'Rice and maize',
        phone: '08012345678',
        sellerCategory: 'wholesale',
        productionCapacity: '5 tonnes',
        location: JSON.stringify({ state: 'Plateau', lga: 'Jos North', address: '12 Market Road' }),
        bankAccount: JSON.stringify({
            bankName: 'Zenith', accountNumber: '0123456789', accountName: 'Ada Obi',
        }),
        sellerCategories: JSON.stringify(['grains']),
        certifications: JSON.stringify(['NAFDAC']),
        ...overrides,
    };
    for (const [k, v] of Object.entries(fields)) {
        if (v === undefined) continue;
        fd.set(k, String(v));
    }
    return fd;
}

/** A File the action will treat as uploadable. */
const file = (name: string) =>
    new File([new Uint8Array([1, 2, 3])], name, { type: 'image/jpeg' });

// ─────────────────────────────────────────────────────────────────────────────
describe('checkMarketplaceStatusAction', () => {
    it('refuses a caller with no session', async () => {
        actAs(null);
        const { checkMarketplaceStatusAction } = await actions();
        expect(await checkMarketplaceStatusAction()).toMatchObject({
            success: false, error: 'Unauthorized',
        });
    });

    it('returns null for somebody who has never applied', async () => {
        seedUser();
        const { checkMarketplaceStatusAction } = await actions();
        expect(await checkMarketplaceStatusAction()).toMatchObject({ success: true, data: null });
    });

    it('trusts an approved registration without reading a verification', async () => {
        seedUser({ serviceRegistrations: { marketplace: { status: 'approved', accountType: 'both' } } });
        store.seed(VERIFICATIONS, 'ver-1', { userId: SELLER, status: 'rejected' });

        const { checkMarketplaceStatusAction } = await actions();
        expect(((await checkMarketplaceStatusAction()) as any).data)
            .toMatchObject({ status: 'approved', accountType: 'both' });
    });

    it('lets the VERIFICATION correct a stale registration', async () => {
        seedUser({ serviceRegistrations: { marketplace: { status: 'pending' } } });
        store.seed(VERIFICATIONS, 'ver-1', {
            userId: SELLER, status: 'rejected', createdAt: '2026-01-01T00:00:00.000Z',
        });

        const { checkMarketplaceStatusAction } = await actions();
        expect(((await checkMarketplaceStatusAction()) as any).data.status).toBe('rejected');
    });

    it('backfills the user record when the verification says approved', async () => {
        seedUser({ serviceRegistrations: { marketplace: { status: 'pending' } } });
        store.seed(VERIFICATIONS, 'ver-1', {
            userId: SELLER, status: 'approved', accountType: 'both',
            createdAt: '2026-01-01T00:00:00.000Z',
        });

        const { checkMarketplaceStatusAction } = await actions();
        expect(((await checkMarketplaceStatusAction()) as any).data)
            .toMatchObject({ status: 'approved', accountType: 'both' });
        expect(reg()).toMatchObject({ status: 'approved', accountType: 'both' });
    });

    it('takes the most recent verification when there are several', async () => {
        seedUser();
        store.seedAll(VERIFICATIONS, {
            old: { userId: SELLER, status: 'rejected', createdAt: '2025-01-01T00:00:00.000Z' },
            recent: { userId: SELLER, status: 'under_review', createdAt: '2026-06-01T00:00:00.000Z' },
        });

        const { checkMarketplaceStatusAction } = await actions();
        expect(((await checkMarketplaceStatusAction()) as any).data.status).toBe('under_review');
    });

    it('finds the verification by the stamped id, and repairs its missing userId', async () => {
        seedUser({ serviceRegistrations: { marketplace: { verificationId: 'ver-1' } } });
        store.seed(VERIFICATIONS, 'ver-1', { status: 'under_review' });

        const { checkMarketplaceStatusAction } = await actions();
        expect(((await checkMarketplaceStatusAction()) as any).data.status).toBe('under_review');
        expect(store.get(VERIFICATIONS, 'ver-1')!.userId).toBe(SELLER);
    });

    it('also honours the older sellerVerificationId field', async () => {
        seedUser({ sellerVerificationId: 'ver-1' });
        store.seed(VERIFICATIONS, 'ver-1', { userId: SELLER, status: 'rejected' });

        const { checkMarketplaceStatusAction } = await actions();
        expect(((await checkMarketplaceStatusAction()) as any).data.status).toBe('rejected');
    });

    it('FALLBACK: adopts a legacy marketplace_sellers row and backfills from it', async () => {
        seedUser();
        store.seed(COLLECTIONS.MARKETPLACE_SELLERS, 'legacy', {
            userId: SELLER, status: 'approved', accountType: 'seller',
        });

        const { checkMarketplaceStatusAction } = await actions();
        expect(((await checkMarketplaceStatusAction()) as any).data)
            .toMatchObject({ status: 'approved', accountType: 'seller' });
        expect(reg()).toMatchObject({ status: 'approved', syncedFromLegacy: true });
    });

    it('defaults a legacy row with no status to pending', async () => {
        seedUser();
        store.seed(COLLECTIONS.MARKETPLACE_SELLERS, 'legacy', { userId: SELLER });

        const { checkMarketplaceStatusAction } = await actions();
        expect(((await checkMarketplaceStatusAction()) as any).data.status).toBe('pending');
    });

    it('FALLBACK 2: adopts the legacy sellerVerificationStatus field', async () => {
        seedUser({ sellerVerificationStatus: 'approved' });

        const { checkMarketplaceStatusAction } = await actions();
        expect(((await checkMarketplaceStatusAction()) as any).data)
            .toMatchObject({ status: 'approved', accountType: 'seller' });
        expect(reg()).toMatchObject({ status: 'approved', syncedFromLegacy: true });
    });

    it('reads only the caller\'s own verification', async () => {
        seedUser();
        store.seed(VERIFICATIONS, 'theirs', { userId: 'other-user', status: 'approved' });

        const { checkMarketplaceStatusAction } = await actions();
        expect(((await checkMarketplaceStatusAction()) as any).data).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('submitMarketplaceOnboardingAction — the refusals', () => {
    it('refuses a caller with no session', async () => {
        actAs(null);
        const { submitMarketplaceOnboardingAction } = await actions();
        expect(await submitMarketplaceOnboardingAction(submission()))
            .toMatchObject({ success: false, error: 'Unauthorized' });
    });

    it('refuses while a previous application is still being processed', async () => {
        seedUser({ serviceRegistrations: { marketplace: { status: 'under_review' } } });
        const { submitMarketplaceOnboardingAction } = await actions();
        expect(await submitMarketplaceOnboardingAction(submission())).toMatchObject({
            success: false, error: 'Your previous application is still being processed.',
        });
    });

    it('refuses somebody already registered', async () => {
        seedUser({ serviceRegistrations: { marketplace: { status: 'approved' } } });
        const { submitMarketplaceOnboardingAction } = await actions();
        expect(await submitMarketplaceOnboardingAction(submission())).toMatchObject({
            success: false, error: 'You are already registered for Marketplace.',
        });
    });

    it('lets a rejected applicant apply again', async () => {
        seedUser({ serviceRegistrations: { marketplace: { status: 'rejected' } } });
        const { submitMarketplaceOnboardingAction } = await actions();
        expect(await submitMarketplaceOnboardingAction(submission())).toMatchObject({ success: true });
    });

    it('requires an account type', async () => {
        seedUser();
        const fd = submission();
        fd.delete('accountType');

        const { submitMarketplaceOnboardingAction } = await actions();
        expect(await submitMarketplaceOnboardingAction(fd)).toMatchObject({
            success: false, error: 'Account type is required.',
        });
    });

    it('rejects an account type outside the three it knows', async () => {
        seedUser();
        const { submitMarketplaceOnboardingAction } = await actions();
        expect(await submitMarketplaceOnboardingAction(submission({ accountType: 'admin' })))
            .toMatchObject({ success: false, error: 'Invalid account type.' });
    });

    it('requires a business name that is not just spaces', async () => {
        seedUser();
        const { submitMarketplaceOnboardingAction } = await actions();
        expect(await submitMarketplaceOnboardingAction(submission({ businessName: '   ' })))
            .toMatchObject({ success: false, error: 'Business name is required.' });
    });

    it('requires the full location', async () => {
        seedUser();
        const { submitMarketplaceOnboardingAction } = await actions();
        expect(((await submitMarketplaceOnboardingAction(
            submission({ location: JSON.stringify({ state: 'Plateau' }) }))) as any).error)
            .toContain('Location details');
    });

    it('names the field when the location JSON is malformed', async () => {
        // It used to throw into the outer catch and say "Failed to submit" with
        // no clue which field was wrong — after the uploads had happened.
        seedUser();
        const { submitMarketplaceOnboardingAction } = await actions();
        expect(((await submitMarketplaceOnboardingAction(
            submission({ location: '{not json' }))) as any).error)
            .toBe('Location details could not be read. Please re-enter them.');
    });

    it('names the field when the bank JSON is malformed', async () => {
        seedUser();
        const { submitMarketplaceOnboardingAction } = await actions();
        expect(((await submitMarketplaceOnboardingAction(
            submission({ bankAccount: '{not json' }))) as any).error)
            .toBe('Bank account details could not be read. Please re-enter them.');
    });

    it('names the field when the categories JSON is malformed', async () => {
        // sellerCategories and certifications were parsed with NO guard at all,
        // while location and bankAccount twenty lines away were wrapped.
        seedUser();
        const { submitMarketplaceOnboardingAction } = await actions();
        expect(((await submitMarketplaceOnboardingAction(
            submission({ sellerCategories: '[oops' }))) as any).error)
            .toBe('Categories or certifications could not be read. Please re-select them.');
    });

    it('and when the certifications JSON is malformed', async () => {
        seedUser();
        const { submitMarketplaceOnboardingAction } = await actions();
        expect(((await submitMarketplaceOnboardingAction(
            submission({ certifications: '[oops' }))) as any).error)
            .toBe('Categories or certifications could not be read. Please re-select them.');
    });

    it('requires bank details from a SELLER', async () => {
        seedUser();
        const { submitMarketplaceOnboardingAction } = await actions();
        expect(((await submitMarketplaceOnboardingAction(
            submission({ bankAccount: JSON.stringify({ bankName: 'Zenith' }) }))) as any).error)
            .toContain('Bank account details');
    });

    it('and from BOTH', async () => {
        seedUser();
        const { submitMarketplaceOnboardingAction } = await actions();
        expect(((await submitMarketplaceOnboardingAction(
            submission({ accountType: 'both', bankAccount: '{}' }))) as any).error)
            .toContain('Bank account details');
    });

    it('but not from a buyer', async () => {
        seedUser();
        const { submitMarketplaceOnboardingAction } = await actions();
        expect(await submitMarketplaceOnboardingAction(
            submission({ accountType: 'buyer', bankAccount: '{}' })))
            .toMatchObject({ success: true });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('submitMarketplaceOnboardingAction — validation runs before any upload', () => {
    function withFiles(overrides: Record<string, unknown> = {}): FormData {
        const fd = submission(overrides);
        fd.set('businessRegistration', file('cac.jpg'));
        fd.set('farmPhotos_0', file('farm-a.jpg'));
        fd.set('farmPhotos_1', file('farm-b.jpg'));
        fd.set('productSamples_0', file('sample.jpg'));
        return fd;
    }

    it.each([
        ['a malformed location', { location: '{not json' }],
        ['an incomplete location', { location: JSON.stringify({ state: 'Plateau' }) }],
        ['a malformed bank account', { bankAccount: '{not json' }],
        ['missing bank details', { bankAccount: '{}' }],
        ['malformed categories', { sellerCategories: '[oops' }],
        ['an invalid account type', { accountType: 'admin' }],
        ['a blank business name', { businessName: ' ' }],
    ])('uploads NOTHING when the submission has %s', async (_label, override) => {
        seedUser();
        const { submitMarketplaceOnboardingAction } = await actions();

        expect(((await submitMarketplaceOnboardingAction(withFiles(override))) as any).success)
            .toBe(false);
        expect(uploadFileToStorage).not.toHaveBeenCalled();
        expect(store.size(VERIFICATIONS)).toBe(0);
    });

    it('but a good submission DOES upload — the assertions above are not vacuous', async () => {
        seedUser();
        const { submitMarketplaceOnboardingAction } = await actions();

        expect(await submitMarketplaceOnboardingAction(withFiles())).toMatchObject({ success: true });
        expect(uploadFileToStorage).toHaveBeenCalledTimes(4);
    });

    it('files the uploads under the right paths and records every URL', async () => {
        seedUser();
        const { submitMarketplaceOnboardingAction } = await actions();
        await submitMarketplaceOnboardingAction(withFiles());

        const destinations = (uploadFileToStorage.mock.calls as any[]).map((c) => c[1] as string);
        expect(destinations.filter((d) => d.startsWith(`start_selling/documents/${SELLER}/`))).toHaveLength(1);
        expect(destinations.filter((d) => d.startsWith(`start_selling/farm_photos/${SELLER}/`))).toHaveLength(2);
        expect(destinations.filter((d) => d.startsWith(`start_selling/product_samples/${SELLER}/`))).toHaveLength(1);

        const verification = store.all(VERIFICATIONS)[0][1] as Record<string, any>;
        expect(verification.documents.farmPhotoUrls).toHaveLength(2);
        expect(verification.documents.productSampleUrls).toHaveLength(1);
        expect(verification.documents.businessRegistrationUrl).toContain('start_selling/documents');
    });

    it('uploads verification documents PRIVATELY', async () => {
        seedUser();
        const { submitMarketplaceOnboardingAction } = await actions();
        await submitMarketplaceOnboardingAction(withFiles());

        for (const call of uploadFileToStorage.mock.calls as any[]) {
            expect(call[2]).toBe(false);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('submitMarketplaceOnboardingAction — what a SELLER gets', () => {
    it('writes a pending verification record carrying the submitted profile', async () => {
        seedUser();
        const { submitMarketplaceOnboardingAction } = await actions();
        await submitMarketplaceOnboardingAction(submission());

        const [, verification] = store.all(VERIFICATIONS)[0] as [string, Record<string, any>];
        expect(verification).toMatchObject({
            userId: SELLER,
            status: 'pending',
            businessName: 'Obi Farms',
            businessType: 'farming',
            accountType: 'seller',
            sellerCategory: 'wholesale',
            productionCapacity: '5 tonnes',
        });
        expect(verification.location).toMatchObject({ state: 'Plateau', lga: 'Jos North' });
        expect(verification.bankAccount).toMatchObject({ accountNumber: '0123456789' });
        expect(verification.sellerCategories).toEqual(['grains']);
        expect(verification.certifications).toEqual(['NAFDAC']);
    });

    it('lands the registration at pending, linked to the verification', async () => {
        seedUser();
        const { submitMarketplaceOnboardingAction } = await actions();
        await submitMarketplaceOnboardingAction(submission());

        const [verificationId] = store.all(VERIFICATIONS)[0];
        expect(reg()).toMatchObject({
            status: 'pending', accountType: 'seller', verificationId, sellerCategory: 'wholesale',
        });
        expect(readUser()).toMatchObject({
            isSeller: true, sellerVerificationStatus: 'pending', sellerVerificationId: verificationId,
        });
    });

    it('does NOT hand a seller the buyer role on submission', async () => {
        seedUser();
        const { submitMarketplaceOnboardingAction } = await actions();
        await submitMarketplaceOnboardingAction(submission());

        expect(readUser().roles).toEqual(['general_user']);
    });

    it('replicates the bank details and the address onto the user record', async () => {
        seedUser();
        const { submitMarketplaceOnboardingAction } = await actions();
        await submitMarketplaceOnboardingAction(submission());

        const user = readUser();
        expect(user.bankDetails).toMatchObject({
            accountNumber: '0123456789', bankName: 'Zenith', accountName: 'Ada Obi', bankCode: '',
        });
        expect(user.address).toMatchObject({
            street: '12 Market Road', state: 'Plateau', lga: 'Jos North', country: 'Nigeria',
        });
        expect(user.residentialAddress).toBe('12 Market Road');
        expect(user.location).toBe('12 Market Road, Jos North, Plateau');
    });

    it('stamps a canonical verification profile at pending', async () => {
        seedUser();
        const { submitMarketplaceOnboardingAction } = await actions();
        await submitMarketplaceOnboardingAction(submission());

        const profile = readUser().verificationProfile;
        expect(profile.isCanonical).toBe(true);
        expect(profile.status).toBe('pending');
        expect(profile.business).toMatchObject({
            name: 'Obi Farms', type: 'farming', state: 'Plateau', category: 'wholesale',
        });
        expect(profile.email).toBe('ada@example.com');
    });

    it('defaults the seller category to retail', async () => {
        seedUser();
        const fd = submission();
        fd.delete('sellerCategory');

        const { submitMarketplaceOnboardingAction } = await actions();
        await submitMarketplaceOnboardingAction(fd);

        expect(reg().sellerCategory).toBe('retail');
        expect(readUser().sellerCategory).toBe('retail');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('submitMarketplaceOnboardingAction — what a BUYER gets', () => {
    const asBuyer = () => submission({ accountType: 'buyer', bankAccount: '{}' });

    it('writes NO verification record', async () => {
        seedUser();
        const { submitMarketplaceOnboardingAction } = await actions();
        await submitMarketplaceOnboardingAction(asBuyer());

        expect(store.size(VERIFICATIONS)).toBe(0);
    });

    it('is active on submission, not pending', async () => {
        seedUser();
        const { submitMarketplaceOnboardingAction } = await actions();
        await submitMarketplaceOnboardingAction(asBuyer());

        expect(reg()).toMatchObject({
            status: 'active', paymentStatus: 'completed', accountType: 'buyer', sellerCategory: 'retail',
        });
    });

    it('gains marketplace_buyer, keeping the roles already held', async () => {
        seedUser({ roles: ['general_user', 'farmer'] });
        const { submitMarketplaceOnboardingAction } = await actions();
        await submitMarketplaceOnboardingAction(asBuyer());

        expect(readUser().roles).toEqual(['general_user', 'farmer', 'marketplace_buyer']);
    });

    it('does not duplicate the role on a second pass', async () => {
        seedUser({ roles: ['general_user', 'marketplace_buyer'] });
        const { submitMarketplaceOnboardingAction } = await actions();
        await submitMarketplaceOnboardingAction(asBuyer());

        expect(readUser().roles.filter((r: string) => r === 'marketplace_buyer')).toHaveLength(1);
    });

    it('is not marked a seller', async () => {
        seedUser();
        const { submitMarketplaceOnboardingAction } = await actions();
        await submitMarketplaceOnboardingAction(asBuyer());

        expect(readUser().isSeller).toBeUndefined();
        expect(readUser().sellerVerificationId).toBeUndefined();
        expect(readUser().verificationProfile.status).toBe('approved');
    });

    it('"both" is a seller, not a buyer', async () => {
        seedUser();
        const { submitMarketplaceOnboardingAction } = await actions();
        await submitMarketplaceOnboardingAction(submission({ accountType: 'both' }));

        expect(store.size(VERIFICATIONS)).toBe(1);
        expect(reg().status).toBe('pending');
        expect(readUser().roles).toEqual(['general_user']);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('checkMarketplaceAccessAction', () => {
    it('refuses a caller with no session', async () => {
        actAs(null);
        const { checkMarketplaceAccessAction } = await actions();
        expect(await checkMarketplaceAccessAction()).toMatchObject({
            success: false, error: 'Session expired',
        });
    });

    it('is false while the application is only pending', async () => {
        seedUser({ serviceRegistrations: { marketplace: { status: 'pending' } } });
        const { checkMarketplaceAccessAction } = await actions();
        expect(await checkMarketplaceAccessAction()).toMatchObject({ success: true, data: false });
    });

    it('is true once approved', async () => {
        seedUser({ serviceRegistrations: { marketplace: { status: 'approved' } } });
        const { checkMarketplaceAccessAction } = await actions();
        expect(await checkMarketplaceAccessAction()).toMatchObject({ success: true, data: true });
    });

    it('is true for an admin', async () => {
        actAs(SELLER, ['super_admin']);
        seedUser({ roles: ['super_admin'] });
        const { checkMarketplaceAccessAction } = await actions();
        expect(await checkMarketplaceAccessAction()).toMatchObject({ success: true, data: true });
    });
});
