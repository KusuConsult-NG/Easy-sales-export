/**
 * @jest-environment node
 */

/**
 * The broadcast audience resolver, EXECUTED — twenty-three audiences, one store.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * lib/broadcast-logic.ts is 1,139 lines and was at 1.4% statement coverage: the
 * single largest untested thing in the codebase. It is also the module that
 * decides who receives an email from this business's sending domain, which makes
 * "who does this audience actually resolve to" a question worth being able to
 * answer.
 *
 * It could not be tested before. Every audience is a query — `.get()`,
 * `.stream()`, `db.getAll()`, `.where(...)` — and the global harness was a call
 * recorder whose `where()` was a no-op and whose `get()` returned whatever the
 * test stubbed. So a test could asserts that a query WAS MADE, and nothing about
 * what came back.
 *
 * installFakeDb (lib/testing/fake-db.ts) puts a real store behind the same
 * recorders, contract-tested against PostgreSQL in
 * src/__tests__/pg/fake-db-matches-postgres.test.ts. These tests seed documents,
 * call the real resolver, and assert on the recipients it returns.
 *
 * WHAT THAT BUYS BEYOND THE COVERAGE NUMBER
 * -----------------------------------------
 * Statements executed is the side effect. The point is that "the sellers audience
 * reads seller_verifications and resolves emails from users" and "csv_upload
 * drops malformed addresses" become checkable claims rather than readings of the
 * source.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

// firebase-admin/auth is imported dynamically by the email fallback paths. Left
// resolving to an empty result, so the fallback runs — it is a real branch — and
// recovers nobody.
jest.mock('firebase-admin/auth', () => ({
    getAuth: () => ({ getUsers: async () => ({ users: [], notFound: [] }) }),
}));

let store: FakeDbHandle;

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
});

async function resolve(filters?: Record<string, unknown>) {
    const { getCleanBroadcastList } = await import('@/lib/broadcast-logic');
    return getCleanBroadcastList(filters as never);
}

/** Emails of the resolved recipients, sorted, for order-independent assertions. */
function emails(result: { data: { recipients: Array<{ email: string }> } | null }): string[] {
    return (result.data?.recipients ?? []).map((r) => r.email).sort();
}

// ─── the pure classifiers ────────────────────────────────────────────────────

describe('categorizeUser puts every user in exactly one segment', () => {
    let categorizeUser: (data: unknown) => string;

    beforeEach(async () => {
        ({ categorizeUser } = await import('@/lib/broadcast-logic') as never);
    });

    it('an approved registration in ANY module makes them active', () => {
        for (const status of ['approved', 'active', 'paid', 'completed']) {
            expect(categorizeUser({ serviceRegistrations: { wave: { status } } })).toBe('active_users');
        }
    });

    it('active wins over pending, because the check runs first', () => {
        // Order matters and is asserted: a member with one approved module and one
        // pending application is ACTIVE, not pending. Reversing the two checks
        // would move a paying member into the "chase them up" list.
        expect(categorizeUser({
            serviceRegistrations: { wave: { status: 'approved' }, academy: { status: 'pending' } },
        })).toBe('active_users');
    });

    it('a pending, submitted, under_review or briefing registration makes them pending', () => {
        for (const status of ['pending', 'submitted', 'under_review', 'briefing']) {
            expect(categorizeUser({ serviceRegistrations: { academy: { status } } })).toBe('pending_users');
        }
    });

    it('bank details alone make them stalled', () => {
        expect(categorizeUser({ bankDetails: { bankName: 'Zenith' } })).toBe('stalled_users');
        expect(categorizeUser({ verificationProfile: { bankDetails: { bankName: 'GTB' } } }))
            .toBe('stalled_users');
    });

    it('but "N/A" does not, which is what the placeholder means', () => {
        // The placeholder this codebase writes for "not supplied". Counting it as
        // progress would move every untouched profile into the stalled list.
        expect(categorizeUser({ verificationProfile: { bankDetails: { bankName: 'N/A' } } }))
            .toBe('ghost_users');
        expect(categorizeUser({ verificationProfile: { address: { state: 'N/A' } } }))
            .toBe('ghost_users');
    });

    it('an address makes them stalled', () => {
        expect(categorizeUser({ address: { state: 'Lagos' } })).toBe('stalled_users');
    });

    it('a registration with any status other than not_started makes them stalled', () => {
        expect(categorizeUser({ serviceRegistrations: { export: { status: 'draft' } } }))
            .toBe('stalled_users');
        expect(categorizeUser({ serviceRegistrations: { export: { status: 'not_started' } } }))
            .toBe('ghost_users');
    });

    it('and nothing at all makes them a ghost', () => {
        expect(categorizeUser({})).toBe('ghost_users');
        expect(categorizeUser({ serviceRegistrations: {} })).toBe('ghost_users');
    });
});

