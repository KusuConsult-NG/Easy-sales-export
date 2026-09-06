/**
 * @jest-environment node
 */

/**
 *   #443 THE SCHEMA WAS WRITTEN TO HEAL, AND THE ONE ROW IT COULD NOT HEAL WAS
 *   THE ONE ROW THAT SKIPPED IT.
 *
 *   Found in a browser, not in a grep. A full Playwright run left this in the
 *   console twice, on two different specs, while both of them PASSED:
 *
 *       [Browser Console] error: Error Boundary caught: TypeError:
 *       Cannot read properties of undefined (reading 'length')
 *           at .../app/marketplace/buyer/dashboard/page-....js:1:13500
 *           at Array.map (<anonymous>)
 *
 *   THE CHAIN, EACH LINK MEASURED AGAINST THE RUNNING LOCAL STACK
 *
 *     1. The one order in the database is `e2e-disputed-order`. Its stored
 *        document has `productId`/`productName`/`quantity` — the older
 *        single-product shape — and NO `items` and NO `deliveryAddress`.
 *
 *     2. OrderSchema heals almost everything: `items` is
 *        `z.array(...).default([])`, so a missing `items` alone would have been
 *        an empty array. But `deliveryAddress` was a bare `z.object({...})`
 *        with no default — the ONLY field in the schema that could not heal,
 *        while every one of its own six fields has a default. So the parse
 *        threw.
 *
 *     3. Both order-list actions caught that throw and returned the RAW
 *        DOCUMENT — `serializeValue({ id: doc.id, ...data })` — still typed
 *        `Order`. The schema's whole purpose is skipped exactly when it is
 *        needed.
 *
 *     4. /marketplace/buyer/dashboard renders `{order.items.length} Items` and
 *        `order.items.map(i => i.productTitle)`. `undefined.length` unwound the
 *        route into MarketplaceErrorBoundary.
 *
 *   NINE READERS, ONE OF THEM GUARDED
 *
 *   buyer/orders/page.tsx writes `order.items && order.items.length > 0`.
 *   Every other reader — the buyer dashboard, the seller dashboard, the seller
 *   order list, three order detail pages, the admin dispute page — indexes
 *   straight in. That is the signature this audit has now met a dozen times:
 *   somebody hit the bug, fixed it where they stood, and the other eight copies
 *   kept it.
 *
 *   FIXED AT THE BOUNDARY, NOT IN THE RENDERS. Scattering `?.` through six
 *   screens would have hidden the next boundary break and left the type still
 *   lying. serializeOrder makes `Order` true, and serializeProduct does the
 *   same for the five product reads carrying the identical fallback.
 *
 *   AND ONE THING I ALMOST GOT WRONG. My first attempt gave deliveryAddress
 *   `.default({})`. A zod default is returned AS WRITTEN, so that produces a
 *   bare `{}` and leaves `deliveryAddress.recipientName` undefined for every
 *   healed row — a second, quieter version of the same defect. `.prefault({})`
 *   is parsed, so the six inner defaults apply. Measured before committing;
 *   pinned below.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     deliveryAddress back to a bare z.object({...})     KILLED
 *     .prefault({}) weakened to .default({})             KILLED
 *     serializeOrder's heal path returns `raw`           KILLED
 *     lenientObject stops applying declared defaults     KILLED
 *     the ORDER_DOORS list emptied                       KILLED
 *     reword this header                                 SURVIVED, as intended
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { z } from 'zod';
import { serializeOrder, serializeProduct } from '@/lib/firestore-serialize';
import { lenientObject } from '@/lib/schema-heal';
import { OrderSchema } from '@/lib/validations/marketplace';
import { stripComments } from '@/lib/testing/strip-comments';

/**
 * The repository's idiom for reading what a module logged: a global sink rather
 * than a jest.fn() required back.
 *
 * `jest` is deliberately NOT imported from '@jest/globals' above. It was, in my
 * first version, and this mock then did nothing at all — the two logging tests
 * below saw zero calls and the other seventeen passed regardless. That is #392
 * exactly ("a jest.mock that never mocked"), reproduced by me while fixing
 * something else. The hoisted jest.mock runs before an imported `jest` binding
 * exists; the global one is there.
 */
