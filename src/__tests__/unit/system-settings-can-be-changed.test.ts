/**
 * @jest-environment node
 */

/**
 *   #381 THE PLATFORM'S MONEY CONFIGURATION WAS A FAÇADE.
 *
 *        `system_settings` holds seven numbers, all of them read on live money
 *        paths, and this suite re-measures the premise rather than inheriting
 *        it: three readers, and — before this finding — ZERO writers anywhere
 *        in the codebase.
 *
 *          platformFeePercentage  the platform's cut, split off every escrow
 *          minOrderAmount         the checkout floor (#272)
 *          maxOrderAmount         the checkout ceiling (#272)
 *          usdToNgn               what an export buyer is charged at
 *          commissionRate         what a WAVE agent earns
 *          baseDeliveryFee        read by ONE action with zero callers
 *          additionalItemFee      read by NOTHING (#193)
 *
 *        So every one of them was permanently the constant in
 *        lib/system-settings, and moving any of them meant a code change and a
 *        deploy. The exchange rate is the one with a clock on it: export
 *        products are priced in dollars and charged in naira at `usdToNgn`.
 *
 *   AND THE DELIVERY FEE A BUYER PAID CAME FROM NEITHER OF THEM
 *
 *        marketplace-cart.calculateDeliveryFee(items, location, _fees) took the
 *        configured fees and discarded them — the parameter was named with a
 *        leading underscore, which is how it passed lint. Every figure in it was
 *        a literal. That is the rule /marketplace/checkout and the live Paystack
 *        door both use, so the platform had two delivery rules that disagreed by
 *        ₦500 before any surcharge, and the live one ignored configuration.
 *
 *   WHAT THIS SUITE PINS
 *
 *        1. NO BILL MOVED. The new rule, at its defaults, returns exactly what
 *           the old literals returned — asserted against the old arithmetic
 *           written out longhand, not against the new implementation.
 *        2. The rule now honours the fees it is handed, in every term.
 *        3. #193's additionalItemFee is charged, and is 0 by default.
 *        4. There is a writer, it is gated, bounds-checked, audited, and it
 *           invalidates the cache BEFORE reporting success.
 *        5. The screen and the validator read the same field definition.
 *
 *   TWO MUTANTS SURVIVE, AND ARE EQUIVALENT RATHER THAN UNCOVERED
 *
 *        Turning `distance > freeDistanceKm` into `>=`, and the same on weight,
 *        changes nothing observable: exactly AT the boundary the surcharge term
 *        is `(freeKm - freeKm) * rate` and `ceil(0 / step) * amount`, both zero.
 *        No input distinguishes the two forms, so no test can. Recorded here
 *        rather than answered with a contrived assertion.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { stripComments } from '@/lib/testing/strip-comments';
import { COLLECTIONS } from '@/lib/types/firestore';
import {
    deliveryFeeFor,
    DEFAULT_DELIVERY_FEES,
} from '@/lib/delivery-fee';
import {
    SYSTEM_SETTINGS_DOCS,
    SYSTEM_SETTINGS_FIELDS,
    SYSTEM_SETTINGS_TAGS,
    DEFAULT_FEES,
    systemSettingsFieldsFor,
    checkSystemSetting,
    checkSystemSettingsPatch,
} from '@/lib/system-settings';

// ─── mocks ───────────────────────────────────────────────────────────────────

const mockRequireAdmin = jest.fn() as jest.Mock<any>;
jest.mock('@/lib/require-admin', () => ({
    requireAdmin: (...a: any[]) => mockRequireAdmin(...a),
}));

const mockAudit = jest.fn() as jest.Mock<any>;
jest.mock('@/lib/audit-log', () => ({
    createAdminAuditLog: (...a: any[]) => mockAudit(...a),
    recordAdminAction: jest.fn(),
}));

const mockInvalidate = jest.fn() as jest.Mock<any>;
jest.mock('@/lib/cache-invalidation', () => ({
    invalidateSystemSettingsCache: (...a: any[]) => mockInvalidate(...a),
    deleteCache: jest.fn(),
}));

// ─── fixtures ────────────────────────────────────────────────────────────────

const ROOT = process.cwd();
const SETTINGS_LIB = 'src/lib/system-settings.ts';
const DELIVERY = 'src/lib/delivery-fee.ts';
const CART = 'src/lib/marketplace-cart.ts';
const ACTION = 'src/app/actions/admin/_settings.ts';
const SCREEN = 'src/app/admin/settings/fees/page.tsx';
const INDEX = 'src/app/admin/settings/page.tsx';

const ADMIN = 'admin-9';
const SETTINGS = COLLECTIONS.SYSTEM_SETTINGS;

let store: FakeDbHandle;

const actions = async () => await import('@/app/actions/admin/_settings');

function source(rel: string): string {
    return stripComments(readFileSync(join(ROOT, rel), 'utf-8'), { label: rel });
}

/** Every non-test source file, walked rather than listed. */
function sourceFiles(): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
        for (const e of readdirSync(dir)) {
            if (e === 'node_modules' || e === '__tests__') continue;
            const full = join(dir, e);
            if (statSync(full).isDirectory()) walk(full);
            else if (full.endsWith('.ts') || full.endsWith('.tsx')) out.push(full.slice(ROOT.length + 1));
        }
    };
    walk(join(ROOT, 'src'));
    return out.sort();
}