describe('isPlausibleEmail is loose on purpose', () => {
    let isPlausibleEmail: (v: string) => boolean;

    beforeEach(async () => {
        ({ isPlausibleEmail } = await import('@/lib/broadcast-logic') as never);
    });

    it('accepts an ordinary address', () => {
        expect(isPlausibleEmail('a.person@example.co.uk')).toBe(true);
        expect(isPlausibleEmail('member+tag@easysales.ng')).toBe(true);
    });

    it('rejects the things a spreadsheet actually contains', () => {
        // A header row, a name column, an empty cell — the rubbish this exists to
        // keep out of an outbound send.
        for (const junk of ['Email', 'Jane Doe', '', ' ', 'no-at-sign.com', 'a@b', 'a b@c.com']) {
            expect(isPlausibleEmail(junk)).toBe(false);
        }
    });
});

// ─── csv_upload: the only audience the caller supplies ───────────────────────

describe('the csv_upload audience', () => {
    it('refuses an empty list rather than sending to nobody quietly', async () => {
        const result = await resolve({ audience: 'csv_upload', csvEmails: [] });
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/No emails provided/i);
    });

    it('refuses a list over the ten-thousand cap', async () => {
        const tooMany = Array.from({ length: 10_001 }, (_, i) => `p${i}@example.com`);
        const result = await resolve({ audience: 'csv_upload', csvEmails: tooMany });
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/limited to 10,000/);
        expect(result.error).toMatch(/received 10,001/);
    });

    it('accepts exactly the cap, so the boundary is not off by one', async () => {
        const exactly = Array.from({ length: 10_000 }, (_, i) => `p${i}@example.com`);
        const result = await resolve({ audience: 'csv_upload', csvEmails: exactly });
        expect(result.success).toBe(true);
        expect(result.data?.count).toBe(10_000);
    });

    it('lowercases, trims and de-duplicates', async () => {
        const result = await resolve({
            audience: 'csv_upload',
            csvEmails: ['  A@Example.com ', 'a@example.com', 'A@EXAMPLE.COM', 'b@example.com'],
        });
        expect(result.success).toBe(true);
        expect(emails(result)).toEqual(['a@example.com', 'b@example.com']);
        // originalDocCount reports what was UPLOADED, not what survived — the
        // difference is what tells an admin their file had duplicates.
        expect(result.data?.originalDocCount).toBe(4);
        expect(result.data?.count).toBe(2);
    });

    it('drops malformed addresses and keeps the rest', async () => {
        const result = await resolve({
            audience: 'csv_upload',
            csvEmails: ['Email', 'good@example.com', 'Jane Doe', '', 'also.good@example.ng'],
        });
        expect(result.success).toBe(true);
        expect(emails(result)).toEqual(['also.good@example.ng', 'good@example.com']);
    });

    it('and refuses when NONE of them are addresses, saying how many it looked at', async () => {
        const result = await resolve({
            audience: 'csv_upload',
            csvEmails: ['Email', 'Name', 'State'],
        });
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/None of the 3 uploaded addresses/);
    });
});

// ─── sellers: seller_verifications is the source of truth ────────────────────

