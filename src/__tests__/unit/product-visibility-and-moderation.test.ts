/**
 * The seller form that produced invisible listings.
 *
 * TWO CREATORS, TWO ANSWERS
 * -------------------------
 *   createProductAction                    status: "pending"
 *     used by /marketplace/sell/create — the "Add your first product"
 *     destination linked from the seller products page (three times), the seller
 *     dashboard, seller analytics and the products page. Six entry points.
 *
 *   POST /api/marketplace/create-product   status: "active"
 *     used by /marketplace/products/add
 *
 * ProductSchema defaults to a third value, "draft", which no writer sets.
 *
 * Every buyer-facing reader filters on exactly `status == "active"` —
 * _mp_catalog.ts three times, _buyer.ts three more. So which of the two seller
 * forms was used decided whether the listing was ever visible, and the primary
 * one produced listings no buyer could see.
 *
 * NOTHING RELEASED THEM
 * ---------------------
 * No admin page or action anywhere listed or acted on a product.
 * admin-content.ts COUNTED pending/active/rejected products, so the dashboard
 * displayed the size of the backlog with no way to clear it. The only route out
 * of "pending" was POST /api/marketplace/update-product, which wrote any field
 * the body contained — so the state was a dead end for honest sellers and no
 * obstacle at all to anyone who found that endpoint.
 *
 * AND CERTIFICATIONS WERE DISCARDED
 * ---------------------------------
 * Both product forms collect certifications and both creators parse them. But
 * ProductSchema did not DECLARE the field, so Zod stripped it from
 * `validatedData`, and createProductAction wrote a product without it — on
 * create and on update. marketplace/products/[id] has a section that renders
 * `product.certifications`, and for anything created through the server action it
 * could only ever be empty. The API route, which does not run this schema, wrote
 * them fine: the same two-writers-disagree shape as the status.
 *
 * ON THE CHOICE MADE HERE
 * -----------------------
 * PRODUCT_INITIAL_STATUS is "active" — the non-breaking direction. The path that
 * works today publishes immediately; holding those products would break
 * something that works to enforce a policy that was never implemented. The
 * moderation queue exists so the accumulated backlog can be released and so a
 * live listing can be pulled. Switching to approval-before-publication is one
 * constant.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
    PRODUCT_INITIAL_STATUS,
    PRODUCT_VISIBLE_STATUSES,
    PRODUCT_APPROVABLE_FROM,
    PRODUCT_REJECTABLE_FROM,
    isVisibleProductStatus,
    normaliseProductStatus,
} from '@/lib/product-status';
import { ProductSchema } from '@/lib/validations/marketplace';

const ACTION = 'src/app/actions/marketplace/_mp_products.ts';
const ROUTE = 'src/app/api/marketplace/create-product/route.ts';
const ADMIN = 'src/app/actions/admin/_marketplace.ts';

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

describe('one initial status for both creators', () => {
    it('neither creator hardcodes its own', () => {
        // THE test. One wrote "pending" and the other "active", in files that
        // never referenced each other.
        for (const rel of [ACTION, ROUTE]) {
            const src = code(rel);
            expect(src).toContain('PRODUCT_INITIAL_STATUS');
            expect(src).not.toMatch(/status:\s*"pending"/);
            expect(src).not.toMatch(/status:\s*"active"/);
        }
    });

    it('and the shared value is one buyers can actually see', () => {
        // The whole defect in one assertion: "pending" is not in
        // PRODUCT_VISIBLE_STATUSES, so a creator writing it produced a listing
        // no reader would return. If someone changes the constant to a held
        // status, they must also build the release path — this fails until the
        // choice is deliberate.
        expect(isVisibleProductStatus(PRODUCT_INITIAL_STATUS)).toBe(true);
    });

    it('buyer-facing readers agree on what visible means', () => {
        expect([...PRODUCT_VISIBLE_STATUSES]).toEqual(['active']);
        expect(isVisibleProductStatus('pending')).toBe(false);
        expect(isVisibleProductStatus('draft')).toBe(false);
        expect(isVisibleProductStatus('suspended')).toBe(false);
        expect(isVisibleProductStatus(undefined)).toBe(false);
    });

    it('normalises the export module\'s spelling of the same idea', () => {
        // reviewExportProductAction writes "live" for what this module calls
        // "active". #26 found five disagreeing status vocabularies in the land
        // module from exactly this.
        expect(normaliseProductStatus('live')).toBe('active');
        expect(normaliseProductStatus('published')).toBe('active');
        expect(normaliseProductStatus('inactive')).toBe('suspended');
        expect(normaliseProductStatus('ACTIVE')).toBe('active');
        expect(normaliseProductStatus('nonsense')).toBeNull();
        expect(normaliseProductStatus('')).toBeNull();
        expect(normaliseProductStatus(null)).toBeNull();
    });
});

describe('the transitions a review may make', () => {
    it('publishes from every held state, including a reversal of a rejection', () => {
        // A rejected listing the seller has since fixed must be releasable, or
        // the decision is permanent and the seller has to relist.
        for (const from of ['draft', 'pending', 'rejected', 'suspended']) {
            expect(PRODUCT_APPROVABLE_FROM).toContain(from);
        }
    });

    it('can pull a listing that is already live', () => {
        // Without "active" here, moderation could only ever act on products that
        // were already invisible — which is no moderation at all now that new
        // listings publish immediately.
        expect(PRODUCT_REJECTABLE_FROM).toContain('active');
    });

    it('never treats "deleted" as approvable', () => {
        expect(PRODUCT_APPROVABLE_FROM).not.toContain('deleted');
        expect(PRODUCT_REJECTABLE_FROM).not.toContain('deleted');
    });

    it('does not list the target as a starting point', () => {
        // claimStatusTransitionFromAny filters the target out of the starting set
        // to keep the single-winner property, so listing it would be misleading
        // at best.
        expect(PRODUCT_APPROVABLE_FROM).not.toContain('active');
    });
});

describe('the admin review action', () => {
    it('uses a compare-and-swap, not a read-then-write', () => {
        // supabaseDb.runTransaction takes no lock, so a status check inside it is
        // an ordinary read and two admins would both proceed. This is the same
        // primitive every other money- or decision-moving path in the codebase
        // was moved onto.
        const src = code(ADMIN);
        const fn = src.slice(src.indexOf('async function _reviewProductAction'));

        expect(fn).toContain('claimStatusTransitionFromAny({');
        expect(fn.slice(0, 4000)).not.toContain('runTransaction');
    });

    it('takes the from-sets from the shared module', () => {
        const fn = code(ADMIN).slice(code(ADMIN).indexOf('async function _reviewProductAction'));

        expect(fn).toContain('PRODUCT_APPROVABLE_FROM');
        expect(fn).toContain('PRODUCT_REJECTABLE_FROM');
    });

    it('requires a reason to reject or suspend, but not to publish', () => {
        // A rejection with no reason leaves the seller with a dead listing and
        // nothing to fix.
        const fn = code(ADMIN).slice(code(ADMIN).indexOf('async function _reviewProductAction'));

        expect(fn).toContain('input.action !== "approve" && reason.length < 5');
    });

    it('distinguishes a missing product from one in the wrong state', () => {
        // Two different follow-ups. The null-status row is the case an earlier
        // fix in this audit added `exists` to TransitionResult for.
        const fn = code(ADMIN).slice(code(ADMIN).indexOf('async function _reviewProductAction'));

        expect(fn).toContain('claim.exists === false');
        expect(fn).toContain('Product not found');
        expect(fn).toContain('has no status recorded');
    });

    it('is admin-only', () => {
        const src = code(ADMIN);

        // The LIST stays on isAdmin: seeing the moderation queue is not acting
        // on it, and every admin role holds "users:read". Narrowing it would
        // blind marketplace_admin to its own backlog.
        const list = src.slice(src.indexOf('async function _getAdminProductsAction'),
            src.indexOf('async function _getAdminProductsAction') + 1200);
        expect(list).toContain('isAdmin(session.user.roles)');

        // The WRITE asks the permission matrix. isAdmin() is true for all six
        // module admins, so an academy_admin could publish a marketplace
        // product; "content:approve" belongs to super_admin, admin and
        // moderator.
        const review = src.slice(src.indexOf('async function _reviewProductAction'),
            src.indexOf('async function _reviewProductAction') + 1200);
        expect(review).toContain('hasAdminPermission(session.user.roles, "content:approve")');
        expect(review).not.toContain('!isAdmin(session.user.roles)');
    });

    it('writes an audit row naming the decision', () => {
        const fn = code(ADMIN).slice(code(ADMIN).indexOf('async function _reviewProductAction'));

        expect(fn).toContain('product_approved');
        expect(fn).toContain('product_rejected');
        expect(fn).toContain('product_suspended');
    });

    it('counts the backlog server-side, not as the length of a page', () => {
        // The mistake #37 made: a capped page length presented as a total.
        const fn = code(ADMIN).slice(code(ADMIN).indexOf('async function _getAdminProductsAction'));

        expect(fn).toContain('.count().get()');
    });
});

describe('the queue is reachable', () => {
    it('the page exists and calls both actions', () => {
        const page = source('src/app/admin/marketplace/products/page.tsx');

        expect(page).toContain('getAdminProductsAction');
        expect(page).toContain('reviewProductAction');
    });

    it('and is linked from the admin marketplace hub', () => {
        // An action with no route to it is the shape of the RFQ defect: it exists
        // and nobody can use it.
        expect(source('src/app/admin/marketplace/page.tsx')).toContain('/admin/marketplace/products');
    });

    it('both actions are exported from the admin barrel', () => {
        const barrel = source('src/app/actions/admin/index.ts');

        expect(barrel).toContain('getAdminProductsAction');
        expect(barrel).toContain('reviewProductAction');
    });
});

describe('certifications survive the round trip', () => {
    it('the schema declares the field, so Zod stops stripping it', () => {
        // THE cause. It was collected, parsed, validated — and not declared, so
        // `validatedData` never had it and the write could not include it.
        const parsed = ProductSchema.parse({
            id: 'p1',
            sellerId: 's1',
            title: 'Cocoa Beans',
            description: 'Dried cocoa',
            certifications: ['Organic', 'Fair Trade'],
            createdAt: new Date(),
            updatedAt: new Date(),
        });

        expect(parsed.certifications).toEqual(['Organic', 'Fair Trade']);
    });

    it('and defaults to empty rather than undefined', () => {
        const parsed = ProductSchema.parse({
            id: 'p1',
            sellerId: 's1',
            title: 'Cocoa Beans',
            description: 'Dried cocoa',
            createdAt: new Date(),
            updatedAt: new Date(),
        });

        expect(parsed.certifications).toEqual([]);
    });

    it('both the create and the update write it', () => {
        // Two sites in _mp_products.ts. The first version of this test checked
        // for the substring once, which the create path alone satisfied while
        // editing a product still silently dropped them.
        //
        // The update site is now CONDITIONAL — see #106. Restoring the write
        // fixed one fault and introduced another: the value being written is
        // parsed from a form field the seller edit page never sends, so every
        // edit put an empty array over what the create path had saved. It now
        // writes the form's value when the form carried the field and keeps the
        // stored one otherwise.
        //
        // Both sites still WRITE the field, which is what this test is for.
        // Whether the update preserves or replaces is behaviour, and
        // marketplace-products-behaviour.test.ts executes it.
        const src = code(ACTION);
        expect((src.match(/certifications:/g) || []).length).toBe(2);
        expect(src).toMatch(/certifications:\s*validatedData\.certifications/);
        expect(src).toMatch(/formData\.has\("certifications"\)/);
    });
});

describe('an edit cannot republish a suspended listing', () => {
    it('the update patch does not contain status', () => {
        // Otherwise an admin suspending a product would watch the seller undo it
        // by pressing Save on the edit form.
        const src = code(ACTION);
        const patch = src.slice(
            src.indexOf('const updatedProduct'),
            src.indexOf('await productRef.update(updatedProduct)'),
        );

        expect(patch).not.toMatch(/status:/);
    });

    it('and neither does the update ROUTE\'s whitelist', () => {
        const src = source('src/app/api/marketplace/update-product/route.ts');
        const list = src.slice(src.indexOf('SELLER_EDITABLE_FIELDS = ['), src.indexOf('] as const'));

        expect(list).not.toContain('"status"');
    });
});