/**
 * THE OLD RULE, written out longhand from the pre-#381 source.
 *
 * The whole "no bill moved" claim rests on this, so it is stated independently
 * rather than by calling the new function with defaults — which would compare
 * the implementation with itself and pass whatever it does.
 */
function legacyDeliveryFee(location: any, weight: number): number {
    const isWithinCityCenter = location?.isWithinCityCenter !== false;
    const baseFee = isWithinCityCenter ? 2000 : 3000;
    const distance = typeof location?.distance === 'number' ? location.distance : 10;

    let fee = baseFee;
    if (distance > 10) fee += (distance - 10) * 20;
    if (weight > 5) fee += Math.ceil((weight - 5) / 5) * 500;
    return Math.round(fee);
}

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    mockRequireAdmin.mockResolvedValue({ userId: ADMIN });
    mockAudit.mockResolvedValue(undefined);
    mockInvalidate.mockResolvedValue(undefined);
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#381 — NO BILL MOVED: the new rule matches the old literals exactly', () => {
    // THE safety claim of this whole finding, exercised across the space rather
    // than at one point.
    const CASES: Array<[string, any, number]> = [
        ['no location at all', undefined, 0],
        ['empty location', {}, 0],
        ['inside the city', { isWithinCityCenter: true }, 0],
        ['outside the city', { isWithinCityCenter: false }, 0],
        ['exactly at the free distance', { distance: 10 }, 0],
        ['one km over', { distance: 11 }, 0],
        ['far away', { distance: 250 }, 0],
        ['fractional distance', { distance: 10.5 }, 0],
        ['exactly at the free weight', {}, 5],
        ['one kg over', {}, 6],
        ['exactly one step over', {}, 10],
        ['a step and a bit', {}, 11],
        ['a heavy cart', {}, 137],
        ['outside, far and heavy', { isWithinCityCenter: false, distance: 42 }, 88],
    ];

    it.each(CASES)('%s', (_name, location, weight) => {
        // One item, because the additional-item fee defaults to 0 and the old
        // rule had no per-item term at all — the multi-item case is below.
        expect(deliveryFeeFor(DEFAULT_FEES, location, 1, weight))
            .toBe(legacyDeliveryFee(location, weight));
    });

    it('and a MULTI-ITEM basket is unchanged too, because the new fee defaults to 0', () => {
        // #193 is wired, not switched on. If the default were its old 500, every
        // one of these would be higher than the legacy figure.
        for (const items of [1, 2, 5, 40]) {
            expect({ items, fee: deliveryFeeFor(DEFAULT_FEES, {}, items, 0) })
                .toEqual({ items, fee: legacyDeliveryFee({}, 0) });
        }
    });

    it('the delivery defaults ARE the old literals, named', () => {
        // The values, pinned. A later "tidy-up" that rounds one of these is a
        // price change, and this is where it gets caught.
        expect(DEFAULT_DELIVERY_FEES).toEqual({
            baseDeliveryFee: 2000,
            outsideCityDeliveryFee: 3000,
            additionalItemFee: 0,
            freeDistanceKm: 10,
            distanceSurchargePerKm: 20,
            freeWeightKg: 5,
            weightSurchargeStepKg: 5,
            weightSurchargeAmount: 500,
        });
    });

    it('and PlatformFees carries them, so a stored document overrides rather than replaces', () => {
        for (const [key, value] of Object.entries(DEFAULT_DELIVERY_FEES)) {
            expect({ key, value: (DEFAULT_FEES as any)[key] }).toEqual({ key, value });
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#381 — the rule now honours the fees it is handed', () => {
    it('EVERY TERM RESPONDS TO CONFIGURATION — not one of them is still a literal', () => {
        // THE test for the discarded-parameter defect. Each assertion changes
        // exactly one field and demands the fee move by exactly that much.
        const base = { ...DEFAULT_FEES };

        expect(deliveryFeeFor({ ...base, baseDeliveryFee: 2500 }, {}, 1, 0)).toBe(2500);
        expect(deliveryFeeFor({ ...base, outsideCityDeliveryFee: 9000 }, { isWithinCityCenter: false }, 1, 0)).toBe(9000);
        expect(deliveryFeeFor({ ...base, additionalItemFee: 100 }, {}, 4, 0)).toBe(2000 + 300);
        expect(deliveryFeeFor({ ...base, freeDistanceKm: 20 }, { distance: 15 }, 1, 0)).toBe(2000);
        expect(deliveryFeeFor({ ...base, distanceSurchargePerKm: 50 }, { distance: 12 }, 1, 0)).toBe(2000 + 100);
        expect(deliveryFeeFor({ ...base, freeWeightKg: 50 }, {}, 1, 20)).toBe(2000);
        expect(deliveryFeeFor({ ...base, weightSurchargeStepKg: 10 }, {}, 1, 15)).toBe(2000 + 500);
        expect(deliveryFeeFor({ ...base, weightSurchargeAmount: 75 }, {}, 1, 6)).toBe(2000 + 75);
    });

    it('#193 — the additional-item fee is charged BEYOND THE FIRST item', () => {
        const fees = { ...DEFAULT_FEES, additionalItemFee: 250 };

        expect(deliveryFeeFor(fees, {}, 0, 0)).toBe(2000);
        expect(deliveryFeeFor(fees, {}, 1, 0)).toBe(2000);
        expect(deliveryFeeFor(fees, {}, 2, 0)).toBe(2250);
        expect(deliveryFeeFor(fees, {}, 3, 0)).toBe(2500);
    });

    it('a zero weight step falls back rather than returning Infinity', () => {
        // A stored document written before the bound existed would otherwise
        // make every order unplaceable, silently.
        const fee = deliveryFeeFor({ ...DEFAULT_FEES, weightSurchargeStepKg: 0 }, {}, 1, 20);

        expect(Number.isFinite(fee)).toBe(true);
        expect(fee).toBe(legacyDeliveryFee({}, 20));
    });

    it('and so does a missing, negative or unparseable field', () => {
        for (const bad of [undefined, null, '', '   ', -5, 'lots', NaN]) {
            const fee = deliveryFeeFor({ baseDeliveryFee: bad } as any, {}, 1, 0);
            expect({ bad: String(bad), fee }).toEqual({ bad: String(bad), fee: 2000 });
        }
    });

    it('the cart helper delegates to it instead of restating it', () => {
        const src = source(CART);

        expect(src).toContain('deliveryFeeFor(fees, location, items.length, weight)');
        // The literals are gone from the cart file. Not `toContain`-absent on a
        // single number, which would pass on a coincidence: none of the four.
        expect(src).not.toMatch(/isWithinCityCenter \? 2000 : 3000/);
        expect(src).not.toMatch(/\(distance - 10\) \* 20/);
        expect(src).not.toMatch(/\(weight - 5\) \/ 5\) \* 500/);
        // And the parameter is read, not discarded.
        expect(src).not.toContain('_fees');
    });

    it('and the second, unreachable door states the SAME rule rather than its own', () => {
        // createOrderAction charged a flat fees.baseDeliveryFee with no
        // surcharges — the copy that disagreed. It has zero callers, so this
        // changed no live price; it stops the two drifting further.
        const src = source('src/app/actions/orders.ts');

        expect(src).toContain('deliveryFeeFor(');
        expect(src).not.toContain('const deliveryFeePerSeller = fees.baseDeliveryFee;');
    });

    it('there is exactly ONE delivery rule in the codebase now', () => {
        // The premise of the paragraph above, swept rather than remembered.
        //
        // My first draft expected four files and got two — because the screen
        // and the admin action never NAME a surcharge field: they iterate
        // SYSTEM_SETTINGS_FIELDS. That is the stronger result, so the
        // assertion was corrected to the measurement rather than the other way
        // round: the rule and its declaration, and nowhere else.
        const owners = sourceFiles().filter((f) => /weightSurchargeAmount|weightSurchargeStepKg/.test(source(f)));

        expect(owners).toEqual([DELIVERY, SETTINGS_LIB].sort());
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#381 — the bounds refuse rather than clamp', () => {
    it('a rate above its ceiling is refused, naming the field', () => {
        const field = SYSTEM_SETTINGS_FIELDS.find((f) => f.key === 'platformFeePercentage')!;
        const res = checkSystemSetting(field, 0.9);

        expect(res.ok).toBe(false);
        expect((res as any).error).toContain('Platform fee');
    });

    it('AN EXCHANGE RATE OF ZERO IS REFUSED — it would make every export order free', () => {
        const field = SYSTEM_SETTINGS_FIELDS.find((f) => f.key === 'usdToNgn')!;

        expect(checkSystemSetting(field, 0).ok).toBe(false);
        expect(checkSystemSetting(field, -1).ok).toBe(false);
        expect(checkSystemSetting(field, 1650).ok).toBe(true);
    });

    it('AND AN ABSURD ONE IS TOO — a fat-fingered rate is the likelier mistake', () => {
        // 1650 typed with three extra zeroes charges an export buyer a thousand
        // times over. The ceiling is what makes that a refusal rather than a
        // transaction, so it has to be a real bound and not Infinity.
        const field = SYSTEM_SETTINGS_FIELDS.find((f) => f.key === 'usdToNgn')!;

        expect(Number.isFinite(field.max)).toBe(true);
        expect(checkSystemSetting(field, 1_650_000).ok).toBe(false);
        expect(checkSystemSetting(field, field.max).ok).toBe(true);
        expect(checkSystemSetting(field, field.max + 1).ok).toBe(false);
    });

    it('every field has a FINITE ceiling, so none of them is unbounded by accident', () => {
        for (const field of SYSTEM_SETTINGS_FIELDS) {
            expect({ key: field.key, bounded: Number.isFinite(field.max) && field.max > field.min })
                .toEqual({ key: field.key, bounded: true });
        }
    });

    it('a zero weight step is refused, because the rule divides by it', () => {
        const field = SYSTEM_SETTINGS_FIELDS.find((f) => f.key === 'weightSurchargeStepKg')!;

        expect(checkSystemSetting(field, 0).ok).toBe(false);
        expect(checkSystemSetting(field, 1).ok).toBe(true);
    });

    it('a blank, a word and an infinity are all refused', () => {
        const field = SYSTEM_SETTINGS_FIELDS.find((f) => f.key === 'baseDeliveryFee')!;

        for (const bad of ['', '  ', 'free', null, undefined, Infinity, NaN]) {
            expect({ bad: String(bad), ok: checkSystemSetting(field, bad).ok })
                .toEqual({ bad: String(bad), ok: false });
        }
    });

    it('a numeric string is accepted, because that is what a form sends', () => {
        const field = SYSTEM_SETTINGS_FIELDS.find((f) => f.key === 'baseDeliveryFee')!;

        expect(checkSystemSetting(field, ' 3000 ')).toEqual({ ok: true, value: 3000 });
    });

    it('A MAXIMUM BELOW THE MINIMUM IS REFUSED — it would refuse every order', () => {
        // Each bound is legal alone; the pair is not. Nothing else in the
        // codebase checks this, and getting it wrong closes the marketplace.
        const values = Object.fromEntries(
            systemSettingsFieldsFor('platform_fees').map((f) => [f.key, (DEFAULT_FEES as any)[f.key]]),
        );

        expect(checkSystemSettingsPatch('platform_fees', values).ok).toBe(true);
        expect(checkSystemSettingsPatch('platform_fees', { ...values, maxOrderAmount: 100 }).ok).toBe(false);
        expect(checkSystemSettingsPatch('platform_fees', { ...values, maxOrderAmount: values.minOrderAmount }).ok)
            .toBe(false);
    });

    it('and a patch keeps ONLY the fields the definition names', () => {
        // #43's class. A caller sending a whole response envelope — which is
        // exactly what #317 found happening one function up in the same file —
        // cannot get `success: true` into the settings row.
        const values = Object.fromEntries(
            systemSettingsFieldsFor('exchange_rates').map((f) => [f.key, (DEFAULT_FEES as any)[f.key] ?? 1650]),
        );
        const res = checkSystemSettingsPatch('exchange_rates', { ...values, success: true, evil: 1 });

        expect(res.ok).toBe(true);
        expect(Object.keys((res as any).values)).toEqual(['usdToNgn']);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#381 — THERE IS A WRITER NOW', () => {
    const save = async (doc: string, values: Record<string, unknown>) =>
        (await actions()).saveSystemSettingsAction(doc, values) as any;

    const feeValues = (over: Record<string, unknown> = {}) => ({
        ...Object.fromEntries(
            systemSettingsFieldsFor('platform_fees').map((f) => [f.key, (DEFAULT_FEES as any)[f.key]]),
        ),
        ...over,
    });

    it('THE ROW IS ACTUALLY WRITTEN — the whole finding, as one assertion', async () => {
        const res = await save('platform_fees', feeValues({ baseDeliveryFee: 3500 }));

        expect(res.success).toBe(true);
        expect(store.get(SETTINGS, 'platform_fees')).toMatchObject({
            baseDeliveryFee: 3500,
            platformFeePercentage: DEFAULT_FEES.platformFeePercentage,
            updatedBy: ADMIN,
        });
    });

    it('and the exchange rate — the one that cannot wait for a deploy', async () => {
        const res = await save('exchange_rates', { usdToNgn: 1875 });

        expect(res.success).toBe(true);
        expect(store.get(SETTINGS, 'exchange_rates')).toMatchObject({ usdToNgn: 1875 });
    });

    it('gated on config:update, and a refusal is not forgiven', async () => {
        mockRequireAdmin.mockResolvedValue({ error: 'Forbidden' });

        const res = await save('exchange_rates', { usdToNgn: 1875 });

        expect(res).toEqual({ success: false, error: 'Forbidden' });
        expect(store.get(SETTINGS, 'exchange_rates')).toBeUndefined();
        expect(mockAudit).not.toHaveBeenCalled();
        expect(mockInvalidate).not.toHaveBeenCalled();
    });

    it('names that permission rather than settling for "is an admin"', async () => {
        await save('exchange_rates', { usdToNgn: 1875 });

        expect(mockRequireAdmin).toHaveBeenCalledWith('config:update');
    });

    it('INVALIDATES THE CACHE — otherwise the save reports success and applies in an hour', async () => {
        // These getters are unstable_cache with revalidate 3600. Without this
        // an admin correcting the FX rate would be told it was saved while
        // export buyers kept paying the old one.
        await save('exchange_rates', { usdToNgn: 1875 });

        expect(mockInvalidate).toHaveBeenCalledTimes(1);
    });

    it('and AWAITS it, rather than firing it off and returning', async () => {
        // Ordering alone does not pin this: `void invalidate().catch(...)` also
        // starts before the return, so an assertion on call order passes on the
        // fire-and-forget version. What distinguishes them is whether the
        // action is still pending while the invalidation is.
        let release!: () => void;
        mockInvalidate.mockImplementation(
            () => new Promise<void>((resolve) => { release = () => resolve(); }),
        );

        let settled = false;
        const pending = save('exchange_rates', { usdToNgn: 1875 }).then((r: any) => {
            settled = true;
            return r;
        });

        // Let every already-resolved microtask run. If the action did not await
        // the invalidation, it has returned by now.
        await new Promise((r) => setTimeout(r, 0));
        expect(settled).toBe(false);

        release();
        const res = await pending;
        expect(res.success).toBe(true);
    });

    it('records who changed what', async () => {
        await save('wave_settings', { commissionRate: 0.07 });

        const [args] = mockAudit.mock.calls[0] as [any];
        expect(args).toMatchObject({
            action: 'config_updated',
            userId: ADMIN,
            targetId: 'wave_settings',
            targetType: 'system_settings',
        });
        expect(args.metadata.changes).toEqual({ commissionRate: 0.07 });
    });

    it('REFUSES A VALUE OUT OF BOUNDS and writes nothing', async () => {
        const res = await save('exchange_rates', { usdToNgn: 0 });

        expect(res.success).toBe(false);
        expect(res.error).toContain('USD');
        expect(store.get(SETTINGS, 'exchange_rates')).toBeUndefined();
        expect(mockInvalidate).not.toHaveBeenCalled();
    });

    it('refuses a settings group it does not define', async () => {
        const res = await save('secret_fees', { anything: 1 });

        expect(res.success).toBe(false);
        expect(res.error).toContain('secret_fees');
        expect(store.collections()).toEqual([]);
    });

    it('and refuses a partial patch rather than storing a half-configured document', async () => {
        // Every field of the group, or none: a merge that dropped
        // maxOrderAmount would leave the pair unchecked.
        const res = await save('platform_fees', { baseDeliveryFee: 3000 });

        expect(res.success).toBe(false);
        expect(store.get(SETTINGS, 'platform_fees')).toBeUndefined();
    });

    it('what it writes is what the readers then use', async () => {
        // End to end through the real shape, not through the getter (which is
        // wrapped in unstable_cache and cannot be exercised here).
        await save('platform_fees', feeValues({ additionalItemFee: 400 }));

        const stored = store.get(SETTINGS, 'platform_fees')!;
        expect(deliveryFeeFor({ ...DEFAULT_FEES, ...stored }, {}, 3, 0)).toBe(2000 + 800);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#381 — the matching read', () => {
    const load = async () => (await actions()).getSystemSettingsAction() as any;

    it('returns the DEFAULTS for a document nobody has saved', async () => {
        const res = await load();

        expect(res.success).toBe(true);
        expect(res.data.platform_fees.baseDeliveryFee).toBe(DEFAULT_FEES.baseDeliveryFee);
        expect(res.data.exchange_rates.usdToNgn).toBe(1650);
    });

    it('and the STORED value where there is one', async () => {
        store.seed(SETTINGS, 'exchange_rates', { usdToNgn: 1900 });

        const res = await load();

        expect(res.data.exchange_rates.usdToNgn).toBe(1900);
    });

    it('falling back per field, so one bad key does not blank the form', async () => {
        // #130's shape: one malformed row emptied the whole catalogue.
        store.seed(SETTINGS, 'platform_fees', {
            baseDeliveryFee: 'free', platformFeePercentage: 0.08,
        });

        const res = await load();

        expect(res.data.platform_fees.baseDeliveryFee).toBe(DEFAULT_FEES.baseDeliveryFee);
        expect(res.data.platform_fees.platformFeePercentage).toBe(0.08);
    });

    it('A READ FAILURE IS A FAILURE, not a set of defaults presented as live', () => {
        // #317's rule, and the one with teeth here: the screen offers Save, so
        // answering a failed read with defaults means an admin can write those
        // defaults over the platform's real fees without ever seeing them.
        // Asserted on the source because the failure branch cannot be reached
        // through the fake, which does not throw.
        const body = source(ACTION);
        const at = body.indexOf('async function _getSystemSettingsAction');
        const end = body.indexOf('async function _saveSystemSettingsAction', at + 1);
        expect({ at: at > -1, end: end > at }).toEqual({ at: true, end: true });

        const fn = body.slice(at, end);
        expect(fn).toContain('return { success: false as const, error: "Could not load system settings", data: null };');
        // And the catch does not hand back a data object of any kind.
        const cat = fn.slice(fn.indexOf('} catch'));
        expect(cat).not.toMatch(/success:\s*true/);
    });

    it('is gated too — seeing what the platform charges is its own right', async () => {
        await load();
        expect(mockRequireAdmin).toHaveBeenCalledWith('config:read');
    });

    it('and refuses when the gate refuses', async () => {
        mockRequireAdmin.mockResolvedValue({ error: 'Forbidden' });

        expect(await load()).toEqual({ success: false, error: 'Forbidden', data: null });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#381 — one definition, two consumers', () => {
    it('the screen renders from SYSTEM_SETTINGS_FIELDS rather than listing fields', () => {
        // A hand-written form is how a field ends up offered but not accepted,
        // or accepted but not offered.
        const src = source(SCREEN);

        // Counted, not merely present: the screen reads the definition TWICE —
        // once to shape the loaded values and once to render the inputs — and a
        // `toContain` is satisfied by either one alone, so a renderer replaced
        // by a hardcoded list survives it.
        expect((src.match(/systemSettingsFieldsFor\(doc\)/g) ?? []).length).toBe(2);
        expect(src).toContain('systemSettingsFieldsFor(doc).map((field)');
        expect(src).toContain('SYSTEM_SETTINGS_DOCS.map');
    });

    it('and every document has at least one field, so no group renders empty', () => {
        for (const doc of SYSTEM_SETTINGS_DOCS) {
            expect({ doc, fields: systemSettingsFieldsFor(doc).length > 0 })
                .toEqual({ doc, fields: true });
        }
    });

    it('every field has a default, so the form is never blank', () => {
        for (const field of SYSTEM_SETTINGS_FIELDS) {
            const defaults: Record<string, any> = {
                platform_fees: DEFAULT_FEES,
                exchange_rates: { usdToNgn: 1650 },
                wave_settings: { commissionRate: 0.05 },
            };
            expect({ key: field.key, has: typeof defaults[field.doc][field.key] === 'number' })
                .toEqual({ key: field.key, has: true });
        }
    });

    it('and every default is INSIDE its own declared bounds', () => {
        // A default outside its bounds means the screen loads a value the save
        // would reject — a form that cannot be submitted without being edited.
        for (const field of SYSTEM_SETTINGS_FIELDS) {
            const defaults: Record<string, any> = {
                platform_fees: DEFAULT_FEES,
                exchange_rates: { usdToNgn: 1650 },
                wave_settings: { commissionRate: 0.05 },
            };
            const check = checkSystemSetting(field, defaults[field.doc][field.key]);
            expect({ key: field.key, ok: check.ok, why: (check as any).error ?? null })
                .toEqual({ key: field.key, ok: true, why: null });
        }
    });

    it('the cache tags match the tags the getters actually register', () => {
        // A save invalidating "platform-fee" while the getter is cached under
        // "platform-fees" would be an invalidation that invalidates nothing.
        const lib = source(SETTINGS_LIB);

        for (const tag of Object.values(SYSTEM_SETTINGS_TAGS)) {
            expect({ tag, registered: lib.includes(`tags: ["${tag}"]`) })
                .toEqual({ tag, registered: true });
        }
        expect(Object.keys(SYSTEM_SETTINGS_TAGS).sort()).toEqual([...SYSTEM_SETTINGS_DOCS].sort());
    });

    it('AND THE INVALIDATOR REALLY DROPS ALL THREE — exercised, not read', async () => {
        // Structural assertions cannot tell `for (const tag of ...)` from a
        // single hardcoded call that leaves two caches stale. jest.requireActual
        // reaches past this file's own mock of the module.
        const { revalidateTag } = await import('next/cache');
        (revalidateTag as unknown as jest.Mock).mockClear();

        const real = jest.requireActual('@/lib/cache-invalidation') as {
            invalidateSystemSettingsCache: () => Promise<void>;
        };
        await real.invalidateSystemSettingsCache();

        const tags = (revalidateTag as unknown as jest.Mock).mock.calls.map((c: any[]) => c[0]).sort();
        expect(tags).toEqual(Object.values(SYSTEM_SETTINGS_TAGS).sort());
    });

    it('the screen has a way in from the settings index', () => {
        // #362 — a built screen with no navigation entry.
        expect(existsSync(join(ROOT, SCREEN))).toBe(true);
        expect(source(INDEX)).toContain('href: "/admin/settings/fees"');
    });

    it('and it does not render a failed load as an editable form of defaults', () => {
        // #295: the defect where a failed load showed placeholders and Save
        // wrote them over the real stored settings.
        const src = source(SCREEN);

        expect(src).toContain('setError(res?.error || "Could not load system settings")');
        expect(src).toContain('error ? null : (');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#381 — the premise, re-measured', () => {
    it('system_settings has a writer now, and it is the gated one', () => {
        const writers = sourceFiles().filter((f) =>
            /COLLECTIONS\.SYSTEM_SETTINGS\)\.doc\([^)]*\)\.set\(/.test(source(f)));

        expect(writers).toEqual([ACTION]);
    });

    it('and the readers are still the three this module owns', () => {
        const readers = sourceFiles().filter((f) => /COLLECTIONS\.SYSTEM_SETTINGS/.test(source(f)));

        expect(readers).toEqual([ACTION, SETTINGS_LIB].sort());
    });

    it('the delivery rule module imports nothing, so mocking system-settings cannot break it', () => {
        // This is not tidiness. delivery-fee's first draft imported DEFAULT_FEES
        // from system-settings, and three existing suites that mock that module
        // started failing with "Cannot read properties of undefined". A pure
        // rule with no imports cannot be broken by somebody else's mock.
        expect(source(DELIVERY)).not.toMatch(/^import /m);
    });

    it('and system-settings takes its delivery defaults from there, not a second copy', () => {
        expect(source(SETTINGS_LIB)).toContain('...DEFAULT_DELIVERY_FEES,');
    });
});