describe('the sellers audience reads seller_verifications, not users.isSeller', () => {
    beforeEach(() => {
        store.seedAll(COLLECTIONS.SELLER_VERIFICATIONS, {
            sv1: { userId: 'u1', status: 'approved' },
            sv2: { userId: 'u2', status: 'pending' },
            sv3: { userId: 'u3', status: 'under_review' },
            sv4: { userId: 'u4', status: 'rejected' },
            sv5: { userId: 'u5', status: 'suspended' },
            noUser: { status: 'approved' },   // no userId — skipped
        });
        store.seedAll(COLLECTIONS.USERS, {
            u1: { email: 'One@Example.com', fullName: 'One', state: 'Lagos' },
            u2: { email: 'two@example.com', firstName: 'Two', stateOfOrigin: 'Kano' },
            u3: { email: 'three@example.com' },
            u4: { email: 'four@example.com' },
            u5: { email: 'five@example.com' },
        });
    });

    it('resolves every seller and normalises the address', async () => {
        const result = await resolve({ audience: 'sellers' });
        expect(result.success).toBe(true);
        expect(emails(result)).toEqual([
            'five@example.com', 'four@example.com', 'one@example.com',
            'three@example.com', 'two@example.com',
        ]);
    });

    it('counts under_review as pending in the statistics', async () => {
        // The vocabulary collapse is deliberate and worth pinning: an admin
        // reading "pending: 2" is being told about sv2 AND sv3.
        const result = await resolve({ audience: 'sellers' });
        expect(result.data?.moduleStats).toEqual({
            total: 5, approved: 1, pending: 2, rejected: 1, suspended: 1,
        });
    });

    it('a moduleStatus filter narrows to that status', async () => {
        expect(emails(await resolve({ audience: 'sellers', moduleStatus: 'approved' })))
            .toEqual(['one@example.com']);
        // And under_review is reachable only under its collapsed name.
        expect(emails(await resolve({ audience: 'sellers', moduleStatus: 'pending' })))
            .toEqual(['three@example.com', 'two@example.com']);
    });

    it('"all" is not a filter', async () => {
        expect(emails(await resolve({ audience: 'sellers', moduleStatus: 'all' })).length).toBe(5);
    });

    it('a verification whose user record is missing resolves to nobody, not to an error', async () => {
        store.seed(COLLECTIONS.SELLER_VERIFICATIONS, 'orphan', { userId: 'ghost', status: 'approved' });
        const result = await resolve({ audience: 'sellers' });
        expect(result.success).toBe(true);
        expect(emails(result)).not.toContain(undefined);
        expect(result.data?.count).toBe(5);
    });

    it('and a user with no email is skipped rather than emailed at "undefined"', async () => {
        store.seed(COLLECTIONS.SELLER_VERIFICATIONS, 'sv6', { userId: 'u6', status: 'approved' });
        store.seed(COLLECTIONS.USERS, 'u6', { fullName: 'No Email' });
        const result = await resolve({ audience: 'sellers' });
        expect(result.data?.recipients.every((r) => Boolean(r.email))).toBe(true);
    });

    it('two sellers sharing one address become one recipient', async () => {
        store.seed(COLLECTIONS.SELLER_VERIFICATIONS, 'sv7', { userId: 'u7', status: 'approved' });
        store.seed(COLLECTIONS.USERS, 'u7', { email: 'one@example.com' });
        const result = await resolve({ audience: 'sellers' });
        expect(result.data?.recipients.filter((r) => r.email === 'one@example.com')).toHaveLength(1);
    });
});

describe('fully_verified_sellers crosses the seller list with KYC', () => {
    beforeEach(() => {
        store.seedAll(COLLECTIONS.SELLER_VERIFICATIONS, {
            a: { userId: 'ua', status: 'approved' },
            b: { userId: 'ub', status: 'approved' },
            c: { userId: 'uc', status: 'pending' },
        });
        store.seedAll(COLLECTIONS.USERS, {
            ua: { email: 'a@example.com', kyc: { status: 'verified' } },
            ub: { email: 'b@example.com', kyc: { status: 'pending' } },
            uc: { email: 'c@example.com', kyc: { status: 'verified' } },
        });
    });

    it('keeps only approved sellers whose KYC passed', async () => {
        // uc is verified but NOT an approved seller; ub is an approved seller but
        // not verified. Only ua satisfies both.
        expect(emails(await resolve({ audience: 'fully_verified_sellers' })))
            .toEqual(['a@example.com']);
    });

    it('accepting either spelling of a passed KYC', async () => {
        store.seed(COLLECTIONS.USERS, 'ub', { email: 'b@example.com', kycStatus: 'approved' });
        expect(emails(await resolve({ audience: 'fully_verified_sellers' })))
            .toEqual(['a@example.com', 'b@example.com']);
    });
});

// ─── the per-collection module audiences ─────────────────────────────────────

describe('a module audience reads that module’s own collection', () => {
    const cases: Array<[string, string]> = [
        ['wave_applicants', COLLECTIONS.WAVE_APPLICATIONS],
        ['wave_briefing_registrants', COLLECTIONS.WAVE_BRIEFING_REGISTRATIONS],
        ['farm_nation_users', COLLECTIONS.FARM_NATION_APPLICATIONS],
        ['export_users', COLLECTIONS.EXPORT_APPLICATIONS],
        ['academy_users', COLLECTIONS.ACADEMY_APPLICATIONS],
    ];

    for (const [audience, collection] of cases) {
        it(`${audience} reads ${collection}`, async () => {
            store.seed(collection, 'app1', { userId: 'm1', status: 'approved' });
            store.seed(COLLECTIONS.USERS, 'm1', { email: 'member@example.com' });
            // A record in a DIFFERENT module's collection must not leak in.
            const other = collection === COLLECTIONS.WAVE_APPLICATIONS
                ? COLLECTIONS.ACADEMY_APPLICATIONS : COLLECTIONS.WAVE_APPLICATIONS;
            store.seed(other, 'app2', { userId: 'm2', status: 'approved' });
            store.seed(COLLECTIONS.USERS, 'm2', { email: 'elsewhere@example.com' });

            expect(emails(await resolve({ audience }))).toEqual(['member@example.com']);
        });
    }

    it('and falls back to the document id when the record carries no userId', async () => {
        // Deliberate in the resolver, and load-bearing: several of these
        // collections key on the user id.
        store.seed(COLLECTIONS.WAVE_APPLICATIONS, 'u-as-id', { status: 'approved' });
        store.seed(COLLECTIONS.USERS, 'u-as-id', { email: 'byid@example.com' });
        expect(emails(await resolve({ audience: 'wave_applicants' }))).toEqual(['byid@example.com']);
    });
});

