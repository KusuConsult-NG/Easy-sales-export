/**
 * @jest-environment node
 */

/**
 * Four land-listing actions that took identity from the request.
 *
 * THE WORST OF THEM: _submitForVerificationAction
 * -----------------------------------------------
 * No session guard at all, and an ownership check that compared the record's
 * owner to a value the CALLER supplied:
 *
 *     async function _submitForVerificationAction(listingId, ownerId) {
 *         ...
 *         if (listingData.ownerId !== ownerId) return { error: "Unauthorized" };
 *
 * Pass the real owner's id and the check passes. The id is not even a secret —
 * `getPropertyByIdAction` is public and returns the listing, `ownerId` included.
 *
 * **That is worse than no check, because it reads as one.** Anyone reviewing the
 * file sees an "Unauthorized" branch and moves on.
 *
 * `_verifyLandListingAction`, the very next function in the file, has always
 * called requireSession and checked isAdmin. The guard was on the sibling.
 *
 * THE OTHER THREE
 * ---------------
 * `_createLandListingAction` and `_submitLandListingAction` took `ownerId` from
 * the request with no session, so a listing could be published in anyone's name.
 * The second is live — /land/submit and farm-nation/list-land both call it — and
 * both callers already pass `session.user.id`, so reading it server-side changes
 * nothing they do and makes the value trustworthy.
 *
 * `_submitLandInquiryAction` stays PUBLIC, which is a product decision: enquiring
 * about land should not require an account. What was wrong is narrower — it took
 * `listingOwnerId` and `listingTitle` from the request and passed them into
 * createNotificationAction. That is an open endpoint for sending a notification
 * to any user, with an attacker-chosen title and body, wearing the platform's
 * branding.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const OWNER = 'owner-1';
const ATTACKER = 'attacker-1';
const VICTIM = 'victim-1';

const mockNotify = jest.fn(async () => ({}));
jest.mock('@/app/actions/notifications', () => ({
    createNotificationAction: (...a: any[]) => (mockNotify as any)(...a),
}));
jest.mock('@/lib/audit-log', () => ({
    createAdminAuditLog: jest.fn(async () => ({})),
    logAdminAction: jest.fn(async () => ({})),
    logAdminFinancialAction: jest.fn(async () => ({})),
}));
jest.mock('next/cache', () => ({ revalidateTag: jest.fn() }));
jest.mock('@/lib/cache-invalidation', () => ({ invalidateAdminGlobalStats: jest.fn() }));

function setSession(id: string | null, roles: string[] = []) {
    (global as any).mockRequireSession.mockImplementation(() =>
        id === null
            ? Promise.resolve({ session: null, error: { error: 'Authentication required' } })
            : Promise.resolve({ session: { user: { id, name: id, email: `${id}@e.com`, roles } }, error: null })
    );
}

/** A listing owned by OWNER. */
function setListing(exists = true) {
    (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve({
        exists,
        empty: !exists,
        docs: [],
        data: () => ({ ownerId: OWNER, title: 'Two hectares near Abeokuta', status: 'draft' }),
    }));
}

/** The document written by the last .add() call. */
function added(): Record<string, any> | undefined {
    const calls = (global as any).mockFirestoreAdd.mock.calls;
    return calls.length ? calls[calls.length - 1][1] : undefined;
}

describe('_submitForVerificationAction — the check that checked nothing', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setListing();
    });

    it('refuses an attacker who passes the real owner id', async () => {
        // THE test. This is exactly what the old code permitted: the attacker
        // reads ownerId from the public listing and hands it back.
        setSession(ATTACKER);
        const { submitForVerificationAction } = await import('@/app/actions/land-listings');

        const r: any = await submitForVerificationAction('listing-1', OWNER);

        expect(r.success).toBe(false);
        expect((global as any).mockFirestoreUpdate).not.toHaveBeenCalled();
    });

    it('refuses an unauthenticated caller', async () => {
        setSession(null);
        const { submitForVerificationAction } = await import('@/app/actions/land-listings');

        const r: any = await submitForVerificationAction('listing-1', OWNER);

        expect(r.success).toBe(false);
    });

    it('still lets the real owner submit', async () => {
        // Vacuity guard: the refusals must not be satisfied by a function that
        // now rejects everyone.
        setSession(OWNER);
        const { submitForVerificationAction } = await import('@/app/actions/land-listings');

        const r: any = await submitForVerificationAction('listing-1', OWNER);

        expect(r.success).toBe(true);
        expect((global as any).mockFirestoreUpdate).toHaveBeenCalled();
    });

    it('lets an admin submit on the owner behalf', async () => {
        setSession('admin-1', ['admin']);
        const { submitForVerificationAction } = await import('@/app/actions/land-listings');

        const r: any = await submitForVerificationAction('listing-1', OWNER);

        expect(r.success).toBe(true);
    });
});

