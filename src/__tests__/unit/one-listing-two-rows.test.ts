/**
 * @jest-environment node
 */

/**
 *   THE OWNER: "Listing a product was create twice but was only listed once."
 *
 * ── A CLOCK READING IS NOT AN IDENTITY ──────────────────────────────────────
 *
 *   Both product creators built their document id the same way:
 *
 *       const productId = `product_${userId}_${Date.now()}`;
 *
 *   Date.now() says WHEN a request reached the server — the one thing that
 *   differs between a submission and its accidental twin. So two deliveries of
 *   the same listing got two ids, became two rows, and `.set()` had nothing to
 *   object to.
 *
 *   The "only listed once" half follows rather than contradicting: a new
 *   listing is held at PRODUCT_INITIAL_STATUS for review, an admin approves the
 *   one in front of them, and its twin stays in the queue. Two records, one
 *   listing.
 *
 *   BOTH FORMS ALREADY DISABLE THEIR BUTTON while submitting, and that is not
 *   the same guarantee: these are a "use server" export and an HTTP route, so a
 *   browser guard cannot bind a request that never came through a browser — a
 *   retried form post, a connection dropped after the write and before the
 *   response, or any other caller at all.
 *
 * ── WHAT IS ASSERTED ────────────────────────────────────────────────────────
 *
 *   The rule is executed, not read off the source, and the counted thing is
 *   ROWS IN THE COLLECTION. A test that asserted a success message would have
 *   passed against the defect, because both duplicates succeeded.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { stripComments } from '@/lib/testing/strip-comments';
import { COLLECTIONS } from '@/lib/types/firestore';
import {
    productDocumentId, cleanSubmissionId, hasSubmissionId, SUBMISSION_ID_FIELD,
} from '@/lib/product-submission';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null,
    setCache: async () => undefined,
    deleteCache: async () => undefined,
    redis: null,
}));

jest.mock('@/lib/auth', () => ({
    auth: async () => null,
    signIn: async () => undefined,
    signOut: async () => undefined,
    handlers: {},
}));

jest.mock('@/lib/storage-admin', () => ({
    uploadFileToStorage: async (_f: unknown, dest: string) => `https://cdn.test/${dest}`,
}));

const code = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

const SELLER = 'seller-1';
const SUBMISSION = 'b3f1c0de-0000-4000-8000-000000000001';
let store: FakeDbHandle;

function actAs(id: string, roles: string[] = ['seller']) {
    (globalThis as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id, roles, email: 'bola@example.com', name: 'Bola Ade' } },
        error: null,
    }));
}

function createForm(over: Record<string, string> = {}): FormData {
    const fd = new FormData();
    const base: Record<string, string> = {
        title: 'Premium Cocoa',
        description: 'Sun-dried cocoa beans from Ondo, graded and bagged for export.',
        category: 'grains',
        unit: 'kg',
        retailPrice: '5000',
        availableQuantity: '100',
        minimumOrderQuantity: '10',
        state: 'Ondo',
        lga: 'Akure',
        nearestMarket: 'Akure Main',
        deliveryMethod: 'pickup',
        bulkAvailable: 'false',
        exportReady: 'false',
        videoUrl: '',
        [SUBMISSION_ID_FIELD]: SUBMISSION,
    };
    for (const [k, v] of Object.entries({ ...base, ...over })) fd.append(k, v);
    return fd;
}

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    actAs(SELLER);
    store.seed(COLLECTIONS.USERS, SELLER, {
        roles: ['seller'], sellerVerificationStatus: 'approved', email: 'bola@example.com',
    });
});

const create = async (fd: FormData) =>
    (await (await import('@/app/actions/marketplace/_mp_products')).createProductAction(null, fd)) as any;

// ─────────────────────────────────────────────────────────────────────────────
describe('one submission, one product', () => {
    it('TWO DELIVERIES OF ONE SUBMISSION MAKE ONE ROW', async () => {
        //   THE test. Counted in the collection, because both calls report
        //   success — that is the whole reason the defect was invisible.
        const first = await create(createForm());
        const second = await create(createForm());

        expect(first.success).toBe(true);
        expect(second.success).toBe(true);
        expect(store.size(COLLECTIONS.PRODUCTS)).toBe(1);
        expect(second.data.productId).toBe(first.data.productId);
    });

    it('AND TWO REAL LISTINGS STILL MAKE TWO', async () => {
        //   The positive control. A rule that deduplicated everything would
        //   pass the test above and break the marketplace.
        await create(createForm());
        await create(createForm({
            [SUBMISSION_ID_FIELD]: 'b3f1c0de-0000-4000-8000-000000000002',
            title: 'Dried Hibiscus',
        }));

        expect(store.size(COLLECTIONS.PRODUCTS)).toBe(2);
    });

    it('AND A REFUSED SUBMISSION BURNS NOTHING', async () => {
        /*
         *   The export window modal learned this the hard way: it claimed its
         *   idempotency key BEFORE the compliance checks, so a member who
         *   failed KYC was left holding a key that answered "Duplicate
         *   transaction. Please wait." forever, escapable only by closing the
         *   modal — which nothing on the screen suggested.
         *
         *   Nothing is written here until the listing validates, so the same id
         *   sent again after a correction succeeds.
         */
        const refused = await create(createForm({ retailPrice: '0' }));
        expect(refused.success).toBe(false);
        expect(store.size(COLLECTIONS.PRODUCTS)).toBe(0);

        const corrected = await create(createForm());
        expect(corrected.success).toBe(true);
        expect(store.size(COLLECTIONS.PRODUCTS)).toBe(1);
    });

    it('AND A REPLAY NEVER WRITES OVER THE LISTING THAT EXISTS', async () => {
        /*
         *   A seller still holding a submission id could otherwise post it
         *   again and reset a suspended or archived listing back to a fresh
         *   pending one — the moderation escape hatch #906 closed from the
         *   other side. The replay reports success and touches nothing.
         */
        await create(createForm());
        const [id] = (store.all(COLLECTIONS.PRODUCTS)[0] as any);
        const row = store.get(COLLECTIONS.PRODUCTS, id) as any;
        store.seed(COLLECTIONS.PRODUCTS, id, { ...row, status: 'suspended', title: 'Moderated Title' });

        const replay = await create(createForm({ title: 'Premium Cocoa' }));

        expect(replay.success).toBe(true);
        expect(store.size(COLLECTIONS.PRODUCTS)).toBe(1);
        expect((store.get(COLLECTIONS.PRODUCTS, id) as any).status).toBe('suspended');
        expect((store.get(COLLECTIONS.PRODUCTS, id) as any).title).toBe('Moderated Title');
    });

    it('AND A BROWSER WITH NO SECURE RANDOM STILL GETS ITS LISTING', async () => {
        /*
         *   #833 useSubmissionId mints through `randomIdOrNull`, which returns
         *   null where neither crypto source exists — an older Android WebView,
         *   which on this platform is a real share of sellers. The field is
         *   then sent EMPTY rather than filled with a Math.random() guess, for
         *   the reason lib/random-id refuses one: two colliding ids from one
         *   seller would have the second listing read as a replay of the first
         *   and silently save nothing.
         *
         *   So an empty id must behave as no id: the clock fallback, two
         *   listings, nothing lost. That browser loses the deduplication, not
         *   the product.
         */
        const a = await create(createForm({ [SUBMISSION_ID_FIELD]: '' }));
        const b = await create(createForm({ [SUBMISSION_ID_FIELD]: '' }));

        expect(a.success && b.success).toBe(true);
        expect(store.size(COLLECTIONS.PRODUCTS)).toBe(2);
        expect(a.data.productId).not.toBe(b.data.productId);
    });

    it('AND A CALLER THAT SENDS NO ID IS UNAFFECTED', async () => {
        //   The fallback is the original clock-based id, so nothing that does
        //   not know about this rule changes behaviour.
        const fd = createForm();
        fd.delete(SUBMISSION_ID_FIELD);
        const a = await create(fd);

        const fd2 = createForm();
        fd2.delete(SUBMISSION_ID_FIELD);
        const b = await create(fd2);

        expect(a.success && b.success).toBe(true);
        expect(a.data.productId).not.toBe(b.data.productId);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('and what an id is allowed to be', () => {
    it('IT IS NAMESPACED BY THE SELLER', () => {
        //   Otherwise one member's chosen id addresses another member's product.
        expect(productDocumentId('seller-1', SUBMISSION))
            .not.toBe(productDocumentId('seller-2', SUBMISSION));
        expect(productDocumentId('seller-1', SUBMISSION)).toContain('seller-1');
    });

    it('AND THE SAME ID GIVES THE SAME DOCUMENT', () => {
        expect(productDocumentId(SELLER, SUBMISSION)).toBe(productDocumentId(SELLER, SUBMISSION));
    });

    it('AND A CLIENT VALUE IS FILTERED, NOT TRUSTED', () => {
        /*
         *   This becomes a primary key and part of a storage path
         *   (`products/${userId}/${productId}/...`), so path characters must
         *   not survive it.
         */
        expect(cleanSubmissionId('../../etc/passwd')).toBe('etcpasswd');
        expect(cleanSubmissionId('a/b\\c d')).toBe('abcd');
        expect(cleanSubmissionId('x'.repeat(500)).length).toBe(40);
        expect(cleanSubmissionId(null)).toBe('');
        expect(cleanSubmissionId(42)).toBe('');
    });

    it('AND AN ID WITH NOTHING USABLE LEFT IS NO ID AT ALL', () => {
        //   It must fall through to the clock, not to a shared empty key that
        //   every seller's first listing would collide on.
        expect(hasSubmissionId('/////')).toBe(false);
        expect(productDocumentId(SELLER, '/////')).not.toBe(`product_${SELLER}_`);
        expect(productDocumentId(SELLER, '')).toMatch(/^product_seller-1_\d+$/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('and both doors run the rule', () => {
    it('THE SERVER ACTION KEYS THE DOCUMENT ON THE SUBMISSION', () => {
        const src = code('src/app/actions/marketplace/_mp_products.ts');

        expect(src).toContain('productDocumentId(userId, submissionId)');
        expect(src).not.toContain('`product_${userId}_${Date.now()}`;');
    });

    it('AND SO DOES THE ROUTE', () => {
        const src = code('src/app/api/marketplace/create-product/route.ts');

        expect(src).toContain('productDocumentId(userId, submissionId)');
        expect(src).not.toContain('`product_${userId}_${Date.now()}`;');
    });

    it('AND THE ROUTE CHECKS BEFORE IT UPLOADS, not just before it writes', () => {
        /*
         *   Its image and video loops push to
         *   `products/${userId}/${productId}/...`. A duplicate delivery checked
         *   only at the write would still have re-uploaded every photo — paid
         *   bytes, for a listing already made.
         */
        const src = code('src/app/api/marketplace/create-product/route.ts');

        expect(src.indexOf('hasSubmissionId(submissionId)'))
            .toBeLessThan(src.indexOf('uploadFileToStorage(image, destination)'));
    });

    it('AND THE HOOK MINTS THROUGH THE SHARED RANDOM, never crypto.randomUUID', () => {
        //   #833 took the homepage down with that exact call. The sweep in
        //   one-line-that-took-the-homepage-down.test.ts is the general rule;
        //   this names the positive half, that the id comes from somewhere.
        const src = code('src/hooks/useSubmissionId.ts');
        expect(src).toContain('randomIdOrNull()');

        //   Comments stripped: this hook's own header EXPLAINS why there is no
        //   Math.random() path, and an assertion that matched that sentence
        //   would be satisfied by prose rather than by code.
        expect(stripComments(src, { label: 'useSubmissionId' })).not.toMatch(/Math\.random/);
    });

    it('AND BOTH FORMS SEND ONE, resetting it after a listing is made', () => {
        //   Stable across a retry, fresh after a success. A seller who lists two
        //   products without leaving the page must not have the second read as
        //   a replay of the first — told it worked, with nothing saved.
        for (const rel of [
            'src/app/marketplace/sell/create/page.tsx',
            'src/app/marketplace/products/add/page.tsx',
        ]) {
            const src = code(rel);
            expect({ rel, sends: src.includes('SUBMISSION_ID_FIELD, submissionId.current()') })
                .toEqual({ rel, sends: true });
            expect({ rel, resets: src.includes('submissionId.reset()') })
                .toEqual({ rel, resets: true });
        }
    });
});