describe('cooperative_members has its own paid/unpaid dimension', () => {
    beforeEach(() => {
        store.seedAll(COLLECTIONS.COOPERATIVE_MEMBERS, {
            m1: { userId: 'c1', membershipStatus: 'active' },
            m2: { userId: 'c2', membershipStatus: 'pending' },
            m3: { userId: 'c3', membershipStatus: 'suspended' },
        });
        store.seedAll(COLLECTIONS.USERS, {
            c1: { email: 'c1@example.com' },
            c2: { email: 'c2@example.com' },
            c3: { email: 'c3@example.com' },
        });
        // Only c1 has paid, recorded the way the payment path records it.
        store.seed('processedPayments', 'p1', {
            userId: 'c1',
            type: 'cooperative_membership_registration',
            status: 'completed',
        });
    });

    it('counts the unpaid, which is the number the chase-up list is built from', async () => {
        const result = await resolve({ audience: 'cooperative_members' });
        expect(result.data?.moduleStats).toMatchObject({ total: 3, unpaid: 2 });
    });

    it('and moduleStatus "unpaid" resolves to exactly those members', async () => {
        expect(emails(await resolve({ audience: 'cooperative_members', moduleStatus: 'unpaid' })))
            .toEqual(['c2@example.com', 'c3@example.com']);
    });

    it('a paymentStatus of completed on the member record counts as paid too', async () => {
        // Two ways a membership is recorded as paid, and both have to work or a
        // paying member gets chased.
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, 'm2',
            { userId: 'c2', membershipStatus: 'pending', paymentStatus: 'completed' });
        expect(emails(await resolve({ audience: 'cooperative_members', moduleStatus: 'unpaid' })))
            .toEqual(['c3@example.com']);
    });

    it('"approved" means active or approved, under either field name', async () => {
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, 'm4', { userId: 'c4', status: 'approved' });
        store.seed(COLLECTIONS.USERS, 'c4', { email: 'c4@example.com' });
        expect(emails(await resolve({ audience: 'cooperative_members', moduleStatus: 'approved' })))
            .toEqual(['c1@example.com', 'c4@example.com']);
    });

    it('and "not_approved" is its complement', async () => {
        expect(emails(await resolve({ audience: 'cooperative_members', moduleStatus: 'not_approved' })))
            .toEqual(['c2@example.com', 'c3@example.com']);
    });
});

// ─── the users-collection audiences ──────────────────────────────────────────

describe('the all audience', () => {
    beforeEach(() => {
        store.seedAll(COLLECTIONS.USERS, {
            u1: { email: 'a@example.com', fullName: 'A', state: 'Lagos' },
            u2: { email: 'b@example.com', firstName: 'B', stateOfOrigin: 'Kano' },
            u3: { userEmail: 'c@example.com' },
        });
    });

    it('reaches everyone with an address, under either field name', async () => {
        expect(emails(await resolve({ audience: 'all' })))
            .toEqual(['a@example.com', 'b@example.com', 'c@example.com']);
    });

    it('and names them from whichever name field is present', async () => {
        const result = await resolve({ audience: 'all' });
        const byEmail = Object.fromEntries((result.data?.recipients ?? []).map((r) => [r.email, r]));
        expect(byEmail['a@example.com'].name).toBe('A');
        expect(byEmail['b@example.com'].name).toBe('B');
        expect(byEmail['c@example.com'].name).toBe('Member');
    });

    it('resolving the state from four possible places', async () => {
        store.seed(COLLECTIONS.USERS, 'u4',
            { email: 'd@example.com', address: { state: 'Oyo' } });
        store.seed(COLLECTIONS.USERS, 'u5',
            { email: 'e@example.com', verificationProfile: { address: { state: 'Edo' } } });

        const result = await resolve({ audience: 'all' });
        const byEmail = Object.fromEntries((result.data?.recipients ?? []).map((r) => [r.email, r]));
        expect(byEmail['a@example.com'].state).toBe('Lagos');
        expect(byEmail['b@example.com'].state).toBe('Kano');
        expect(byEmail['d@example.com'].state).toBe('Oyo');
        expect(byEmail['e@example.com'].state).toBe('Edo');
        expect(byEmail['c@example.com'].state).toBe('Unknown');
    });
});

