/**
 * @jest-environment node
 */

/**
 * The in-app broadcast, EXECUTED — the third channel, and the one that WRITES.
 *
 * Email resolves addresses, SMS dials numbers, and this one creates a
 * notification document per recipient. That difference is the reason it deserves
 * its own tests rather than an assumption that it behaves like the other two:
 *
 *   - it resolves to USER IDS, not addresses, so a member with no phone and no
 *     email is reachable here and nowhere else;
 *   - it writes in batches of 500, and a batch that is never committed writes
 *     nothing at all;
 *   - one send produces N documents, so an audience resolved wrongly is not a
 *     message nobody sees — it is N wrong rows in the notifications collection.
 *
 * It was at 3.9%. The three channels share their audience definitions, and this
 * file checks the sharing rather than trusting it: two of the three used to key
 * the `buyers` audience on a field nothing writes, and the not_approved filter
 * had the same overlap in all four of this module's module-audiences as it did in
 * the SMS one.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

const requireAdmin = jest.fn(async () => ({ session: { user: { id: 'admin-7' } } }) as unknown);
jest.mock('@/lib/require-admin', () => ({ requireAdmin: () => requireAdmin() }));

let store: FakeDbHandle;

beforeEach(() => {
    jest.clearAllMocks();
    requireAdmin.mockImplementation(async () => ({ session: { user: { id: 'admin-7' } } }));
    store = installFakeDb();
});

async function preview(filters: Record<string, unknown>) {
    const { previewInAppBroadcastAction } = await import('@/app/actions/in-app-broadcast');
    return previewInAppBroadcastAction(filters as never);
}

async function send(
    filters: Record<string, unknown>,
    title = 'Title',
    message = 'Body',
    type = 'info',
    link?: string,
    linkText?: string,
) {
    const { sendInAppBroadcastAction } = await import('@/app/actions/in-app-broadcast');
    return sendInAppBroadcastAction(filters as never, title, message, type as never, link, linkText);
}

/** The notification documents actually written, by recipient. */
function notifications(): Record<string, unknown>[] {
    return store.all(COLLECTIONS.NOTIFICATIONS).map(([, d]) => d);
}

// ─── resolution ──────────────────────────────────────────────────────────────

describe('recipients are USER IDS, not addresses', () => {
    it('so a member with no email and no phone is still reachable', async () => {
        // The thing this channel can do that the other two cannot. A member whose
        // contact details were never captured is unreachable by email and SMS and
        // perfectly reachable here.
        store.seed(COLLECTIONS.USERS, 'u1', { fullName: 'No Contact Details' });

        const result = await preview({ audience: 'all' });
        expect(result.data?.count).toBe(1);
        expect(result.data?.sample[0].userId).toBe('u1');
    });

    it('and one member reached through several collections is one recipient', async () => {
        store.seed(COLLECTIONS.USERS, 'u1', { fullName: 'Once' });
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, 'm1', { userId: 'u1' });
        store.seed(COLLECTIONS.WAVE_APPLICATIONS, 'w1', { userId: 'u1' });

        expect((await preview({ audience: 'all' })).data?.count).toBe(1);
    });
});

describe('the buyers audience', () => {
    it('reaches a member holding the buyer role', async () => {
        // Same regression as the SMS channel: the old query keyed on
        // marketplaceAccountType, which nothing writes, and reached nobody.
        store.seedAll(COLLECTIONS.USERS, {
            buyer: { roles: ['buyer'], fullName: 'Buyer' },
            plain: { roles: ['user'], fullName: 'Plain' },
        });

        const result = await preview({ audience: 'buyers' });
        expect(result.data?.count).toBe(1);
        expect(result.data?.sample[0].userId).toBe('buyer');
    });

    it('and agrees with the other two channels, which is the point of sharing', async () => {
        const { isMarketplaceBuyer } = await import('@/lib/broadcast-audience');
        expect(isMarketplaceBuyer({ roles: ['buyer'] })).toBe(true);
        expect(isMarketplaceBuyer({ roles: ['user'] })).toBe(false);
    });
});

