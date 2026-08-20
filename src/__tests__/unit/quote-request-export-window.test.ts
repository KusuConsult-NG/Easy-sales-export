/**
 * The RFQ that nobody could see, and the one that stopped working.
 *
 * A REGRESSION THIS AUDIT CAUSED
 * -----------------------------
 * QuoteRequestModal is mounted in TWO places:
 *
 *   marketplace/products/[id]      passes a marketplace product
 *   export/(app)/opportunities     passes an EXPORT WINDOW — item.id is a
 *                                  document in `exportWindows`, and sellerId is
 *                                  the literal string "admin_export"
 *
 * Commit 186426ee ("Send the quote notification to the product's seller", #161)
 * closed a real phishing primitive: sellerId and productName came from the
 * request and went straight into a notification, so the endpoint could send
 * platform-branded mail to any user with attacker-chosen text. The fix looks the
 * product up and derives both.
 *
 * It only looked in `products`. An export window id is not in `products`, so
 * every RFQ raised from the export opportunities page has returned "Product not
 * found" since that commit. The fix for one caller broke a second caller nobody
 * checked for.
 *
 * It was not working before that either, for an unrelated reason: the
 * notification was addressed to `sellerId`, which for these was "admin_export"
 * — a user id no account has. Export RFQs were written and delivered to nobody.
 *
 * An export window has a real counterparty: `createdBy`, the admin who opened
 * it, written from the session by createExportWindowAction. That is who the
 * quote is with.
 *
 * AND NOBODY COULD SEE ANY OF THEM
 * --------------------------------
 * The notification linked to `/marketplace/seller/quotes/{id}`. That route did
 * not exist, nor did its parent, nor `/marketplace/buyer/quotes`, which
 * revalidatePath named. getMyQuotesAction had no caller anywhere in the app. So
 * an RFQ was written, the buyer was told it succeeded, and neither party could
 * ever see it. Both list pages exist now and the notification points at one.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const BUYER = 'buyer-1';
const REAL_SELLER = 'seller-real';
const WINDOW_ADMIN = 'admin-who-opened-the-window';

function setSession(id: string, name = 'A Buyer') {
    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id, email: `${id}@e.com`, name, roles: [] } },
        error: null,
    }));
}

/**
 * Answers per COLLECTION, which the existing quote test's helper cannot do —
 * it returns one document for every read, so both lookups see the same thing
 * and the export branch is unreachable.
 *
 * doc().get() is handed only the document id by the harness, so the collection
 * is tracked from the collection() call that always precedes it.
 */
function setCollections(byCollection: Record<string, Record<string, any> | null>) {
    let current = '';
    (global as any).mockFirestoreCollection.mockImplementation((name: string) => {
        current = name;
        return undefined;
    });
    (global as any).mockFirestoreGet.mockImplementation(() => {
        const doc = byCollection[current] ?? null;
        return Promise.resolve({
            exists: doc !== null,
            empty: doc === null,
            size: doc ? 1 : 0,
            docs: [],
            data: () => doc ?? {},
        });
    });
}

const VALID = {
    productId: 'subject-1',
    productName: 'Whatever The Caller Says',
    sellerId: 'admin_export',
    quantity: 100,
};

async function submit(overrides: Record<string, any> = {}) {
    const { submitQuoteRequestAction } = await import('@/app/actions/marketplace/_quotes');
    return submitQuoteRequestAction({ ...VALID, ...overrides } as any) as any;
}

function added(): Array<{ collection: string; doc: any }> {
    return (global as any).mockFirestoreAdd.mock.calls.map((c: any[]) => ({
        collection: c[0],
        doc: c[c.length - 1],
    }));
}

const notification = () => added().find((a) => a.doc && 'read' in a.doc)?.doc;
const quote = () => added().find((a) => a.doc && 'buyerId' in a.doc)?.doc;