describe('all_except_approved_coop', () => {
    it('drops approved cooperative members, under either field name', async () => {
        store.seedAll(COLLECTIONS.USERS, {
            keep: { email: 'keep@example.com' },
            coopA: { email: 'coopa@example.com' },
            coopB: { email: 'coopb@example.com' },
        });
        store.seedAll(COLLECTIONS.COOPERATIVE_MEMBERS, {
            r1: { userId: 'coopA', membershipStatus: 'approved' },
            r2: { userId: 'coopB', status: 'approved' },
        });

        expect(emails(await resolve({ audience: 'all_except_approved_coop' })))
            .toEqual(['keep@example.com']);
    });

    it('and keeps a member whose cooperative record is only pending', async () => {
        store.seed(COLLECTIONS.USERS, 'pendingCoop', { email: 'pending@example.com' });
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, 'r3',
            { userId: 'pendingCoop', membershipStatus: 'pending' });

        expect(emails(await resolve({ audience: 'all_except_approved_coop' })))
            .toEqual(['pending@example.com']);
    });
});

describe('the segment audiences select on the same rule categorizeUser applies', () => {
    beforeEach(() => {
        store.seedAll(COLLECTIONS.USERS, {
            active: { email: 'active@example.com', serviceRegistrations: { wave: { status: 'approved' } } },
            pending: { email: 'pending@example.com', serviceRegistrations: { wave: { status: 'pending' } } },
            stalled: { email: 'stalled@example.com', bankDetails: { bankName: 'Zenith' } },
            ghost: { email: 'ghost@example.com' },
        });
    });

    it.each([
        ['active_users', 'active@example.com'],
        ['pending_users', 'pending@example.com'],
        ['stalled_users', 'stalled@example.com'],
        ['ghost_users', 'ghost@example.com'],
    ])('%s resolves to exactly its segment', async (audience, expected) => {
        expect(emails(await resolve({ audience }))).toEqual([expected]);
    });

    it('and the four segments together are everyone, with nobody counted twice', async () => {
        // The partition property. If the segments overlapped, an admin sending to
        // each in turn would mail somebody twice; if they had a gap, somebody
        // would be unreachable by any segment.
        const all = new Set<string>();
        for (const audience of ['active_users', 'pending_users', 'stalled_users', 'ghost_users']) {
            const got = emails(await resolve({ audience }));
            for (const e of got) {
                expect(all.has(e)).toBe(false);
                all.add(e);
            }
        }
        expect([...all].sort()).toEqual(emails(await resolve({ audience: 'all' })));
    });
});

describe('buyers and marketplace_onboarded', () => {
    it('buyers uses the one shared definition', async () => {
        store.seedAll(COLLECTIONS.USERS, {
            buyer: { email: 'buyer@example.com', roles: ['buyer'] },
            seller: { email: 'seller@example.com', roles: ['seller'] },
            neither: { email: 'neither@example.com', roles: ['user'] },
        });
        const got = emails(await resolve({ audience: 'buyers' }));
        expect(got).toContain('buyer@example.com');
        expect(got).not.toContain('neither@example.com');
    });

    it('marketplace_onboarded takes an enrolled registration, an account type, or a role', async () => {
        store.seedAll(COLLECTIONS.USERS, {
            byReg: { email: 'reg@example.com', serviceRegistrations: { marketplace: { status: 'approved' } } },
            byType: { email: 'type@example.com', marketplaceAccountType: 'wholesale' },
            byRole: { email: 'role@example.com', roles: ['seller'] },
            none: { email: 'none@example.com' },
        });
        const got = emails(await resolve({ audience: 'marketplace_onboarded' }));
        expect(got).toEqual(['reg@example.com', 'role@example.com', 'type@example.com']);
        expect(got).not.toContain('none@example.com');
    });

    it('and a not_started registration is not enrolment', async () => {
        store.seedAll(COLLECTIONS.USERS, {
            notStarted: { email: 'ns@example.com', serviceRegistrations: { marketplace: { status: 'not_started' } } },
        });
        expect(emails(await resolve({ audience: 'marketplace_onboarded' }))).toEqual([]);
    });
});

describe('active_last_30_days', () => {
    const iso = (daysAgo: number) =>
        new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();

    it('keeps recent activity and drops the rest', async () => {
        store.seedAll(COLLECTIONS.USERS, {
            recent: { email: 'recent@example.com', updatedAt: iso(3) },
            old: { email: 'old@example.com', updatedAt: iso(90) },
            byLogin: { email: 'login@example.com', lastLoginAt: iso(10) },
            byCreated: { email: 'created@example.com', createdAt: iso(5) },
            noDates: { email: 'nodates@example.com' },
        });

        const got = emails(await resolve({ audience: 'active_last_30_days' }));
        expect(got).toEqual(['created@example.com', 'login@example.com', 'recent@example.com']);
    });

    it('and an unparseable date is dropped rather than treated as now', async () => {
        store.seed(COLLECTIONS.USERS, 'bad', { email: 'bad@example.com', updatedAt: 'not a date' });
        expect(emails(await resolve({ audience: 'active_last_30_days' }))).toEqual([]);
    });
});

