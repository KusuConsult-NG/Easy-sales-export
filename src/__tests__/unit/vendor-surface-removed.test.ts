/**
 * @jest-environment node
 */

/**
 * /vendor was removed. This is what replaces the suite that pinned its reality.
 *
 * WHAT IT WAS
 * -----------
 * A legacy parallel of the marketplace seller flow. roles.ts says so outright —
 * LEGACY_ROLE_MAP maps the `vendor` role to `seller`. Five pages, three action
 * files, four collections, and nothing in the application linked to any of it;
 * the only references were two entries in route-manifest.ts.
 *
 * It did not work, and could not:
 *
 *   vendor_products   read in four places, WRITTEN NOWHERE. The catalogue was
 *                     permanently empty, and the "Add Product" link pointed at
 *                     /vendor/products/new, which is not a route.
 *   vendor_profiles   read and updated in five places, CREATED NOWHERE. Every
 *                     settings saver went through versionedUpdate, which throws
 *                     "Document does not exist" on a missing record — so the
 *                     settings page could not save anything, for anyone, ever.
 *   vendor_orders     declared in COLLECTIONS, referenced nowhere at all.
 *   vendor_reviews    the same.
 *
 * There was also no layout under src/app/vendor, so the only gate on the whole
 * surface was middleware's "are you logged in" — any signed-in account reached
 * a seller dashboard.
 *
 * WHY REMOVED RATHER THAN FINISHED
 * --------------------------------
 * Owner decision. Finishing it meant writing a product creator and a profile
 * creator to duplicate a marketplace seller flow that already works, and then
 * maintaining two seller surfaces. Nothing is lost by deleting it: the `vendor`
 * role already resolves to `seller`, so accounts holding it keep the working
 * flow.
 *
 * WHAT DELIBERATELY SURVIVED
 * --------------------------
 * VENDOR_SETTINGS and VENDOR_PROFILES stay in COLLECTIONS. admin/_legacy.ts
 * writes the first during legacy migration, and marketplace/_mp_products.ts
 * reads the second for a seller-name fallback. This app creates no
 * vendor_profiles row, but legacy production data may hold some, and removing
 * that read would silently change the seller name recorded on new products.
 * Deleting a constant is not worth changing what a shopper sees.
 */

import { describe, it, expect } from '@jest/globals';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { COLLECTIONS } from '@/lib/types/firestore';
import { isProtectedPath, isPublicPath } from '@/lib/route-manifest';

const ROOT = process.cwd();

function source(rel: string): string {
    return readFileSync(join(ROOT, rel), 'utf-8');
}

describe('the surface is gone', () => {
    it.each([
        ['the pages', 'src/app/vendor'],
        ['the product/order actions', 'src/app/actions/vendor.ts'],
        ['the dashboard actions', 'src/app/actions/vendor-dashboard.ts'],
        ['the settings actions', 'src/app/actions/vendor-settings.ts'],
    ])('%s no longer exist', (_label, rel) => {
        expect(existsSync(join(ROOT, rel))).toBe(false);
    });

    it('and no file anywhere imports what was deleted', () => {
        // The sharp one: a leftover import is a build failure, not a silent
        // regression, but this names it precisely if it happens.
        const offenders: string[] = [];
        (function walk(dir: string) {
            for (const e of readdirSync(dir)) {
                const full = join(dir, e);
                if (statSync(full).isDirectory()) {
                    if (e !== 'node_modules') walk(full);
                } else if (/\.tsx?$/.test(e)) {
                    const text = readFileSync(full, 'utf-8');
                    if (/from ['"]@\/app\/actions\/vendor(-dashboard|-settings)?['"]/.test(text)) {
                        offenders.push(full.slice(ROOT.length + 1));
                    }
                }
            }
        })(join(ROOT, 'src'));
        expect(offenders).toEqual([]);
    });
});

describe('the collections that nothing wrote are gone', () => {
    it.each([['VENDOR_PRODUCTS'], ['VENDOR_ORDERS'], ['VENDOR_REVIEWS']])(
        '%s is no longer declared',
        (key) => {
            expect((COLLECTIONS as Record<string, string>)[key]).toBeUndefined();
        },
    );

    it('and nothing references them', () => {
        const src = source('src/lib/types/firestore.ts');
        // The explanatory comment names them; the declarations must not.
        expect(src).not.toMatch(/^\s*VENDOR_PRODUCTS:/m);
        expect(src).not.toMatch(/^\s*VENDOR_ORDERS:/m);
        expect(src).not.toMatch(/^\s*VENDOR_REVIEWS:/m);
    });
});

describe('the two that had a live reader or writer stayed', () => {
    it('VENDOR_SETTINGS, because the legacy admin migration writes it', () => {
        expect(COLLECTIONS.VENDOR_SETTINGS).toBe('vendor_settings');
        expect(source('src/app/actions/admin/_legacy.ts')).toContain('COLLECTIONS.VENDOR_SETTINGS');
    });

    it('VENDOR_PROFILES, because the marketplace product creator reads it', () => {
        // Vacuity guard on the reasoning above: if this read ever goes away,
        // the constant can go with it — but not before.
        expect(COLLECTIONS.VENDOR_PROFILES).toBe('vendor_profiles');
        expect(source('src/app/actions/marketplace/_mp_products.ts'))
            .toContain('db.collection(COLLECTIONS.VENDOR_PROFILES).doc(userId).get()');
    });
});

describe('no route claims the surface any more', () => {
    it('/vendor is neither protected nor public — it simply does not exist', () => {
        expect(isProtectedPath('/vendor')).toBe(false);
        expect(isPublicPath('/vendor')).toBe(false);
    });

    it('and the manifest does not name it', () => {
        expect(source('src/lib/route-manifest.ts')).not.toContain('"/vendor"');
    });

    it('nor does the page smoke spec still try to visit it', () => {
        expect(source('tests/e2e/app-pages-smoke.spec.ts')).not.toContain("prefix: '/vendor'");
    });
});

describe('the vendor role still works, which is why nothing is lost', () => {
    it('because it resolves to seller', () => {
        // THE reason removal costs no capability. An account holding `vendor`
        // keeps the marketplace seller flow, which — unlike /vendor — works.
        const roles = source('src/lib/types/roles.ts');
        expect(roles).toContain('vendor');
        expect(roles).toMatch(/vendor:\s*["']seller["']/);
    });

    it('and the marketplace seller surface it maps onto is real', () => {
        for (const p of [
            'src/app/marketplace/seller/dashboard/page.tsx',
            'src/app/marketplace/seller/products/page.tsx',
            'src/app/marketplace/seller/orders/page.tsx',
        ]) {
            expect(existsSync(join(ROOT, p))).toBe(true);
        }
        expect(isProtectedPath('/marketplace/seller/dashboard')).toBe(true);
    });
});
