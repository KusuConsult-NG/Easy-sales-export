/**
 * @jest-environment node
 */

/**
 *   A STEP THAT ONLY ITS OWN BUTTON CHECKED, AND DOCUMENTS NOBODY KEPT.
 *
 *   THE OWNER: "Product and business status should be mandatory."
 *
 * ── THE STEP NOTHING ASKED TWICE ────────────────────────────────────────────
 *
 *   Marketplace onboarding asks each question in three places and enforced it
 *   in one:
 *
 *       the step component   validate() on its own Continue button
 *       the submit guard     an inline Zod schema in handleSubmit
 *       the server action    four inline `if (!x) return` checks
 *
 *   The submit guard's schema had NO `buyerInterests`, NO `sellerCategories`
 *   and no product status — the whole of step 3 was outside it. The error
 *   handler directly below that schema nevertheless maps those exact paths back
 *   to step 3, a branch the schema could never produce. Somebody meant to check
 *   the step and the schema was never given the fields.
 *
 *   THE STEP'S OWN BUTTON IS SKIPPABLE, which is what makes that a defect
 *   rather than a redundancy. A restored draft jumps straight to the step it was
 *   saved at — `restoredStepIndex(parsed.step, 6, 1)` — so a member resuming at
 *   step 4 never ran step 2's or step 3's `validate()`, and nothing downstream
 *   asked again.
 *
 *   AND THE SERVER ASKED FOR LESS STILL. It checked the account type, the
 *   business name and the location. `businessType` and `phone` went straight
 *   into the record. `sellerCategories` fell through to `[]`. `sellerCategory`
 *   fell through to `"retail"` — and that one is not a label: it is stamped onto
 *   every product and it is what the wholesale and retail broadcast audiences
 *   are queried by (lib/seller-category), so an application that never answered
 *   was filed as a retail seller of nothing.
 *
 * ── AND THE DOCUMENTS ───────────────────────────────────────────────────────
 *
 *   Separately, and worse: every verification document the wizard uploaded was
 *   thrown away on arrival. The server read each one as
 *   `formData.get(key) as File` and tested `file.size > 0`; the wizard sends
 *   `JSON.stringify({ name, url })`, because #866 moved the bytes to
 *   /api/upload and submits the RESULT. A string has no `.size`, so
 *   `undefined > 0` was false and the entry was skipped in silence — CAC
 *   certificate, farm photos, product samples, all of them — and the
 *   application reached the approver with three empty fields.
 *
 *   THE SUITE WAS GREEN THROUGHOUT, because its fixture appends real `File`
 *   objects. It tested a shape no caller sends.
 *
 *   MUTATION-TESTED, WITH CONTROLS — table at the foot of this file.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from '@/lib/testing/strip-comments';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';
import {
    BUSINESS_STATUSES,
    PRODUCT_STATUSES,
    businessStatusLabel,
    productStatusLabel,
    isBusinessStatus,
    isProductStatus,
    missingApplicationFields,
    missingForStep,
} from '@/lib/marketplace-application';

const code = (rel: string) =>
    stripComments(readFileSync(join(process.cwd(), rel), 'utf8'), { label: rel });

// ─────────────────────────────────────────────────────────────────────────────
//   THE RULE, EXECUTED

/** A complete seller application — every assertion below starts from this. */
const complete = () => ({
    accountType: 'seller',
    sellerCategory: 'wholesale',
    businessName: 'Obi Farms',
    businessType: 'cooperative',
    businessStatus: 'registered',
    phone: '08012345678',
    location: { state: 'Plateau', lga: 'Jos North', address: '12 Market Road' },
    sellerCategories: ['grains'],
    productStatus: 'available',
    termsAccepted: true,
    bankAccount: { bankName: 'Zenith', accountNumber: '0123456789', accountName: 'Ada Obi' },
});

const without = (key: string) => {
    const application = complete() as Record<string, unknown>;
    delete application[key];
    return application;
};

const fieldsMissingFrom = (application: unknown): string[] =>
    missingApplicationFields(application as never).map((m) => m.field);