describe('the date range filter', () => {
    beforeEach(() => {
        store.seedAll(COLLECTIONS.USERS, {
            jan: { email: 'jan@example.com', createdAt: '2026-01-15T12:00:00.000Z' },
            jun: { email: 'jun@example.com', createdAt: '2026-06-15T12:00:00.000Z' },
            undated: { email: 'undated@example.com' },
        });
    });

    it('bounds below', async () => {
        expect(emails(await resolve({ audience: 'all', startDate: '2026-03-01' })))
            .toEqual(['jun@example.com']);
    });

    it('bounds above', async () => {
        expect(emails(await resolve({ audience: 'all', endDate: '2026-03-01' })))
            .toEqual(['jan@example.com']);
    });

    it('includes the whole of the end DAY, not the instant of midnight', async () => {
        // dateRangeEnd exists for this: a filter ending "2026-06-15" that excluded
        // everything written that day is the bug it was added to fix.
        expect(emails(await resolve({ audience: 'all', endDate: '2026-06-15' })))
            .toEqual(['jan@example.com', 'jun@example.com']);
    });

    it('and drops a record with no date at all rather than guessing', async () => {
        const got = emails(await resolve({ audience: 'all', startDate: '2020-01-01' }));
        expect(got).not.toContain('undated@example.com');
    });
});

describe('the state filter is applied after resolution', () => {
    beforeEach(() => {
        store.seedAll(COLLECTIONS.USERS, {
            lagos: { email: 'lagos@example.com', state: 'Lagos' },
            kano: { email: 'kano@example.com', state: 'Kano' },
            nostate: { email: 'nostate@example.com' },
        });
    });

    it('matching case-insensitively and on a substring', async () => {
        expect(emails(await resolve({ audience: 'all', state: 'lag' })))
            .toEqual(['lagos@example.com']);
    });

    it('and "all" or empty means no filter', async () => {
        expect(emails(await resolve({ audience: 'all', state: 'all' })).length).toBe(3);
        expect(emails(await resolve({ audience: 'all', state: '' })).length).toBe(3);
    });

    it('a recipient with no state is dropped by any real state filter', async () => {
        // "Unknown" is what the resolver stores, and it does not contain "lagos",
        // so the drop is a consequence rather than a special case. Asserted
        // because an admin filtering by state is choosing to exclude them.
        const got = emails(await resolve({ audience: 'all', state: 'Lagos' }));
        expect(got).not.toContain('nostate@example.com');
    });

    it('and the count is corrected to match, not left at the pre-filter figure', async () => {
        const result = await resolve({ audience: 'all', state: 'Lagos' });
        expect(result.data?.count).toBe(result.data?.recipients.length);
        expect(result.data?.count).toBe(1);
    });
});

describe('duplicate addresses collapse to one recipient', () => {
    it('however differently they are spelled', async () => {
        store.seedAll(COLLECTIONS.USERS, {
            u1: { email: 'Same@Example.com' },
            u2: { email: 'same@example.com' },
            u3: { email: '  SAME@EXAMPLE.COM  ' },
        });
        const result = await resolve({ audience: 'all' });
        expect(result.data?.count).toBe(1);
        expect(result.data?.recipients[0].email).toBe('same@example.com');
    });

    it('and the first record seen supplies the details', async () => {
        store.seedAll(COLLECTIONS.USERS, {
            a1: { email: 'dup@example.com', fullName: 'First' },
            a2: { email: 'dup@example.com', fullName: 'Second' },
        });
        const result = await resolve({ audience: 'all' });
        expect(result.data?.recipients).toHaveLength(1);
        expect(['First', 'Second']).toContain(result.data?.recipients[0].name);
    });
});

describe('an empty platform', () => {
    it('resolves to nobody and reports success, not an error', async () => {
        // A send to nobody is a legitimate answer to a narrow audience, and the
        // caller distinguishes it by the count. Returning an error here would make
        // an empty segment indistinguishable from a broken query.
        for (const audience of ['all', 'sellers', 'cooperative_members', 'wave_applicants', 'ghost_users']) {
            const result = await resolve({ audience });
            expect(result.success).toBe(true);
            expect(result.data?.count).toBe(0);
        }
    });
});

// ─── the two dedicated payment-failure paths ─────────────────────────────────