jest.mock('@/lib/logger', () => ({
    logger: {
        warn: (...a: unknown[]) => (global as any).__warned.push(a),
        error: () => undefined,
        info: () => undefined,
        debug: () => undefined,
    },
}));
const warned = (): unknown[][] => (global as any).__warned;

const ROOT = process.cwd();

/**
 * The order that was actually in the database when the crash was observed.
 *
 * Copied from the row, not invented: `raw_data` of `marketplace_orders`, read
 * through PostgREST while the Playwright web server was up.
 */
const THE_STORED_ROW = {
    id: 'e2e-disputed-order',
    status: 'cancelled',
    buyerId: 'bd6f47e1-bd57-4859-a1b9-68ef0a487d63',
    _version: 1,
    currency: 'NGN',
    quantity: 2,
    sellerId: '43dfb7d0-ab8d-4dc6-a221-3484b5c5bfba',
    createdAt: '2026-09-06T10:14:01.303Z',
    productId: 'e2e-product-1',
    updatedAt: '2026-09-06T10:15:27.510Z',
    productName: 'E2E Test Product 1',
    totalAmount: 2000,
    paymentStatus: 'paid',
};

// ─────────────────────────────────────────────────────────────────────────────
describe('#443 — the order that took the buyer dashboard down', () => {
    beforeEach(() => { (global as any).__warned = []; });

    it('THE PREMISE, MEASURED: it was `deliveryAddress` that threw, and nothing else', () => {
        // The pre-#443 schema, reconstructed by putting back the one thing that
        // changed — a required deliveryAddress. The stored row fails it.
        const asItWas = OrderSchema.extend({
            deliveryAddress: z.object({
                recipientName: z.string().default('Guest'),
                recipientPhone: z.string().default(''),
                street: z.string().default(''),
                city: z.string().default(''),
                state: z.string().default(''),
                lga: z.string().default(''),
            }),
        });
        const before = asItWas.safeParse(THE_STORED_ROW);
        expect(before.success).toBe(false);
        expect(before.error!.issues.map((i) => i.path.join('.'))).toEqual(['deliveryAddress']);

        // And with the schema as it is now, the SAME row parses — no healing
        // needed, `items` filled by the default that was always there. That is
        // the repair: not a catch that rescues the row, a schema that can heal
        // it in the first place.
        const after = OrderSchema.safeParse(THE_STORED_ROW);
        expect(after.success).toBe(true);
        expect(after.data!.items).toEqual([]);
    });

    it('AND ITS `items` IS AN ARRAY BY THE TIME A SCREEN SEES IT', () => {
        const order = serializeOrder('e2e-disputed-order', THE_STORED_ROW) as any;

        // This is the exact expression that threw:
        //     {order.items.length} Items
        expect(Array.isArray(order.items)).toBe(true);
        expect(() => order.items.length).not.toThrow();
        expect(order.items.map((i: any) => i.productTitle).join(', ')).toBe('');
    });

    it('and the healed deliveryAddress carries its OWN defaults, not a bare {}', () => {
        // `.default({})` would have satisfied "deliveryAddress is present" and
        // left every field inside it undefined — the same defect one level
        // down. `.prefault({})` parses the default, so the six inner defaults
        // apply.
        const order = serializeOrder('e2e-disputed-order', THE_STORED_ROW) as any;

        expect(order.deliveryAddress).toEqual({
            recipientName: 'Guest',
            recipientPhone: '',
            street: '',
            city: '',
            state: '',
            lga: '',
        });
    });

    it('and everything the row DID store survives the healing', () => {
        // Healing must never cost the screen a field the broken path showed.
        const order = serializeOrder('e2e-disputed-order', THE_STORED_ROW) as any;

        expect(order.id).toBe('e2e-disputed-order');
        expect(order.status).toBe('cancelled');
        expect(order.totalAmount).toBe(2000);
        expect(order.buyerId).toBe(THE_STORED_ROW.buyerId);
        expect(order.sellerId).toBe(THE_STORED_ROW.sellerId);
    });

    it('and a row the schema CANNOT heal is REPORTED rather than passed through in silence', () => {
        // `buyerId` has no default — there is no honest value to invent — so
        // this is a row healing cannot fully rescue. #379 wrote this hazard
        // down in a comment and nothing said it out loud at runtime. Silence is
        // the half that let it sit.
        const order = serializeOrder('no-buyer', { ...THE_STORED_ROW, buyerId: undefined }) as any;

        expect(warned()).toHaveLength(1);
        const [message, context] = warned()[0] as [string, any];
        expect(message).toContain('healing');
        expect(context.id).toBe('no-buyer');
        expect(context.issues.join(' ')).toContain('buyerId');

        // And it is STILL renderable — the point of healing over discarding.
        expect(Array.isArray(order.items)).toBe(true);
        expect(order.totalAmount).toBe(2000);
    });

    it('and a log line never carries the order CONTENTS', () => {
        // The issue list reaches a log aggregator. A delivery address is
        // personal data (#151, #341) and does not belong in one.
        serializeOrder('with-address', {
            ...THE_STORED_ROW,
            buyerId: undefined,
            deliveryAddress: { recipientName: 'Ada Complete', street: '12 Awolowo Road' },
        });

        expect(warned()).toHaveLength(1);
        const serialised = JSON.stringify(warned());
        expect(serialised).not.toContain('Ada Complete');
        expect(serialised).not.toContain('Awolowo');
    });

    it('SAYS NOTHING for an order that satisfies the schema', () => {
        serializeOrder('good', {
            buyerId: 'b1',
            sellerId: 's1',
            items: [{ productId: 'p1', productTitle: 'Yam', quantity: 2, unitPrice: 500, totalPrice: 1000 }],
            deliveryAddress: { recipientName: 'Ada', city: 'Jos' },
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
        });

        expect(warned()).toEqual([]);
    });

    it('and an order whose `items` is stored as the WRONG TYPE still arrives as an array', () => {
        // The missing key was the case that bit. A key holding a string is the
        // case a `?? []` in the render would also have missed.
        const order = serializeOrder('wrong-type', { ...THE_STORED_ROW, items: 'oops' }) as any;
        expect(Array.isArray(order.items)).toBe(true);
    });

    it('and a product with no images and no pricingTiers arrives with both as arrays', () => {
        // The same fallback lived in five product reads. #439 and #442 had to
        // defend the RENDERS against it, screen by screen; this defends the
        // boundary.
        const product = serializeProduct('p-bare', { title: 'Bare', sellerId: 's1' }) as any;

        expect(Array.isArray(product.images)).toBe(true);
        expect(Array.isArray(product.pricingTiers)).toBe(true);
        expect(Array.isArray(product.certifications)).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#443 — lenientObject derives its fallbacks and never throws', () => {
    const Strict = z.object({
        id: z.string(),
        names: z.array(z.string()).default([]),
        count: z.number().default(7),
        nested: z.object({ city: z.string().default('Jos') }).prefault({}),
        maybe: z.string().optional(),
    });
    const Lenient = lenientObject(Strict);

    it('APPLIES THE DEFAULT THE STRICT SCHEMA DECLARES, not one written out again', () => {
        // The point of deriving: change `.default(7)` above and this follows.
        // A hand-written skeleton is a second statement of every default, and a
        // second statement is what this audit keeps finding wrong.
        expect(Lenient.parse({})).toEqual({ names: [], count: 7, nested: { city: 'Jos' } });
    });

    it('and falls back on a value of the WRONG TYPE, not only a missing one', () => {
        expect(Lenient.parse({ id: 'x', names: 42, count: 'lots' }))
            .toEqual({ id: 'x', names: [], count: 7, nested: { city: 'Jos' } });
    });

    it('and a genuinely required field goes missing rather than discarding the row', () => {
        // `id` has no default. There is no honest value to invent, so it is
        // absent — and `names` beside it is still healed, which is the whole
        // difference from a strict parse that throws.
        const out = Lenient.parse({ names: ['a'] }) as Record<string, unknown>;
        expect(out.id).toBeUndefined();
        expect(out.names).toEqual(['a']);
    });

    it('NEVER THROWS, on anything', () => {
        for (const input of [{}, { id: 1 }, { names: null }, { nested: 'no' }, { maybe: 5 }]) {
            expect(() => Lenient.parse(input)).not.toThrow();
        }
    });

    it('CONTROL: the strict schema DOES throw on the same inputs', () => {
        // Without this, "lenient never throws" could pass because the strict
        // form never throws either, and the module would be doing nothing.
        expect(Strict.safeParse({}).success).toBe(false);
        expect(Strict.safeParse({ id: 'x', names: 42 }).success).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#443 — no order or product reaches a screen unvalidated', () => {
    function sourceFiles(dir: string, out: string[] = []): string[] {
        for (const name of readdirSync(dir)) {
            const p = join(dir, name);
            if (statSync(p).isDirectory()) {
                if (name === '__tests__' || name === '__mocks__') continue;
                sourceFiles(p, out);
            } else if (/\.tsx?$/.test(name) && !/\.(d|test|spec)\.tsx?$/.test(name)) {
                out.push(relative(ROOT, p));
            }
        }
        return out;
    }

    const ACTIONS = sourceFiles(join(ROOT, 'src/app/actions')).sort();
    const code = (rel: string) => stripComments(readFileSync(join(ROOT, rel), 'utf-8'), { label: rel });

    /**
     * `SomethingSchema.parse(...)` in a try whose catch returns the raw
     * document. Seven of these existed; each one is a schema that gets skipped
     * exactly on the row that needed it.
     */
    const PARSE_OR_RAW = /(Order|Product)Schema\.parse\(/;

    it('NO ACTION PARSES AN ORDER OR PRODUCT WITH A RAW-DOCUMENT FALLBACK', () => {
        const offenders = ACTIONS.filter((rel) => PARSE_OR_RAW.test(code(rel)));
        expect({ offenders }).toEqual({ offenders: [] });
    });

    it('VACUITY GUARD: the scan really is reading the actions', () => {
        expect(ACTIONS.length).toBeGreaterThan(80);
        expect(ACTIONS).toContain('src/app/actions/marketplace/_mp_catalog.ts');
        expect(ACTIONS).toContain('src/app/actions/marketplace/_mp_buyer_dashboard.ts');
        expect(code('src/app/actions/marketplace/_mp_buyer_dashboard.ts')).toContain('serializeOrders');
    });

    it('POSITIVE CONTROL: the pattern really does match the defect it names', () => {
        expect(PARSE_OR_RAW.test('const parsed = OrderSchema.parse({ id: doc.id, ...data });')).toBe(true);
        expect(PARSE_OR_RAW.test('return serializeOrder(doc.id, doc.data());')).toBe(false);
    });

    /** Every action that hands an order to a screen. */
    const ORDER_DOORS = [
        'src/app/actions/marketplace/_mp_buyer_dashboard.ts',
        'src/app/actions/marketplace/_mp_seller_dashboard.ts',
        'src/app/actions/orders.ts',
        'src/app/actions/order-management.ts',
    ];

    it('EVERY DOOR AN ORDER COMES THROUGH GOES VIA serializeOrder', () => {
        expect(ORDER_DOORS.length).toBe(4);
        for (const rel of ORDER_DOORS) {
            expect({ rel, healed: /serializeOrders?\(/.test(code(rel)) }).toEqual({ rel, healed: true });
        }
    });

    /**
     * Every field a screen reads off an order.
     *
     * serializeOrder STRIPS to OrderSchema, which is what keeps the payload
     * bounded. That is only safe while the schema describes everything the
     * screens read — anything omitted would simply vanish. Four of these were
     * missing when #443 started: trackingNumber, reviewSubmitted,
     * sellerAmountPaid and estimatedDeliveryDate.
     */
    it('AND EVERY FIELD THE SCREENS READ OFF AN ORDER IS IN THE SCHEMA', () => {
        const screens = [
            ...sourceFiles(join(ROOT, 'src/app/marketplace')),
            ...sourceFiles(join(ROOT, 'src/app/admin/marketplace')),
            ...sourceFiles(join(ROOT, 'src/app/dashboard')),
        ].filter((rel) => rel.endsWith('.tsx'));

        const read = new Set<string>();
        for (const rel of screens) {
            for (const m of code(rel).matchAll(/\border\??\.([A-Za-z_$][\w$]*)/g)) read.add(m[1]);
        }

        // `id` is attached by serializeOrder itself; the rest must be declared.
        const declared = new Set([...Object.keys(OrderSchema.shape), 'id']);
        const undeclared = [...read].filter((field) => !declared.has(field)).sort();

        expect({ undeclared }).toEqual({ undeclared: [] });
        expect(read.size).toBeGreaterThan(15);
    });
});