describe('the rule refuses an application that skipped a question', () => {
    it('A COMPLETE APPLICATION IS MISSING NOTHING — the control everything else rests on', () => {
        //   Without this, every assertion below could pass because the rule
        //   refuses everything.
        expect(missingApplicationFields(complete())).toEqual([]);
    });

    it.each([
        ['accountType', 1],
        ['sellerCategory', 1],
        ['businessName', 2],
        ['businessType', 2],
        ['businessStatus', 2],
        ['phone', 2],
        ['sellerCategories', 3],
        ['productStatus', 3],
        ['termsAccepted', 4],
    ])('NAMES %s, and says it is asked on step %i', (field, step) => {
        const missing = missingApplicationFields(without(field) as never);
        expect(missing.map((m) => m.field)).toContain(field);
        expect(missing.find((m) => m.field === field)!.step).toBe(step);
        expect(missing.find((m) => m.field === field)!.message).not.toBe('');
    });

    it('AND THE PRODUCT INTERESTS — the step the submit guard had no field for', () => {
        //   THE test for the reported defect. A seller who never opened step 3
        //   used to reach the database.
        expect(fieldsMissingFrom(without('sellerCategories'))).toContain('sellerCategories');
        expect(fieldsMissingFrom(without('productStatus'))).toContain('productStatus');

        //   An empty list is the same answer as no list. The server's own
        //   `?? []` fallback made these indistinguishable.
        expect(fieldsMissingFrom({ ...complete(), sellerCategories: [] }))
            .toContain('sellerCategories');
    });

    it('AND A BUYER IS ASKED WHAT SHE BUYS, not what she sells', () => {
        const buyer = {
            ...complete(), accountType: 'buyer', bankAccount: null,
            sellerCategory: undefined, sellerCategories: undefined, productStatus: undefined,
        };

        expect(fieldsMissingFrom(buyer)).toEqual(['buyerInterests']);
        expect(missingApplicationFields({ ...buyer, buyerInterests: ['Grains & Cereals'] }))
            .toEqual([]);
    });

    it('AND "both" IS ASKED BOTH', () => {
        const both = { ...complete(), accountType: 'both' };

        expect(fieldsMissingFrom(both)).toEqual(['buyerInterests']);
        expect(missingApplicationFields({ ...both, buyerInterests: ['Fruits'] })).toEqual([]);
    });

    it('and the FIRST missing answer is the earliest one, so a member is sent back to it', () => {
        //   The submit guard shows `missing[0]`. If the order were not the
        //   step order it would send somebody to the wrong screen.
        const empty = missingApplicationFields({});
        expect(empty[0].field).toBe('accountType');
        expect(empty.map((m) => m.step)).toEqual([...empty.map((m) => m.step)].sort((a, b) => a - b));
    });

    it('and a step sees only its own questions', () => {
        //   missingForStep is what the two step components render. Step 2 must
        //   not be tripped by a rule that depends on the account type, which
        //   BusinessProfileStep is not given.
        expect(Object.keys(missingForStep(2, {}))).toEqual(
            ['businessName', 'businessType', 'businessStatus', 'phone', 'state', 'lga', 'address']);
        expect(missingForStep(2, complete())).toEqual({});
    });

    it('and the keys it returns are the ones the steps display errors under', () => {
        //   A rename here silently stops an error rendering: the step reads
        //   `errors.businessStatus`, not `errors[whatever the rule called it]`.
        const step2 = code('src/app/marketplace/onboarding/steps/BusinessProfileStep.tsx');
        for (const key of ['businessName', 'businessType', 'businessStatus', 'phone', 'state', 'lga', 'address']) {
            expect({ key, rendered: step2.includes(`errors.${key}`) }).toEqual({ key, rendered: true });
        }

        const step3 = code('src/app/marketplace/onboarding/steps/ProductInterestsStep.tsx');
        for (const key of ['buyerInterests', 'sellerCategories', 'productStatus']) {
            expect({ key, rendered: step3.includes(`errors.${key}`) }).toEqual({ key, rendered: true });
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the two status fields', () => {
    it('BOTH ARE REAL STORED VOCABULARIES, not free text', () => {
        expect([...BUSINESS_STATUSES]).toEqual(['registered', 'in_progress', 'unregistered']);
        expect([...PRODUCT_STATUSES]).toEqual(['available', 'seasonal', 'pre_order']);
    });

    it('and each value can be named on screen', () => {
        for (const value of BUSINESS_STATUSES) expect(businessStatusLabel(value)).not.toBe('');
        for (const value of PRODUCT_STATUSES) expect(productStatusLabel(value)).not.toBe('');
    });

    it('and an unknown value is refused rather than guessed at', () => {
        expect(isBusinessStatus('sort-of-registered')).toBe(false);
        expect(isBusinessStatus('')).toBe(false);
        expect(isProductStatus('maybe')).toBe(false);
        expect(businessStatusLabel('nonsense')).toBe('');
        expect(productStatusLabel(undefined)).toBe('');

        expect(fieldsMissingFrom({ ...complete(), businessStatus: 'nonsense' }))
            .toContain('businessStatus');
        expect(fieldsMissingFrom({ ...complete(), productStatus: 'nonsense' }))
            .toContain('productStatus');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the three callers apply the one rule', () => {
    it('THE SUBMIT GUARD NO LONGER BUILDS ITS OWN SCHEMA', () => {
        //   The schema that left step 3 out, and the hand-written error-path
        //   mapping that tried to compensate for it.
        const src = code('src/app/marketplace/onboarding/MarketplaceOnboardingClient.tsx');

        expect(src).toContain('missingApplicationFields(');
        expect(src).not.toContain('const baseSchema = z.object(');
        expect(src).not.toContain("errorPath[0] === \"buyerInterests\"");
    });

    it('AND THE SERVER APPLIES IT TOO', () => {
        const src = code('src/app/actions/marketplace/_mp_onboarding.ts');

        expect(src).toContain('missingApplicationFields(');
        //   The four inline checks it replaced.
        expect(src).not.toContain('"Account type is required."');
        expect(src).not.toContain('"Business name is required."');
        expect(src).not.toContain('Location details (State, LGA, Address) are required.');
    });

    it('AND THE TWO STEPS ASK THE SAME QUESTIONS THEY DID', () => {
        expect(code('src/app/marketplace/onboarding/steps/BusinessProfileStep.tsx'))
            .toContain('missingForStep(2,');
        expect(code('src/app/marketplace/onboarding/steps/ProductInterestsStep.tsx'))
            .toContain('missingForStep(3,');
    });

    it('and the wizard actually SENDS the three answers the server now needs', () => {
        //   A rule the server applies to a field the client never submits
        //   refuses every real application. `termsAccepted` in particular was
        //   not sent at all before this.
        const src = code('src/app/marketplace/onboarding/MarketplaceOnboardingClient.tsx');

        for (const field of ['businessStatus', 'productStatus', 'termsAccepted']) {
            expect({ field, sent: src.includes(`formDataPayload.append("${field}"`) })
                .toEqual({ field, sent: true });
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
//   THE SERVER, EXECUTED

jest.mock('@/lib/redis', () => ({
    getCached: async () => null,
    setCache: async () => undefined,
    deleteCache: async () => undefined,
    redis: null,
}));

const uploadFileToStorage = jest.fn(
    async (_file: unknown, destination: string) => `https://storage.test/${destination}`);
jest.mock('@/lib/storage-admin', () => ({
    uploadFileToStorage: (f: unknown, d: string) => uploadFileToStorage(f, d),
}));

const SELLER = 'seller-1';
const VERIFICATIONS = COLLECTIONS.SELLER_VERIFICATIONS;
let store: FakeDbHandle;
const realFetch = global.fetch;

beforeEach(() => {
    jest.clearAllMocks();
    uploadFileToStorage.mockImplementation(
        async (_f: unknown, destination: string) => `https://storage.test/${destination}`);
    store = installFakeDb();
    (globalThis as {
        mockRequireSession: { mockImplementation: (f: () => unknown) => void };
    }).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id: SELLER, roles: ['user'], email: 'ada@example.com', name: 'Ada Obi' } },
        error: null,
    }));
    store.seed(COLLECTIONS.USERS, SELLER, {
        email: 'ada@example.com', firstName: 'Ada', lastName: 'Obi', roles: ['general_user'],
    });
    //   DELIBERATELY NOT `sk_test_…`. gitleaks reads that prefix as a Stripe
    //   access token and failed the build on this line; the neighbouring
    //   suites predate the scanner's window and were never rescanned. The
    //   resolver only checks that the variable is non-empty, so a value that
    //   is not secret-shaped costs nothing — and .gitleaks.toml says why
    //   widening its allowlist instead would be the wrong fix: "A broad
    //   allowlist is how a scanner stops being worth running."
    process.env.PAYSTACK_SECRET_KEY = 'paystack-key-placeholder-for-a-mocked-fetch';
    global.fetch = jest.fn(async () => ({
        ok: true,
        json: async () => ({ status: true, data: { account_name: 'ADAEZE N OBI', account_number: '0123456789' } }),
    })) as never;
});

afterEach(() => { global.fetch = realFetch; });

/** The submission the WIZARD sends — every document as JSON, never as a File. */
function submission(overrides: Record<string, string | undefined> = {}): FormData {
    const fd = new FormData();
    const fields: Record<string, string | undefined> = {
        accountType: 'seller',
        sellerCategory: 'wholesale',
        businessName: 'Obi Farms',
        businessType: 'cooperative',
        businessStatus: 'registered',
        phone: '08012345678',
        termsAccepted: 'true',
        productStatus: 'available',
        orderVolume: 'Bulk (5+ tons)',
        location: JSON.stringify({ state: 'Plateau', lga: 'Jos North', address: '12 Market Road' }),
        bankAccount: JSON.stringify({
            bankName: 'Zenith', accountNumber: '0123456789', accountName: 'Ada Obi', bankCode: '057',
        }),
        sellerCategories: JSON.stringify(['grains']),
        buyerInterests: JSON.stringify(['Grains & Cereals']),
        certifications: JSON.stringify(['NAFDAC']),
        ...overrides,
    };
    for (const [key, value] of Object.entries(fields)) {
        if (value !== undefined) fd.set(key, value);
    }
    return fd;
}

const submit = async (fd: FormData) => {
    const { submitMarketplaceOnboardingAction } = await import('@/app/actions/marketplace/_mp_onboarding');
    return await submitMarketplaceOnboardingAction(fd) as { success: boolean; error?: string | null };
};

const verification = () => store.all(VERIFICATIONS)[0]?.[1] as Record<string, unknown> | undefined;

describe('the server holds a request to what the wizard asks', () => {
    it('A WIZARD SUBMISSION IS ACCEPTED — the control', async () => {
        expect(await submit(submission())).toMatchObject({ success: true });
    });

    it.each([
        ['businessStatus', 'Please select your business registration status.'],
        ['productStatus', 'Please select the status of the products you will sell.'],
        ['sellerCategories', 'Select at least one product category you will sell.'],
        ['businessType', 'Please select a business type.'],
        ['phone', 'Phone number is required.'],
        ['termsAccepted', 'You must accept the terms and conditions.'],
    ])('REFUSES a submission with no %s, and says which', async (field, message) => {
        const fd = submission();
        fd.delete(field);

        expect(await submit(fd)).toMatchObject({ success: false, error: message });
        expect(store.size(VERIFICATIONS)).toBe(0);
    });

    it('AND REFUSES BEFORE UPLOADING ANYTHING', async () => {
        //   The ordering #… established and this must not undo: a refused
        //   submission that had already written files leaves orphans in the
        //   bucket on every retry.
        const fd = submission();
        fd.delete('productStatus');
        fd.set('businessRegistration', new File([new Uint8Array([1, 2, 3])], 'cac.jpg', { type: 'image/jpeg' }));

        expect((await submit(fd)).success).toBe(false);
        expect(uploadFileToStorage).not.toHaveBeenCalled();
    });

    it('AND STORES THE ANSWERS RATHER THAN DISCARDING THEM', async () => {
        await submit(submission());

        expect(verification()).toMatchObject({
            businessStatus: 'registered',
            productStatus: 'available',
            sellerCategory: 'wholesale',
            orderVolume: 'Bulk (5+ tons)',
            termsAccepted: true,
        });
        //   Submitted by the wizard since the step existed and read by nobody:
        //   there was no field for it on the record an approver sees.
        expect(verification()!.buyerInterests).toEqual(['Grains & Cereals']);
    });

    it('AND A BUYER WRITES NO VERIFICATION, so her answers go on the profile', async () => {
        const fd = submission({ accountType: 'buyer', bankAccount: '{}', sellerCategory: undefined });
        expect(await submit(fd)).toMatchObject({ success: true });
        expect(store.size(VERIFICATIONS)).toBe(0);

        const profile = (store.get(COLLECTIONS.USERS, SELLER) as Record<string, any>).verificationProfile;
        expect(profile.buyerInterests).toEqual(['Grains & Cereals']);
        expect(profile.business.status).toBe('registered');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the documents the wizard uploads are the documents that get filed', () => {
    const stored = (name: string, url: string) => JSON.stringify({ name, url });
    const CLOUDINARY = 'https://res.cloudinary.com/demo/image/upload/v1/sample.jpg';

    it('RECORDS A DOCUMENT THE BROWSER ALREADY STORED — the defect', async () => {
        //   THE test. Every one of these was dropped on arrival: the server
        //   read it as a File and a string has no `.size`.
        const fd = submission();
        fd.set('businessRegistration', stored('cac.pdf', CLOUDINARY));
        fd.set('farmPhotos_0', stored('farm.jpg', CLOUDINARY));
        fd.set('productSamples_0', stored('a.jpg', CLOUDINARY));
        fd.set('productSamples_1', stored('b.jpg', CLOUDINARY));

        expect(await submit(fd)).toMatchObject({ success: true });

        expect(verification()!.documents).toMatchObject({
            businessRegistrationUrl: CLOUDINARY,
            farmPhotoUrls: [CLOUDINARY],
            productSampleUrls: [CLOUDINARY, CLOUDINARY],
        });
        //   Nothing to re-upload: the browser already did it.
        expect(uploadFileToStorage).not.toHaveBeenCalled();
    });

    it('AND EVERY SLOT THE NEW BUTTON OPENS, not just the first two', async () => {
        //   "Add more product sample button" — the step drew exactly two slots
        //   at indices 0 and 1. A submission with six must file six.
        const fd = submission();
        for (let index = 0; index < 6; index += 1) {
            fd.set(`productSamples_${index}`, stored(`sample-${index}.jpg`, CLOUDINARY));
        }

        expect(await submit(fd)).toMatchObject({ success: true });
        expect((verification()!.documents as { productSampleUrls: string[] }).productSampleUrls)
            .toHaveLength(6);
    });

    it('AND REFUSES A URL FROM SOMEWHERE WE DO NOT STORE THINGS', async () => {
        //   The URL arrives from the client. Without a check, an arbitrary
        //   string is filed as a seller's business registration and shown to an
        //   approver as one.
        const fd = submission();
        fd.set('businessRegistration', stored('cac.pdf', 'https://evil.example/cac.pdf'));
        fd.set('productSamples_0', stored('a.jpg', '//evil.example/a.jpg'));
        fd.set('productSamples_1', stored('b.jpg', 'javascript:alert(1)'));

        expect(await submit(fd)).toMatchObject({ success: true });
        expect(verification()!.documents).toMatchObject({
            businessRegistrationUrl: '',
            productSampleUrls: [],
        });
    });

    it('and the local-disk backend\'s relative path is still accepted', async () => {
        //   /api/upload returns a site-relative path when it writes to disk.
        const fd = submission();
        fd.set('productSamples_0', stored('a.jpg', '/uploads/marketplace/a.jpg'));

        await submit(fd);
        expect((verification()!.documents as { productSampleUrls: string[] }).productSampleUrls)
            .toEqual(['/uploads/marketplace/a.jpg']);
    });

    it('POSITIVE CONTROL: A REAL FILE IS STILL UPLOADED', async () => {
        //   The shape the previous code handled. Swapping one for the other
        //   would trade this defect for its mirror image.
        const fd = submission();
        fd.set('productSamples_0', new File([new Uint8Array([1, 2, 3])], 'a.jpg', { type: 'image/jpeg' }));

        expect(await submit(fd)).toMatchObject({ success: true });
        expect(uploadFileToStorage).toHaveBeenCalledTimes(1);
        expect((verification()!.documents as { productSampleUrls: string[] }).productSampleUrls[0])
            .toContain('start_selling/product_samples');
    });

    it('POSITIVE CONTROL: and an application with no documents is still filed', async () => {
        //   They are Optional, and making them load-bearing would block every
        //   seller who has none to hand.
        expect(await submit(submission())).toMatchObject({ success: true });
        expect(verification()!.documents).toMatchObject({
            businessRegistrationUrl: '', farmPhotoUrls: [], productSampleUrls: [],
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the button, and the slots behind it', () => {
    const STEP = 'src/app/marketplace/onboarding/steps/BusinessVerificationStep.tsx';

    it('THE SLOTS ARE NO LONGER TWO HARD-CODED INDICES', () => {
        const src = code(STEP);

        expect(src).toContain('Add more product sample');
        expect(src).toContain('Array.from({ length: sampleSlots }');
        //   What it replaced.
        expect(src).not.toContain('label="Product 2"');
    });

    it('AND THE BUTTON STOPS AT THE CAP rather than growing without bound', () => {
        const src = code(STEP);

        expect(src).toContain('MAX_PRODUCT_SAMPLES');
        expect(src).toContain('disabled={sampleSlots >= MAX_PRODUCT_SAMPLES}');
    });

    it('POSITIVE CONTROL: the farm photos and the certificate are untouched', () => {
        //   Only the product samples were asked about. A change that swept the
        //   whole step would be a different, unrequested one.
        const src = code(STEP);

        expect(src).toContain('uploadPhotoAt("farmPhotos", 0');
        expect(src).toContain('uploadPhotoAt("farmPhotos", 1');
        expect(src).toContain('marketplace_business_registration');
    });
});

/*
 * ── MUTATION TABLE ──────────────────────────────────────────────────────────
 *
 *   Applied to lib/marketplace-application.ts,
 *   actions/marketplace/_mp_onboarding.ts and BusinessVerificationStep.tsx,
 *   this suite re-run against each. COUNTS ARE MEASURED.
 *
 *   MUTANT                                    DEAD  FIRST TO FAIL
 *   ───────────────────────────────────────── ────  ──────────────────────────
 *   drop the productStatus rule — the defect     5  'NAMES productStatus'
 *
 *   drop the sellerCategories rule — the         3  'NAMES sellerCategories'
 *   defect, the half that reached the database
 *
 *   drop the sellerCategory rule, restoring      1  'NAMES sellerCategory'
 *   the "retail" default
 *
 *   the rule returns [] always                  22  'NAMES accountType'
 *
 *   the rule reads no account type, so it       23  'A COMPLETE APPLICATION IS
 *   refuses far more than it should                 MISSING NOTHING'
 *
 *   buyerInterests asked of a SELLER too         1  'A COMPLETE APPLICATION IS
 *                                                   MISSING NOTHING'
 *
 *   sellerCategories asked of a BUYER            1  'AND A BUYER IS ASKED WHAT
 *                                                   SHE BUYS'
 *
 *   missing answers sorted by field name         1  'and a step sees only its
 *   instead of step order                           own questions' — NOT the
 *                                                   ordering assertion, which
 *                                                   survives it: sorting the
 *                                                   whole list happens to keep
 *                                                   accountType first. The
 *                                                   step-2 key ORDER is what
 *                                                   catches it.
 *
 *   server reads documents as Files only —       3  'RECORDS A DOCUMENT THE
 *   the second defect                               BROWSER ALREADY STORED'
 *
 *   server takes any URL the client sends        1  'AND REFUSES A URL FROM
 *                                                   SOMEWHERE WE DO NOT STORE'
 *
 *   server keeps URLs and stops uploading        1  'POSITIVE CONTROL: A REAL
 *   real Files                                      FILE IS STILL UPLOADED'
 *
 *   the rule runs AFTER the uploads              1  'AND REFUSES BEFORE
 *                                                   UPLOADING ANYTHING'
 *
 *   a product sample made mandatory              5  'A WIZARD SUBMISSION IS
 *                                                   ACCEPTED'
 *
 *   sample slots back to two fixed indices       1  'THE SLOTS ARE NO LONGER
 *                                                   TWO HARD-CODED INDICES'
 *
 *   the cap removed from the button              1  'AND THE BUTTON STOPS AT
 *                                                   THE CAP'
 *
 *   CONTROLS — SHOULD SURVIVE
 *   reword this module's header                  0  SURVIVED ✓
 *   rename a status LABEL (not its value)        0  SURVIVED ✓
 */