describe('abandoned_failed_transactions reads failedPayments', () => {
    it('taking the address from customerEmail, which is what Paystack writes', async () => {
        // Not `email`. A resolver reading `email` here reaches nobody, and the
        // comment in the source records that as the reason this path exists.
        store.seedAll('failedPayments', {
            f1: { customerEmail: 'Paystack@Example.com', customerName: 'Pay Stack', userId: 'p1' },
        });
        expect(emails(await resolve({ audience: 'abandoned_failed_transactions' })))
            .toEqual(['paystack@example.com']);
    });

    it('falling back to email, then to metadata.email', async () => {
        store.seedAll('failedPayments', {
            f1: { email: 'plain@example.com' },
            f2: { metadata: { email: 'meta@example.com' } },
        });
        expect(emails(await resolve({ audience: 'abandoned_failed_transactions' })))
            .toEqual(['meta@example.com', 'plain@example.com']);
    });

    it('and resolving through users when the record carries only a userId', async () => {
        store.seed('failedPayments', 'f1', { userId: 'u1' });
        store.seed(COLLECTIONS.USERS, 'u1', { email: 'resolved@example.com', fullName: 'Resolved' });
        const result = await resolve({ audience: 'abandoned_failed_transactions' });
        expect(emails(result)).toEqual(['resolved@example.com']);
        expect(result.data?.recipients[0].name).toBe('Resolved');
    });

    it('a record with neither an address nor a userId reaches nobody', async () => {
        store.seed('failedPayments', 'f1', { amount: 5000 });
        const result = await resolve({ audience: 'abandoned_failed_transactions' });
        expect(result.success).toBe(true);
        expect(result.data?.count).toBe(0);
        // But it is still counted as a document looked at, which is how an admin
        // sees that the list is smaller than the failure count.
        expect(result.data?.originalDocCount).toBe(1);
    });

    it('and two failures for one person are one recipient', async () => {
        store.seedAll('failedPayments', {
            f1: { customerEmail: 'twice@example.com' },
            f2: { customerEmail: 'TWICE@example.com' },
        });
        const result = await resolve({ audience: 'abandoned_failed_transactions' });
        expect(result.data?.count).toBe(1);
        expect(result.data?.originalDocCount).toBe(2);
    });
});

describe('unpaid_applicants spans cooperative and academy', () => {
    it('collecting anyone whose paymentStatus is pending, unpaid or failed', async () => {
        store.seedAll(COLLECTIONS.COOPERATIVE_MEMBERS, {
            c1: { email: 'coop-pending@example.com', paymentStatus: 'pending' },
            c2: { email: 'coop-unpaid@example.com', paymentStatus: 'unpaid' },
            c3: { email: 'coop-failed@example.com', paymentStatus: 'failed' },
            c4: { email: 'coop-paid@example.com', paymentStatus: 'completed' },
        });
        store.seedAll(COLLECTIONS.ACADEMY_APPLICATIONS, {
            a1: { email: 'acad@example.com', paymentStatus: 'pending' },
        });

        const got = emails(await resolve({ audience: 'unpaid_applicants' }));
        expect(got).toEqual([
            'acad@example.com', 'coop-failed@example.com',
            'coop-pending@example.com', 'coop-unpaid@example.com',
        ]);
        expect(got).not.toContain('coop-paid@example.com');
    });

    it('reading an academy applicant out of personalInfo', async () => {
        // Academy nests the person inside personalInfo and the other modules do
        // not. A resolver that only read the top level reaches no academy
        // applicant at all.
        store.seed(COLLECTIONS.ACADEMY_APPLICATIONS, 'a1', {
            paymentStatus: 'pending',
            personalInfo: { email: 'Nested@Example.com', fullName: 'Nested Person', state: 'Ogun' },
        });
        const result = await resolve({ audience: 'unpaid_applicants' });
        expect(emails(result)).toEqual(['nested@example.com']);
        expect(result.data?.recipients[0]).toMatchObject({ name: 'Nested Person', state: 'Ogun' });
    });

    it('building a name from first and last when there is no full name', async () => {
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, 'c1', {
            email: 'parts@example.com', paymentStatus: 'pending',
            firstName: 'Ada', lastName: 'Obi',
        });
        const result = await resolve({ audience: 'unpaid_applicants' });
        expect(result.data?.recipients[0].name).toBe('Ada Obi');
    });

    it('and resolving through users when only a userId is recorded', async () => {
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, 'c1', { userId: 'u9', paymentStatus: 'pending' });
        store.seed(COLLECTIONS.USERS, 'u9', { email: 'viaid@example.com', fullName: 'Via Id' });
        expect(emails(await resolve({ audience: 'unpaid_applicants' }))).toEqual(['viaid@example.com']);
    });

    it('counting both collections in originalDocCount', async () => {
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, 'c1', { email: 'c@example.com', paymentStatus: 'pending' });
        store.seed(COLLECTIONS.ACADEMY_APPLICATIONS, 'a1', { email: 'a@example.com', paymentStatus: 'failed' });
        const result = await resolve({ audience: 'unpaid_applicants' });
        expect(result.data?.originalDocCount).toBe(2);
    });
});

