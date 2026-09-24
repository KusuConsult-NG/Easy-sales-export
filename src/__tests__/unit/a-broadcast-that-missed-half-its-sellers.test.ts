/**
 * @jest-environment node
 */

/**
 *   THE DEFECT: an admin broadcasting to "sellers" reached the ones holding the
 *   old spelling of the role and nobody else.
 *
 *   services/communications.service.ts resolves who an email goes to. The
 *   sellers branch was
 *
 *       query.where("roles", "array-contains", "seller")
 *
 *   and the role vocabulary carries TWO names for the same thing:
 *   lib/seller-approval declares SELLER_ROLES = ["seller",
 *   "marketplace_seller"], and lib/types/roles.ts annotates the second as "the
 *   new standardized role". The marketplace branch had it twice over, asking
 *   in memory for `roles.includes("buyer") || roles.includes("seller")` while
 *   MARKETPLACE_BUYER_ROLES is ["buyer", "marketplace_buyer"].
 *
 *   So every member registered under the newer spelling was silently omitted
 *   from both audiences. A reader narrower than its writers — this codebase's
 *   most repeated defect — on an ADMIN BROADCAST, where the only symptom is
 *   that some people were never told, and the log reports a plausible count.
 *
 *   Found because no test named this file. The service had 0% of its targeting
 *   exercised while deciding who hears from the platform.
 *
 *   NOT FIXED HERE, and recorded rather than smuggled: the cooperative, wave
 *   and academy branches do not exclude SUSPENDED accounts, because suspension
 *   lives on the USERS row and those branches query module collections. The
 *   users branch does exclude them. Closing that needs a join per audience and
 *   is a behaviour change to who receives mail, which belongs in its own
 *   change.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';
import { SELLER_ROLES } from '@/lib/seller-approval';
import { MARKETPLACE_BUYER_ROLES } from '@/lib/role-app-mapping';

let store: FakeDbHandle;

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
});

const targeted = async (audience: string, status?: string) => {
    const { CommunicationsService } = await import('@/services/communications.service');
    return CommunicationsService.getTargetedUsers(audience, status);
};

const user = (id: string, data: Record<string, unknown>) =>
    store.seed(COLLECTIONS.USERS, id, data);

// ─────────────────────────────────────────────────────────────────────────────
describe('who a broadcast to sellers reaches', () => {
    it('BOTH SPELLINGS OF THE SELLER ROLE', async () => {
        //   THE test. `marketplace_seller` is the newer name and was missed.
        user('old', { email: 'old@example.test', roles: ['seller'] });
        user('new', { email: 'new@example.test', roles: ['marketplace_seller'] });

        expect((await targeted('sellers')).sort())
            .toEqual(['new@example.test', 'old@example.test']);
    });

    it('AND NOBODY WHO IS NOT A SELLER (control)', async () => {
        //   The vacuity guard: a query that matched everybody would satisfy the
        //   assertion above and send the platform's mail to the whole database.
        user('seller', { email: 'seller@example.test', roles: ['marketplace_seller'] });
        user('buyer', { email: 'buyer@example.test', roles: ['marketplace_buyer'] });
        user('plain', { email: 'plain@example.test', roles: ['general_user'] });

        expect(await targeted('sellers')).toEqual(['seller@example.test']);
    });

    it('AND THE LIST IT ASKS FOR IS THE SHARED ONE', () => {
        //   So a third spelling added to SELLER_ROLES reaches this audience
        //   without anybody remembering to come here.
        expect([...SELLER_ROLES].sort()).toEqual(['marketplace_seller', 'seller']);
    });
});

describe('who a broadcast to the marketplace reaches', () => {
    it('BUYERS AND SELLERS, in both spellings', async () => {
        user('b1', { email: 'b1@example.test', roles: ['buyer'] });
        user('b2', { email: 'b2@example.test', roles: ['marketplace_buyer'] });
        user('s1', { email: 's1@example.test', roles: ['seller'] });
        user('s2', { email: 's2@example.test', roles: ['marketplace_seller'] });

        expect((await targeted('marketplace')).sort())
            .toEqual(['b1@example.test', 'b2@example.test', 's1@example.test', 's2@example.test']);
    });

    it('AND NOT SOMEBODY WITH NEITHER ROLE', async () => {
        user('plain', { email: 'plain@example.test', roles: ['general_user'] });
        user('farmer', { email: 'farmer@example.test', roles: ['farmer'] });

        expect(await targeted('marketplace')).toEqual([]);
    });

    it('AND A ROW WHOSE ROLES ARE NOT AN ARRAY DOES NOT THROW', async () => {
        //   `data.roles?.includes(...)` would have thrown on a string, inside
        //   the try — so the catch would have returned [] and the broadcast
        //   would have gone to nobody, for one malformed row.
        user('odd', { email: 'odd@example.test', roles: 'seller' });
        user('good', { email: 'good@example.test', roles: ['seller'] });

        expect(await targeted('marketplace')).toEqual(['good@example.test']);
    });

    it('AND THE BUYER LIST IS ALSO THE SHARED ONE', () => {
        expect([...MARKETPLACE_BUYER_ROLES].sort()).toEqual(['buyer', 'marketplace_buyer']);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('and the rest of the targeting', () => {
    it('A SUSPENDED ACCOUNT IS NEVER MAILED from the users collection', async () => {
        user('ok', { email: 'ok@example.test', status: 'active' });
        user('gone', { email: 'gone@example.test', status: 'suspended' });

        expect(await targeted('all')).toEqual(['ok@example.test']);
    });

    it('AND THE SAME ADDRESS TWICE IS ONE RECIPIENT', async () => {
        //   Two rows for one person — which this platform has, and has a
        //   forensics screen about — must not mean two emails.
        user('a', { email: 'same@example.test' });
        user('b', { email: 'same@example.test' });

        expect(await targeted('all')).toEqual(['same@example.test']);
    });

    it('AND A ROW WITH NO ADDRESS IS SKIPPED rather than pushing undefined', async () => {
        user('noemail', { status: 'active' });
        user('withemail', { email: 'has@example.test', status: 'active' });

        expect(await targeted('all')).toEqual(['has@example.test']);
    });

    it('THE COOPERATIVE AUDIENCE DEFAULTS TO MEMBERS WHO PAID', async () => {
        //   With no status given: a broadcast to "cooperative" is to the
        //   membership, and somebody mid-registration has not joined yet.
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, 'paid', {
            email: 'paid@example.test', paymentStatus: 'completed',
        });
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, 'unpaid', {
            email: 'unpaid@example.test', paymentStatus: 'pending',
        });

        expect(await targeted('cooperative')).toEqual(['paid@example.test']);
    });

    it('AND A NAMED STATUS TAKES BOTH SPELLINGS OF APPROVED', async () => {
        //   `approved` and `active` are the same state under two names on this
        //   collection, and asking for one would miss half the membership.
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, 'm1', {
            email: 'm1@example.test', membershipStatus: 'approved',
        });
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, 'm2', {
            email: 'm2@example.test', membershipStatus: 'active',
        });

        expect((await targeted('cooperative', 'approved')).sort())
            .toEqual(['m1@example.test', 'm2@example.test']);
    });

    it('AND A FAILED READ SENDS TO NOBODY rather than to everybody', async () => {
        /*
         *   The catch returns []. For a broadcast that is the safe direction —
         *   the alternative to "no recipients" is "every address we could
         *   scrape" — but it is worth pinning, because the caller cannot tell a
         *   quiet audience from a broken read.
         */
        (globalThis as any).mockFirestoreGet.mockImplementation(() => {
            throw new Error('database unreachable');
        });

        expect(await targeted('all')).toEqual([]);
    });
});
