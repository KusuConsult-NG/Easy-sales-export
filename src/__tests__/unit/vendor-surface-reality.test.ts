/**
 * @jest-environment node
 */

/**
 * The vendor dashboard's Today, This Week and This Month were always zero —
 * and half the module reads collections nothing writes.
 *
 * THE DATE COMPARISON
 * -------------------
 * _getVendorSalesStatsAction serializes its orders first — serializeDocs turns
 * a Timestamp into an ISO STRING — and then compared that string to a Date:
 *
 *     if (createdAt >= startOfToday)
 *
 * JavaScript resolves a string/Date comparison by stringifying the Date through
 * toString(), so it became a lexicographic comparison against
 * "Tue Aug 18 2026 00:00:00 GMT+0000...". "2" sorts before "T", so it was false
 * for every order on every day — not merely wrong at the boundary. A vendor
 * with sales an hour ago saw Today ₦0, This Week ₦0, This Month ₦0, while All
 * Time was right because it sums unconditionally.
 *
 * The sibling one function away, _getVendorRevenueTrendsAction, reads
 * doc.data() and coerces properly — the file already held the right answer.
 *
 * WHAT THIS MODULE ACTUALLY IS
 * ----------------------------
 * `/vendor` is a legacy parallel of the marketplace seller flow. roles.ts says
 * so outright: LEGACY_ROLE_MAP maps the `vendor` role to `seller`. Nothing in
 * the application links to /vendor — the only references are two entries in
 * route-manifest.ts — and there is no layout under src/app/vendor, so the only
 * gate is middleware's "are you logged in".
 *
 * More consequentially, its collections were never wired up:
 *
 *   vendor_products   read in four places, WRITTEN NOWHERE. The catalogue is
 *                     permanently empty, and /vendor/products/new — the "Add
 *                     Product" link — is one of the dead routes in the
 *                     dead-internal-links baseline.
 *   vendor_profiles   read and updated in five places, CREATED NOWHERE. Every
 *                     settings saver goes through versionedUpdate, which throws
 *                     "Document does not exist" on a missing record — so the
 *                     vendor settings page cannot save anything, for anyone,
 *                     ever.
 *   vendor_orders     defined in COLLECTIONS and referenced nowhere at all.
 *   vendor_reviews    the same.
 *
 * The order-side reads DO work: they were repointed at marketplace_orders by
 * sellerId/sellerIds in an earlier pass, which is why the sales figures are
 * worth fixing at all.
 *
 * This suite pins that reality. Building a product creator or a profile
 * creator is feature work and a decision about whether this surface should
 * exist at all — recorded for the owner rather than invented here. What the
 * test prevents is somebody reading these actions and assuming they work.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join } from 'path';
import { toMillis } from '@/lib/firestore-serialize';
import { LEGACY_ROLE_MAP } from '@/lib/types/roles';

const DASHBOARD = 'src/app/actions/vendor-dashboard.ts';
const VENDOR = 'src/app/actions/vendor.ts';
const SETTINGS = 'src/app/actions/vendor-settings.ts';
const LOCKING = 'src/lib/optimistic-locking.ts';
const MP_VERIFY = 'src/app/actions/marketplace/_payment_verify.ts';

function source(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8');
}

function code(rel: string): string {
    return source(rel)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .map((l) => l.replace(/\s\/\/.*$/, ''))
        .join('\n');
}

function fn(rel: string, name: string): string {
    const src = code(rel);
    const start = src.search(new RegExp(`(export )?(async )?function ${name}\\(`));
    expect(start).toBeGreaterThan(-1);
    const after = src.slice(start + 10);
    const end = after.search(/\n(export )?(async )?function /);
    return end > 0 ? after.slice(0, end) : after;
}

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (/\.(ts|tsx)$/.test(entry) && !full.includes('__tests__')) out.push(full);
    }
    return out;
}

/** Every non-test source line mentioning a collection constant. */
function referencesTo(constant: string): string[] {
    const hits: string[] = [];
    for (const file of walk(join(process.cwd(), 'src'))) {
        for (const line of readFileSync(file, 'utf-8').split('\n')) {
            if (line.includes(`COLLECTIONS.${constant}`)) hits.push(line.trim());
        }
    }
    return hits;
}