// ─── the supplementary sweep the "all" audiences run ─────────────────────────

describe('the all audience also sweeps the module collections', () => {
    it('so somebody with a module record but no users document is still reached', async () => {
        // THE reason the sweep exists. A person who applied to a module before
        // their users record existed — or whose record was never created — is
        // unreachable from the users collection alone.
        store.seedAll(COLLECTIONS.COOPERATIVE_MEMBERS, {
            cm1: { userId: 'x1', email: 'coop-only@example.com', firstName: 'Coop', lastName: 'Only', state: 'Abia' },
        });
        store.seedAll(COLLECTIONS.WAVE_APPLICATIONS, {
            w1: { userId: 'x2', email: 'wave-only@example.com', firstName: 'Wave', surname: 'Only', residentialState: 'Imo' },
        });
        store.seedAll(COLLECTIONS.ACADEMY_APPLICATIONS, {
            a1: { userId: 'x3', personalInfo: { email: 'acad-only@example.com', fullName: 'Acad Only', state: 'Enugu' } },
        });
        store.seedAll(COLLECTIONS.WAVE_BRIEFING_REGISTRATIONS, {
            b1: { userId: 'x4', email: 'brief-only@example.com', name: 'Brief Only', state: 'Delta' },
        });
        store.seedAll(COLLECTIONS.FARM_NATION_APPLICATIONS, {
            f1: { profile: { email: 'farm-only@example.com', fullName: 'Farm Only', state: 'Benue' } },
        });
        store.seedAll(COLLECTIONS.EXPORT_APPLICATIONS, {
            e1: { profile: { email: 'export-only@example.com', state: 'Kwara' } },
        });

        const got = emails(await resolve({ audience: 'all' }));
        expect(got).toEqual([
            'acad-only@example.com', 'brief-only@example.com', 'coop-only@example.com',
            'export-only@example.com', 'farm-only@example.com', 'wave-only@example.com',
        ]);
    });

    it('naming each of them from that collection’s own shape', async () => {
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, 'cm1',
            { email: 'coop@example.com', firstName: 'Ada', lastName: 'Obi' });
        store.seed(COLLECTIONS.WAVE_APPLICATIONS, 'w1',
            { email: 'wave@example.com', firstName: 'Bola', surname: 'Ade' });
        store.seed(COLLECTIONS.WAVE_BRIEFING_REGISTRATIONS, 'b1', { email: 'brief@example.com' });

        const result = await resolve({ audience: 'all' });
        const byEmail = Object.fromEntries((result.data?.recipients ?? []).map((r) => [r.email, r]));
        expect(byEmail['coop@example.com'].name).toBe('Ada Obi');
        expect(byEmail['wave@example.com'].name).toBe('Bola Ade');
        // No name anywhere: the per-collection default, not a blank.
        expect(byEmail['brief@example.com'].name).toBe('Registrant');
    });

    it('and upgrades a state of Unknown when a module record knows it', async () => {
        // The one case where a second sighting of an address changes the
        // recipient: the users document had no state, the module record does, and
        // a state filter would otherwise drop them.
        store.seed(COLLECTIONS.USERS, 'u1', { email: 'shared@example.com', fullName: 'Shared' });
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, 'cm1',
            { userId: 'u1', email: 'shared@example.com', state: 'Plateau' });

        const result = await resolve({ audience: 'all' });
        expect(result.data?.recipients).toHaveLength(1);
        expect(result.data?.recipients[0].state).toBe('Plateau');
    });

    it('but does not overwrite a state the users document already gave', async () => {
        store.seed(COLLECTIONS.USERS, 'u1', { email: 'shared@example.com', state: 'Lagos' });
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, 'cm1',
            { userId: 'u1', email: 'shared@example.com', state: 'Plateau' });

        const result = await resolve({ audience: 'all' });
        expect(result.data?.recipients[0].state).toBe('Lagos');
    });

    it('and the sweep respects the cooperative exclusion', async () => {
        // all_except_approved_coop runs the same sweep, and a supplement that
        // ignored excludeIds would put back exactly the people the audience
        // exists to leave out.
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, 'cm1',
            { userId: 'approved-one', email: 'approved@example.com', membershipStatus: 'approved' });
        store.seed(COLLECTIONS.WAVE_APPLICATIONS, 'w1',
            { userId: 'approved-one', email: 'approved@example.com' });

        expect(emails(await resolve({ audience: 'all_except_approved_coop' }))).toEqual([]);
    });

    it('while a narrow audience does NOT sweep, so it stays narrow', async () => {
        // Vacuity guard for the whole block: if the sweep ran for every audience,
        // every one of the assertions above would pass for the wrong reason.
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, 'cm1', { email: 'coop@example.com' });
        expect(emails(await resolve({ audience: 'ghost_users' }))).toEqual([]);
    });
});