describe('the module audiences', () => {
    it('wave_applicants resolves from the application’s userId', async () => {
        store.seedAll(COLLECTIONS.WAVE_APPLICATIONS, {
            w1: { userId: 'u1', status: 'approved', firstName: 'A', surname: 'One' },
            w2: { userId: 'u2', status: 'pending' },
            w3: { status: 'approved' },     // no userId: unreachable in this channel
        });

        expect((await preview({ audience: 'wave_applicants' })).data?.count).toBe(2);
    });

    it('and approved / not_approved are exact complements here too', async () => {
        // The same eight-copy divergence the SMS channel had. Four of those copies
        // are in this file, and they are fixed by the same shared set.
        const STATUSES = ['approved', 'active', 'paid', 'completed', 'pending', 'rejected'];
        STATUSES.forEach((status, i) => {
            store.seed(COLLECTIONS.WAVE_APPLICATIONS, `w${i}`, { userId: `u${i}`, status });
        });

        const approved = (await preview({ audience: 'wave_applicants', moduleStatus: 'approved' })).data!.count;
        const notApproved = (await preview({ audience: 'wave_applicants', moduleStatus: 'not_approved' })).data!.count;
        const all = (await preview({ audience: 'wave_applicants' })).data!.count;

        expect(all).toBe(STATUSES.length);
        expect(approved + notApproved).toBe(all);
        expect(approved).toBe(4);
    });

    it('specifically: a "paid" applicant is not in the chase-up list', async () => {
        store.seed(COLLECTIONS.WAVE_APPLICATIONS, 'w1', { userId: 'u1', status: 'paid' });
        expect((await preview({ audience: 'wave_applicants', moduleStatus: 'not_approved' })).data?.count)
            .toBe(0);
    });

    it('export_users and farm_nation_users behave the same way', async () => {
        store.seed(COLLECTIONS.EXPORT_APPLICATIONS, 'e1', { userId: 'u1', status: 'completed' });
        store.seed(COLLECTIONS.FARM_NATION_APPLICATIONS, 'f1', { userId: 'u2', status: 'paid' });

        expect((await preview({ audience: 'export_users', moduleStatus: 'not_approved' })).data?.count).toBe(0);
        expect((await preview({ audience: 'farm_nation_users', moduleStatus: 'approved' })).data?.count).toBe(1);
    });

    it('academy_users resolves from its own collection', async () => {
        store.seed(COLLECTIONS.ACADEMY_APPLICATIONS, 'a1', { userId: 'u1', status: 'approved' });
        expect((await preview({ audience: 'academy_users' })).data?.count).toBe(1);
    });

    it('cooperative_members skips the unpaid', async () => {
        store.seedAll(COLLECTIONS.COOPERATIVE_MEMBERS, {
            approved: { userId: 'u1', membershipStatus: 'approved' },
            paidPending: { userId: 'u2', membershipStatus: 'pending', paymentStatus: 'completed' },
            unpaid: { userId: 'u3', membershipStatus: 'pending' },
        });
        expect((await preview({ audience: 'cooperative_members' })).data?.count).toBe(2);
    });

    it('and each audience reads only its own collection', async () => {
        store.seed(COLLECTIONS.WAVE_APPLICATIONS, 'w1', { userId: 'u1', status: 'approved' });
        store.seed(COLLECTIONS.ACADEMY_APPLICATIONS, 'a1', { userId: 'u2', status: 'approved' });

        const wave = await preview({ audience: 'wave_applicants' });
        expect(wave.data?.sample.map((s) => s.userId)).toEqual(['u1']);
    });
});

describe('the seller audiences', () => {
    beforeEach(() => {
        store.seedAll(COLLECTIONS.SELLER_VERIFICATIONS, {
            s1: { userId: 'u1', status: 'approved', sellerCategory: 'wholesale' },
            s2: { userId: 'u2', status: 'approved', sellerCategory: 'retail' },
            s3: { userId: 'u3', status: 'pending', sellerCategory: 'retail' },
        });
        store.seedAll(COLLECTIONS.USERS, {
            u1: { fullName: 'W' }, u2: { fullName: 'R' }, u3: { fullName: 'P' },
        });
    });

    it('split by category', async () => {
        expect((await preview({ audience: 'wholesale_sellers' })).data?.count).toBe(1);
        expect((await preview({ audience: 'retail_sellers' })).data?.count).toBe(2);
        expect((await preview({ audience: 'sellers' })).data?.count).toBe(3);
    });

    it('and narrowed by sellerStatus', async () => {
        expect((await preview({ audience: 'sellers', sellerStatus: 'pending' })).data?.count).toBe(1);
    });
});

describe('all_except_approved_coop', () => {
    it('drops approved cooperative members', async () => {
        store.seedAll(COLLECTIONS.USERS, { keep: {}, coop: {} });
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, 'm1',
            { userId: 'coop', membershipStatus: 'approved' });

        const result = await preview({ audience: 'all_except_approved_coop' });
        expect(result.data?.count).toBe(1);
        expect(result.data?.sample[0].userId).toBe('keep');
    });
});

describe('unpaid_applicants and abandoned_failed_transactions', () => {
    it('unpaid spans cooperative and academy', async () => {
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, 'c1', { userId: 'u1', paymentStatus: 'pending' });
        store.seed(COLLECTIONS.ACADEMY_APPLICATIONS, 'a1', { userId: 'u2', paymentStatus: 'failed' });
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, 'c2', { userId: 'u3', paymentStatus: 'completed' });

        expect((await preview({ audience: 'unpaid_applicants' })).data?.count).toBe(2);
    });

    it('abandoned reads the failed payments', async () => {
        store.seed('failedPayments', 'f1', { userId: 'u1', customerName: 'Abandoned' });
        store.seed('failedPayments', 'f2', { amount: 100 });   // no userId — unreachable here

        const result = await preview({ audience: 'abandoned_failed_transactions' });
        expect(result.data?.count).toBe(1);
        expect(result.data?.sample[0].userId).toBe('u1');
    });
});