describe('a string compared to a Date is always false', () => {
    it('which is why every window read zero', () => {
        // THE premise, demonstrated rather than asserted.
        const startOfToday = new Date(2026, 7, 18);
        const serialised = '2026-08-18T10:00:00.000Z';

        // The order IS after the start of the day...
        expect(new Date(serialised) >= startOfToday).toBe(true);
        // ...and the comparison the code performed said otherwise.
        expect((serialised as any) >= (startOfToday as any)).toBe(false);
    });

    it('and serializeDocs really does produce that string', () => {
        const serialize = code('src/lib/firestore-serialize.ts');

        expect(serialize).toContain('return timestampToIso(value as { toDate: () => Date }) as any;');
        expect(serialize).toContain('return value.toISOString() as any;');
    });

    it('while toMillis handles every shape the adapter can hand back', () => {
        const when = Date.UTC(2026, 7, 18, 10);

        expect(toMillis(new Date(when))).toBe(when);
        expect(toMillis('2026-08-18T10:00:00.000Z')).toBe(when);
        expect(toMillis(when)).toBe(when);
        expect(toMillis({ toDate: () => new Date(when) })).toBe(when);
        expect(toMillis({ seconds: when / 1000, nanoseconds: 0 })).toBe(when);
        expect(toMillis(null)).toBe(0);
    });
});

describe('the vendor sales statistics', () => {
    const stats = fn(DASHBOARD, '_getVendorSalesStatsAction');

    it('compare milliseconds, not a string against a Date', () => {
        // THE test.
        expect(stats).toContain('const createdAtMs = toMillis(order.createdAt);');
        expect(stats).toContain('if (createdAtMs >= todayMs)');
        expect(stats).toContain('if (createdAtMs >= weekMs)');
        expect(stats).toContain('if (createdAtMs >= monthMs)');
    });

    it('with none of the old comparisons left', () => {
        expect(stats).not.toContain('createdAt >= startOfToday');
        expect(stats).not.toContain('createdAt >= startOfWeek');
        expect(stats).not.toContain('createdAt >= startOfMonth');
    });

    it('which its sibling already got right, so this is not a new convention', () => {
        // Vacuity guard.
        const trends = fn(DASHBOARD, '_getVendorRevenueTrendsAction');

        expect(trends).toContain('data.createdAt?.toDate ? data.createdAt.toDate() : new Date(data.createdAt)');
    });
});