describe('an RFQ against an export window', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession(BUYER);
        setCollections({
            products: null,
            exportWindows: { createdBy: WINDOW_ADMIN, title: 'Q3 Cocoa Container' },
        });
    });

    it('succeeds — it has returned "Product not found" since #161', async () => {
        // THE test. Under the previous code the products lookup missed and the
        // function returned immediately, writing nothing at all.
        const r = await submit();

        expect(r.success).toBe(true);
    });

    it('is recorded against the admin who opened the window', async () => {
        // Not "admin_export" from the request, which is not a user id.
        await submit();

        expect(quote()?.sellerId).toBe(WINDOW_ADMIN);
        expect(quote()?.sellerId).not.toBe('admin_export');
    });

    it('notifies that admin, so it reaches an account that exists', async () => {
        await submit();

        expect(notification()?.userId).toBe(WINDOW_ADMIN);
    });

    it('takes the title from the window, not the request', async () => {
        // The phishing fix #161 made must survive on this branch too — it is the
        // same notification body.
        await submit({ productName: 'URGENT: verify your account at evil.example' });

        expect(quote()?.productName).toBe('Q3 Cocoa Container');
        expect(notification()?.message).toContain('Q3 Cocoa Container');
        expect(notification()?.message).not.toContain('evil.example');
    });

    it('marks which collection the id points into', async () => {
        // Without it a reader cannot tell the two apart, and they link to
        // different places.
        await submit();

        expect(quote()?.subjectType).toBe('export_window');
    });

    it('refuses a window with no createdBy rather than filing it against ""', async () => {
        // Older windows predate createdBy being taken from the session. A quote
        // with sellerId "" is one getMyQuotesAction would hand to nobody — the
        // same invisible-write this whole test file is about.
        setCollections({
            products: null,
            exportWindows: { title: 'Legacy Window' },
        });

        const r = await submit();

        expect(r.success).toBe(false);
        expect(added()).toEqual([]);
    });

    it('still refuses an id that is in neither collection', async () => {
        // Vacuity guard. If the export fallback accepted anything absent, the
        // "must exist" property #161 added would be gone.
        setCollections({ products: null, exportWindows: null });

        const r = await submit();

        expect(r.success).toBe(false);
        expect(r.error).toContain('not found');
        expect(added()).toEqual([]);
    });
});

describe('a marketplace product still takes the product branch', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession(BUYER);
        setCollections({
            products: { sellerId: REAL_SELLER, title: 'Cocoa Beans' },
            // Present, and must not be consulted: if the order were reversed,
            // every product quote would be attributed to this admin.
            exportWindows: { createdBy: WINDOW_ADMIN, title: 'Q3 Cocoa Container' },
        });
    });

    it('is recorded against the product\'s seller', async () => {
        await submit();

        expect(quote()?.sellerId).toBe(REAL_SELLER);
        expect(quote()?.sellerId).not.toBe(WINDOW_ADMIN);
    });

    it('is marked as a product, not an export window', async () => {
        await submit();

        expect(quote()?.subjectType).toBe('product');
        expect(quote()?.productName).toBe('Cocoa Beans');
    });
});

describe('the quote is reachable once it is written', () => {
    const root = process.cwd();
    const BUYER_PAGE = 'src/app/marketplace/buyer/quotes/page.tsx';
    const SELLER_PAGE = 'src/app/marketplace/seller/quotes/page.tsx';

    it('both list pages exist', () => {
        // They did not. This is the whole of the "written and invisible" defect:
        // revalidatePath named one, the notification linked into the other, and
        // neither was a route.
        expect(existsSync(join(root, BUYER_PAGE))).toBe(true);
        expect(existsSync(join(root, SELLER_PAGE))).toBe(true);
    });

    it('and each one actually calls getMyQuotesAction, with its own role', () => {
        // A page that exists and fetches nothing would satisfy the assertion
        // above while leaving the list empty for everyone.
        expect(readFileSync(join(root, BUYER_PAGE), 'utf-8')).toContain('getMyQuotesAction("buyer")');
        expect(readFileSync(join(root, SELLER_PAGE), 'utf-8')).toContain('getMyQuotesAction("seller")');
    });

    it('the notification links to a route that exists', async () => {
        jest.clearAllMocks();
        setSession(BUYER);
        setCollections({ products: { sellerId: REAL_SELLER, title: 'Cocoa Beans' }, exportWindows: null });

        await submit();

        const link = notification()?.link;
        expect(link).toBe('/marketplace/seller/quotes');
        // The old link was `${link}/${quoteRef.id}`, and there is still no
        // per-quote route — asserting the exact value is what catches a
        // well-meaning re-add of the id.
        expect(existsSync(join(root, `src/app${link}/page.tsx`))).toBe(true);
    });

    it('and both lists are linked from the sidebar', () => {
        // Reachable by notification only is still nearly invisible: a buyer
        // never gets one, so their list would have no entry point at all.
        const nav = readFileSync(join(root, 'src/components/layout/ModuleSidebar.tsx'), 'utf-8');

        expect(nav).toContain('/marketplace/buyer/quotes');
        expect(nav).toContain('/marketplace/seller/quotes');
    });
});
