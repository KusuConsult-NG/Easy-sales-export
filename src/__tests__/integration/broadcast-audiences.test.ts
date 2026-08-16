/**
 * @jest-environment node
 */

/**
 * The broadcast audiences that threw TypeError, driven through the real
 * resolver against a real database.
 *
 * WHY THIS EXISTS SEPARATELY FROM THE ADAPTER TEST
 * ------------------------------------------------
 * __tests__/db-integration/stream-and-collection-group.test.ts proves
 * SupabaseQuery.stream() works. That is not the same claim as "an admin can
 * send a broadcast to marketplace-onboarded users again" — the resolver could
 * still be wrong about who belongs in the audience, and the adapter test would
 * not notice.
 *
 * This calls collectRecipientUserIds() itself, the function the admin
 * broadcast UI calls, for each audience that went through the missing
 * .stream() method:
 *
 *   marketplace_onboarded   in-app-broadcast.ts:238
 *
 * Before the fix every one of these threw
 * "TypeError: query.stream is not a function" — the admin saw a failed
 * broadcast with no useful message, and nobody received anything.
 *
 * THE ASSERTIONS ARE ABOUT MEMBERSHIP, NOT ABOUT NOT THROWING.
 * A test that only asserted "did not throw" would pass against a resolver that
 * returned an empty list, which is indistinguishable to the admin from the
 * crash it replaced: nobody gets the message either way. So each case seeds a
 * user who MUST be included and a user who MUST NOT be, and checks both.
 */

import { getAdminDb } from '@/lib/firebase-admin';
import { COLLECTIONS } from '@/lib/types/firestore';
import { collectRecipientUserIds } from '@/app/actions/in-app-broadcast';

// collectRecipientUserIds calls requireAdmin() first. The audience resolution
// is what is under test, not the authorization check — which has its own
// coverage — so the session is stubbed to an admin.
jest.mock('@/lib/require-admin', () => ({
    requireAdmin: jest.fn(async () => ({
        session: { user: { id: 'jest-broadcast-admin', roles: ['admin'], email: 'admin@jest.local' } },
    })),
}));

declare const maybeDescribe: jest.Describe;

const ONBOARDED_ID = 'jest-bc-onboarded';
const ROLE_ONLY_ID = 'jest-bc-roleonly';
const OUTSIDER_ID = 'jest-bc-outsider';

maybeDescribe('broadcast audiences that used to throw on .stream()', () => {
    const db = getAdminDb();

    beforeAll(async () => {
        // In the marketplace audience because serviceRegistrations says so.
        await db.collection(COLLECTIONS.USERS).doc(ONBOARDED_ID).set({
            id: ONBOARDED_ID,
            email: 'onboarded@jest.local',
            fullName: 'Onboarded Marketplace User',
            roles: ['user'],
            serviceRegistrations: { marketplace: { status: 'approved' } },
        });

        // In it by role alone — a second, independent route into the audience.
        await db.collection(COLLECTIONS.USERS).doc(ROLE_ONLY_ID).set({
            id: ROLE_ONLY_ID,
            email: 'roleonly@jest.local',
            fullName: 'Seller By Role',
            roles: ['user', 'seller'],
        });

        // Must NOT be in it. Without this the test would pass against a
        // resolver that returned every user in the table.
        await db.collection(COLLECTIONS.USERS).doc(OUTSIDER_ID).set({
            id: OUTSIDER_ID,
            email: 'outsider@jest.local',
            fullName: 'Unrelated User',
            roles: ['user'],
        });
    }, 30000);

    afterAll(async () => {
        for (const id of [ONBOARDED_ID, ROLE_ONLY_ID, OUTSIDER_ID]) {
            try { await db.collection(COLLECTIONS.USERS).doc(id).delete(); } catch { /* already gone */ }
        }
    });

    it('resolves the marketplace_onboarded audience instead of throwing', async () => {
        const recipients = await collectRecipientUserIds({ audience: 'marketplace_onboarded' } as any);
        const ids = recipients.map(r => r.userId);

        // Included by serviceRegistrations, and included by role — both branches
        // of the membership rule the resolver applies.
        expect(ids).toContain(ONBOARDED_ID);
        expect(ids).toContain(ROLE_ONLY_ID);

        // Excluded. This is the assertion that makes the two above mean
        // something.
        expect(ids).not.toContain(OUTSIDER_ID);
    }, 60000);

    it('carries a display name for each recipient', async () => {
        // The resolver returns { userId, name }, and the admin preview screen
        // shows the name. Streaming with .select() omits fields, so a mistake in
        // the projected field list shows up here as "User" for everyone rather
        // than as a failure anywhere else.
        const recipients = await collectRecipientUserIds({ audience: 'marketplace_onboarded' } as any);
        const onboarded = recipients.find(r => r.userId === ONBOARDED_ID);

        expect(onboarded?.name).toBe('Onboarded Marketplace User');
    }, 60000);
});