describe('creating a listing', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setListing();
    });

    it('records the session user as owner, not the request', async () => {
        setSession(ATTACKER);
        const { createLandListingAction } = await import('@/app/actions/land-listings');

        await createLandListingAction({
            ownerId: VICTIM, ownerName: 'Victim', ownerEmail: 'v@e.com',
            title: 'x', description: 'x',
            location: { state: 's', lga: 'l', address: 'a' },
            size: 1, price: 1,
        } as any);

        expect(added()?.ownerId).toBe(ATTACKER);
    });

    it('refuses an unauthenticated caller', async () => {
        setSession(null);
        const { createLandListingAction } = await import('@/app/actions/land-listings');

        const r: any = await createLandListingAction({
            ownerId: VICTIM, ownerName: 'V', ownerEmail: 'v@e.com',
            title: 'x', description: 'x',
            location: { state: 's', lga: 'l', address: 'a' },
            size: 1, price: 1,
        } as any);

        expect(r.success).toBe(false);
        expect((global as any).mockFirestoreAdd).not.toHaveBeenCalled();
    });
});

describe('_submitLandInquiryAction — public, but not a notification cannon', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setListing();
        setSession(null); // deliberately: this action stays public
    });

    it('notifies the listing owner, not the id the caller supplied', async () => {
        // THE test. The old code passed data.listingOwnerId straight through,
        // so this call would have notified VICTIM.
        const { submitLandInquiryAction } = await import('@/app/actions/land-listings');

        await submitLandInquiryAction({
            listingId: 'listing-1',
            listingTitle: 'URGENT: verify your account',
            listingOwnerId: VICTIM,
            buyerName: 'Support', buyerEmail: 'b@e.com', buyerPhone: '0800',
            message: 'hello',
        } as any);

        expect(mockNotify).toHaveBeenCalledTimes(1);
        const [args] = (mockNotify as any).mock.calls[0] as [any];
        expect(args.userId).toBe(OWNER);
        expect(args.userId).not.toBe(VICTIM);
    });

    it('uses the listing title, not the caller text', async () => {
        // The message body is rendered to the recipient, so caller-controlled
        // text there is the phishing half of the problem.
        const { submitLandInquiryAction } = await import('@/app/actions/land-listings');

        await submitLandInquiryAction({
            listingId: 'listing-1',
            listingTitle: 'URGENT: verify your account',
            listingOwnerId: VICTIM,
            buyerName: 'Support', buyerEmail: 'b@e.com', buyerPhone: '0800',
            message: 'hello',
        } as any);

        const [args] = (mockNotify as any).mock.calls[0] as [any];
        expect(args.message).toContain('Two hectares near Abeokuta');
        expect(args.message).not.toContain('URGENT');
    });

    it('refuses when the listing does not exist', async () => {
        // Previously an inquiry could be filed against any id at all.
        setListing(false);
        const { submitLandInquiryAction } = await import('@/app/actions/land-listings');

        const r: any = await submitLandInquiryAction({
            listingId: 'nope', listingTitle: 't', listingOwnerId: VICTIM,
            buyerName: 'b', buyerEmail: 'b@e.com', buyerPhone: '0800', message: 'm',
        } as any);

        expect(r.success).toBe(false);
        expect(mockNotify).not.toHaveBeenCalled();
    });

    it('still accepts a genuine inquiry from a signed-out visitor', async () => {
        // Vacuity guard, and the product requirement: enquiring must not need an
        // account.
        const { submitLandInquiryAction } = await import('@/app/actions/land-listings');

        const r: any = await submitLandInquiryAction({
            listingId: 'listing-1', listingTitle: 'whatever', listingOwnerId: 'whoever',
            buyerName: 'Real Buyer', buyerEmail: 'r@e.com', buyerPhone: '0800',
            message: 'Is this still available?',
        } as any);

        expect(r.success).toBe(true);
        expect(mockNotify).toHaveBeenCalledTimes(1);
    });
});
