/**
 * @jest-environment node
 */

/**
 * The marketplace buyers screen read the whole users table and showed the first
 * five thousand as though they were all of them.
 *
 *     const snapshot = await db.collection(COLLECTIONS.USERS).get();
 *     const users = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
 *
 *     const marketplaceUsers = users.filter((u: any) => {
 *         const hasSellerRole = (u.roles || []).includes("seller");
 *         const hasBuyerRole = (u.roles || []).includes("buyer");
 *         const isRegisteredInMarketplace = u.serviceRegistrations?.marketplace === true;
 *         return hasSellerRole || hasBuyerRole || isRegisteredInMarketplace;
 *     })
 *
 * supabase-db caps an unbounded query at SUPABASE_DEFAULT_QUERY_LIMIT — 5,000 —
 * and sets `snapshot.truncated` precisely so a partial answer is not silent. Its
 * own comment says "Reaching it is reported, never silent". This route never
 * looked.
 *
 * The users table holds tens of thousands of rows. So an admin saw the
 * marketplace users found among the first five thousand USERS, presented as the
 * complete list — and a buyer who registered later was absent with nothing to
 * say so. An admin searching for a member and not finding them concludes they
 * are not there.
 *
 * Asked of the database now: array-contains-any on roles, which the adapter
 * supports. The limit applies to marketplace users rather than to users in
 * general, and the flag is reported either way.
 *
 * THE THIRD CONDITION NEVER FIRED
 * -------------------------------
 * serviceRegistrations.marketplace is always an OBJECT —
 * { status, accountType, paymentStatus, onboardingCompleted, approvedAt } —
 * written by approve-seller and by admin.ts. An object is never `=== true`, so
 * that clause was dead. Dropped rather than repaired: a marketplace
 * registration with no seller or buyer role is not something the approval path
 * produces, and writing a query for a case that has never existed would be
 * guessing at intent.
 *
 * THREE QUEUES HAD THE SAME BLIND SPOT
 * ------------------------------------
 * seller-verifications, land-verifications and cooperative loan-applications
 * all read a filtered collection unbounded and ignored `truncated` too. Their
 * collections are smaller, so this is a latent version of the same thing — an
 * admin queue that shows the first N as though they were all of them is how a
 * pending item is never actioned. They report it now.
 *
 * The flag was already consumed where it mattered: analytics.service.ts sets
 * revenueIsPartial from it and cron/reconcile-fulfilment returns it. These
 * screens were the gap.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';

function source(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8');
}

function codeOnly(src: string): string {
    return src
        .split('\n')
        .filter((l) => {
            const t = l.trim();
            return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
        })
        .join('\n');
}

const buyers = source('src/app/api/admin/marketplace/buyers/route.ts');

const QUEUES = {
    'seller-verifications': 'src/app/api/admin/marketplace/seller-verifications/route.ts',
    'land-verifications': 'src/app/api/admin/farm-nation/land-verifications/route.ts',
    'loan-applications': 'src/app/api/admin/cooperative/loan-applications/route.ts',
};

describe('the buyers list is a query, not a table scan', () => {
    it('asks the database for the rows it wants', () => {
        // THE test.
        expect(buyers).toContain('.where("roles", "array-contains-any", ["seller", "buyer"])');
    });

    it('no longer reads the whole users table', () => {
        expect(codeOnly(buyers)).not.toContain('db.collection(COLLECTIONS.USERS).get()');
    });

    it('the operator is one the adapter implements', () => {
        // A filter the adapter does not support would be silently wrong rather
        // than an error, which is worse than the scan it replaces.
        const adapter = source('src/lib/supabase-db.ts');

        expect(adapter).toContain("op === 'array-contains-any'");
    });

    it('the dead clause is gone', () => {
        expect(codeOnly(buyers)).not.toContain('serviceRegistrations?.marketplace === true');
    });

    it('and it really was dead', () => {
        // serviceRegistrations.marketplace is written as an object in both
        // places that write it. An object is never === true.
        expect(source('src/app/api/admin/marketplace/approve-seller/route.ts'))
            .toContain('"marketplace": {');
        expect(source('src/app/actions/admin.ts'))
            .toContain('serviceRegistrations.marketplace = {');
    });

    it('still classifies buyer, seller and both', () => {
        // Vacuity guard: the role query must not have removed the distinction
        // the screen exists to show.
        for (const value of ['buyerRole', 'both', 'seller_only', 'buyer_only']) {
            expect(buyers).toContain(value);
        }
    });

    it('still returns the fields the screen renders', () => {
        for (const field of ['name:', 'email:', 'phone:', 'roles:', 'status:', 'createdAt:']) {
            expect(buyers).toContain(field);
        }
    });
});

describe('a partial list says so', () => {
    it('the buyers route reports truncation', () => {
        expect(buyers).toContain('const truncated = Boolean((snapshot as any).truncated)');
        expect(buyers).toContain('users: validUsers, truncated');
    });

    it('and logs it', () => {
        expect(buyers).toContain("result truncated by the adapter's query limit");
    });

    it('so do the three admin queues', () => {
        for (const [name, file] of Object.entries(QUEUES)) {
            const src = source(file);

            expect(`${name} reads flag: ${src.includes('const truncated = Boolean((snapshot as any).truncated)')}`)
                .toBe(`${name} reads flag: true`);
            expect(`${name} returns flag: ${src.includes('truncated,')}`)
                .toBe(`${name} returns flag: true`);
        }
    });

    it('the flag it reads is the one the adapter sets', () => {
        const adapter = source('src/lib/supabase-db.ts');

        expect(adapter).toContain('public readonly truncated: boolean');
        expect(adapter).toContain('reported, never silent');
    });

    it('the adapter cap is what makes this reachable', () => {
        const adapter = source('src/lib/supabase-db.ts');

        expect(adapter).toContain('Number(process.env.SUPABASE_DEFAULT_QUERY_LIMIT) || 5000');
    });

    it('the flag was already consumed elsewhere', () => {
        // Recorded because it establishes the convention these screens were
        // outside of, rather than a new idea.
        expect(source('src/services/analytics.service.ts')).toContain('sweep.truncated');
        expect(source('src/app/api/cron/reconcile-fulfilment/route.ts')).toContain('truncated: snap.truncated');
    });
});