describe('vendor_products is written by nothing', () => {
    const refs = referencesTo('VENDOR_PRODUCTS');

    it('so the catalogue is permanently empty', () => {
        // THE structural finding. Every reference is a read or an update-by-id;
        // there is no .set(), no .add(), no .doc() with no argument.
        expect(refs.length).toBeGreaterThan(0);

        const creators = refs.filter((l) => /\.add\(|\.doc\(\)/.test(l));
        expect(creators).toEqual([]);
    });

    it('and its "Add Product" route does not exist either', () => {
        expect(existsSync(join(process.cwd(), 'src/app/vendor/products/new'))).toBe(false);
    });

    it('while the marketplace keeps its products somewhere else entirely', () => {
        // Which is why nothing here can reach a buyer's checkout — the claim an
        // earlier comment in vendor.ts made and this corrects.
        expect(code(MP_VERIFY)).toContain('item.isFlashSale ? COLLECTIONS.FLASH_SALE_PRODUCTS : COLLECTIONS.PRODUCTS');
        expect(code(MP_VERIFY)).toContain('field: "availableQuantity"');
        // Raw source: this is a comment, and code() strips those.
        expect(source(VENDOR)).toContain('vendor_products is a different collection');
        expect(source(VENDOR)).toContain('CORRECTION to what this comment used to claim');
    });
});

describe('vendor_profiles is created by nothing', () => {
    it('so every settings saver fails on a record that never exists', () => {
        // THE second structural finding.
        const refs = referencesTo('VENDOR_PROFILES');
        expect(refs.length).toBeGreaterThan(0);

        const creators = refs.filter((l) => /\.set\(|\.add\(/.test(l));
        expect(creators).toEqual([]);
    });

    it('because versionedUpdate refuses a missing document rather than creating one', () => {
        const locking = code(LOCKING);

        expect(locking).toContain('throw new Error("Document does not exist");');
    });

    it('and all four savers go through it', () => {
        const settings = code(SETTINGS);
        const calls = settings.match(/versionedUpdate\(transaction, vendorRef/g) ?? [];

        expect(calls.length).toBe(4);
    });
});

describe('what /vendor is', () => {
    it('a legacy parallel of the marketplace seller flow', () => {
        // roles.ts says so itself.
        expect(LEGACY_ROLE_MAP.vendor).toBe('seller');
    });

    it('that nothing in the application links to', () => {
        const linkers: string[] = [];
        for (const file of walk(join(process.cwd(), 'src'))) {
            if (file.includes('/app/vendor/')) continue;
            if (file.endsWith('route-manifest.ts')) continue;
            const src = readFileSync(file, 'utf-8');
            if (/["'`]\/vendor(\/|["'`])/.test(src)) linkers.push(file);
        }

        expect(linkers).toEqual([]);
    });

    it('and that has no layout guard of its own', () => {
        // Every other module surface gates itself in a layout —
        // /cooperatives/(member) calls checkModuleAccess. This one has none, so
        // middleware's "is logged in" is the whole of it. The per-record
        // ownership checks inside each action are what actually constrain it.
        expect(existsSync(join(process.cwd(), 'src/app/vendor/layout.tsx'))).toBe(false);
        expect(code('src/app/actions/vendor.ts')).toContain('throw new Error("Unauthorized");');
    });
});

describe('the activity feed limit', () => {
    const feed = fn(DASHBOARD, '_getVendorActivityFeedAction');

    it('was a dead parameter and is now honoured', () => {
        // THE test. The signature took `limit` and defaulted it to 20, and the
        // body never read it: orders were hardcoded to ten and every low-stock
        // product was appended after them.
        expect(feed).toContain('const feedLimit =');
        expect(feed).toContain('.slice(0, feedLimit)');
        expect(feed).not.toContain('.slice(0, 10)');
    });

    it('applied to the merged list, not to the orders alone', () => {
        // Otherwise a recent stock alert always loses to an older order, and
        // the caller still receives more entries than it asked for.
        expect(feed).toContain('activities: activities.slice(0, feedLimit)');
    });

    it('falling back to 20 on a value that is not a positive number', () => {
        expect(feed).toContain('Number.isFinite(Number(limit)) && Number(limit) > 0');
        expect(feed).toContain(': 20;');
    });

    it('and the callers really do pass one, so it was reachable', () => {
        // Vacuity guard: /vendor asks for 5 and /vendor/overview for 10, and
        // neither got what it asked for.
        expect(source('src/app/vendor/page.tsx')).toContain('getVendorActivityFeedAction(5)');
        expect(source('src/app/vendor/overview/page.tsx')).toContain('getVendorActivityFeedAction(10)');
    });

    it('which its neighbour already honoured', () => {
        // Vacuity guard: _getTopSellingProductsAction takes the same kind of
        // parameter and slices by it, so this was an oversight rather than a
        // convention.
        expect(fn(DASHBOARD, '_getTopSellingProductsAction')).toContain('.slice(0, limit)');
    });
});