// ─── the send, which is the part that writes ─────────────────────────────────

describe('sending writes one notification per recipient', () => {
    beforeEach(() => {
        store.seedAll(COLLECTIONS.USERS, { u1: { fullName: 'One' }, u2: { fullName: 'Two' } });
    });

    it('carrying the title, message, type and link', async () => {
        const result = await send(
            { audience: 'all' }, 'Maintenance', 'We are down at 6pm', 'warning',
            '/status', 'See status');

        expect(result.success).toBe(true);
        expect(result.data?.delivered).toBe(2);

        const docs = notifications();
        expect(docs).toHaveLength(2);
        expect(docs[0]).toMatchObject({
            title: 'Maintenance',
            message: 'We are down at 6pm',
            type: 'warning',
            link: '/status',
            linkText: 'See status',
            read: false,
        });
        expect(new Set(docs.map((d) => d.userId))).toEqual(new Set(['u1', 'u2']));
    });

    it('with an absent link written as null rather than left undefined', async () => {
        // undefined is not a JSON value. A key that vanishes reads as "never set"
        // to every consumer, and the notification renderer branches on it.
        await send({ audience: 'all' }, 'T', 'M');
        const [doc] = notifications();
        expect(doc.link).toBeNull();
        expect(doc.linkText).toBeNull();
    });

    it('stamping a broadcastId so an admin send is distinguishable afterwards', async () => {
        await send({ audience: 'all' }, 'T', 'M');
        for (const doc of notifications()) {
            expect(String(doc.broadcastId)).toMatch(/^BROADCAST-\d+$/);
        }
    });

    it('every recipient getting their own document, none shared', async () => {
        await send({ audience: 'all' }, 'T', 'M');
        const userIds = notifications().map((d) => d.userId);
        expect(new Set(userIds).size).toBe(userIds.length);
    });

    it('and refusing when nothing matched rather than reporting a delivery of zero', async () => {
        store.clear();
        const result = await send({ audience: 'all' }, 'T', 'M');
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/No recipients/i);
        expect(store.size(COLLECTIONS.NOTIFICATIONS)).toBe(0);
    });

    it('recording the send in its own log', async () => {
        await send({ audience: 'all' }, 'Logged', 'Body');
        const logs = store.all('inapp_broadcast_logs');
        expect(logs).toHaveLength(1);
        expect(logs[0][1]).toMatchObject({ title: 'Logged' });
    });
});

describe('the batching', () => {
    it('writes every recipient across more than one batch of 500', async () => {
        // The batch boundary. Firestore caps a batch at 500 writes, so 501
        // recipients need two commits — and a loop that committed only the first
        // would deliver 500 of them and report 501.
        for (let i = 0; i < 501; i++) store.seed(COLLECTIONS.USERS, `u${i}`, {});

        const result = await send({ audience: 'all' }, 'T', 'M');

        expect(result.data?.delivered).toBe(501);
        expect(store.size(COLLECTIONS.NOTIFICATIONS)).toBe(501);
    });

    it('and the delivered count equals the documents actually written', async () => {
        // THE property, stated on its own. `delivered` is incremented per chunk
        // rather than per successful write, so it is a claim about the store that
        // has to be checked against the store.
        for (let i = 0; i < 25; i++) store.seed(COLLECTIONS.USERS, `u${i}`, {});
        const result = await send({ audience: 'all' }, 'T', 'M');
        expect(result.data?.delivered).toBe(store.size(COLLECTIONS.NOTIFICATIONS));
    });
});

describe('both actions refuse a non-admin', () => {
    beforeEach(() => {
        store.seed(COLLECTIONS.USERS, 'u1', {});
        requireAdmin.mockImplementation(async () => ({ error: 'Unauthorized' }));
    });

    it('preview resolves nobody', async () => {
        const result = await preview({ audience: 'all' });
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/admin/i);
    });

    it('and send writes nothing', async () => {
        const result = await send({ audience: 'all' }, 'T', 'M');
        expect(result.success).toBe(false);
        expect(store.size(COLLECTIONS.NOTIFICATIONS)).toBe(0);
        expect(store.size('inapp_broadcast_logs')).toBe(0);
    });

    it('while an admin CAN, so the refusals are not vacuous', async () => {
        requireAdmin.mockImplementation(async () => ({ session: { user: { id: 'admin-7' } } }));
        expect((await send({ audience: 'all' }, 'T', 'M')).success).toBe(true);
        expect(store.size(COLLECTIONS.NOTIFICATIONS)).toBe(1);
    });
});

describe('the preview sample', () => {
    it('is capped at three and writes nothing', async () => {
        for (let i = 0; i < 10; i++) store.seed(COLLECTIONS.USERS, `u${i}`, {});
        const result = await preview({ audience: 'all' });
        expect(result.data?.count).toBe(10);
        expect(result.data?.sample).toHaveLength(3);
        expect(store.size(COLLECTIONS.NOTIFICATIONS)).toBe(0);
    });
});
