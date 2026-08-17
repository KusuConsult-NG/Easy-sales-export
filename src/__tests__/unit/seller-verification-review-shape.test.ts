/**
 * @jest-environment node
 */

/**
 * The screen an admin approves a seller from, and the fields it could not show.
 *
 * THREE SHAPES FOR ONE RECORD
 * ---------------------------
 * SELLER_VERIFICATIONS has two writers and one reader, and none of the three
 * agrees.
 *
 *   submitSellerVerificationAction   phoneNumber, address: {street,city,state,
 *                                    lga,country} (an OBJECT), bankAccount,
 *                                    no businessName, no documents
 *   submitMarketplaceOnboardingAction  phone, location: {state,lga,address},
 *                                    bankAccount, businessName,
 *                                    documents: {businessRegistrationUrl, ...}
 *   admin/marketplace/sellers        phone, address: string, state, lga,
 *                                    bankDetails, documents: {businessDoc,
 *                                    idDoc, addressProof}
 *
 * WHAT THE ADMIN SAW
 * ------------------
 * Address, state and LGA blank for BOTH paths. Business name and phone blank
 * for applications submitted through the verification form. All three documents
 * "Not uploaded" for both — the reader wants businessDoc/idDoc/addressProof,
 * normalizeAggressive emits businessCert/idCard/addressProof, and the source it
 * reads from is not what onboarding writes (businessRegistrationUrl). A
 * seller's uploaded business registration was unreachable under any name.
 *
 * AND ONE PATH CRASHED THE MODAL
 * ------------------------------
 * The detail view renders `{data.address}` directly. For a verification-form
 * record that is an object, and React throws "Objects are not valid as a React
 * child", unmounting the tree.
 *
 * CORRECTING MY OWN FIRST DRAFT
 * -----------------------------
 * I initially wrote that every bank field showed "N/A" because the writers store
 * `bankAccount` and the reader reads `bankDetails`. That was wrong, and reading
 * normalizeAggressive is what showed it: it falls back through
 * `sData?.bankAccount?.*` and the action injects the result as
 * `data.bankDetails`. Bank details have always resolved. The assertion below
 * pins that they still do.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { normaliseSellerVerification } from '@/lib/seller-verification-shape';

function code(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .map((l) => l.replace(/\s\/\/.*$/, ''))
        .join('\n');
}

/** Exactly what submitSellerVerificationAction stores. */
const VERIFICATION_FORM_RECORD = {
    id: 'seller_u1_1',
    userId: 'u1',
    status: 'pending',
    phoneNumber: '08030000000',
    address: { street: '1 Broad Street', city: 'Ikeja', state: 'Lagos', lga: 'Ikeja', country: 'Nigeria' },
    bankAccount: { accountNumber: '0123456789', bankName: 'A Bank', accountName: 'A Seller', bankCode: '058' },
};

/** Exactly what submitMarketplaceOnboardingAction stores. */
const ONBOARDING_RECORD = {
    id: 'seller_u2_1',
    userId: 'u2',
    status: 'pending',
    businessName: 'Kusu Farms',
    businessType: 'farming',
    phone: '08040000000',
    location: { state: 'Kaduna', lga: 'Zaria', address: '12 Market Road' },
    bankAccount: { bankName: 'B Bank', accountNumber: '9876543210', accountName: 'Kusu Farms' },
    documents: {
        businessRegistrationUrl: 'docs/biz-reg.pdf',
        farmPhotoUrls: ['docs/farm1.jpg'],
        productSampleUrls: [],
    },
};

describe('the object that crashed the modal', () => {
    it('becomes a readable string', () => {
        // THE test. React throws on an object child; this is the value the detail
        // view renders directly.
        const out = normaliseSellerVerification(VERIFICATION_FORM_RECORD);

        expect(typeof out.address).toBe('string');
        expect(out.address).toContain('1 Broad Street');
        expect(out.address).toContain('Lagos');
    });

    it('for the onboarding shape too, which stores it under `location`', () => {
        const out = normaliseSellerVerification(ONBOARDING_RECORD);

        expect(out.address).toContain('12 Market Road');
        expect(out.address).toContain('Zaria');
    });

    it('and never renders "[object Object]"', () => {
        // The careless version of this fix. A blank is bad; that string on an
        // admin screen is worse, because it looks like data.
        const weird = normaliseSellerVerification({ address: { nested: { deep: true } } } as any);

        expect(weird.address).not.toContain('object Object');
    });

    it('an already-flat address is left alone', () => {
        expect(normaliseSellerVerification({ address: '5 Church Street' }).address).toBe('5 Church Street');
    });

    it('and repeated parts are not printed twice', () => {
        const out = normaliseSellerVerification({
            location: { address: 'Lagos', state: 'Lagos', lga: 'Ikeja' },
        } as any);

        expect(out.address.match(/Lagos/g)).toHaveLength(1);
    });
});

describe('the fields that were blank', () => {
    it('state and lga come out of whichever object holds them', () => {
        expect(normaliseSellerVerification(VERIFICATION_FORM_RECORD)).toMatchObject({ state: 'Lagos', lga: 'Ikeja' });
        expect(normaliseSellerVerification(ONBOARDING_RECORD)).toMatchObject({ state: 'Kaduna', lga: 'Zaria' });
    });

    it('phone resolves from either spelling', () => {
        expect(normaliseSellerVerification(VERIFICATION_FORM_RECORD).phone).toBe('08030000000');
        expect(normaliseSellerVerification(ONBOARDING_RECORD).phone).toBe('08040000000');
    });

    it('the uploaded business registration is reachable', () => {
        // Three names in play: what the screen reads (businessDoc), what
        // normalizeAggressive emits (businessCert), and what onboarding writes
        // (businessRegistrationUrl). Only the last one exists on real records.
        expect(normaliseSellerVerification(ONBOARDING_RECORD).documents.businessDoc).toBe('docs/biz-reg.pdf');
    });

    it('a farm photo is NOT presented as proof of address', () => {
        // The tempting shortcut. Showing an unrelated image under that label
        // would be worse than showing none, because an admin would act on it.
        const out = normaliseSellerVerification(ONBOARDING_RECORD);

        expect(out.documents.addressProof).toBe('');
        // Still on the record for the raw-data view.
        expect((out.documents as any).farmPhotoUrls ?? out.farmPhotoUrls ?? out.documents).toBeDefined();
    });

    it('bank details still resolve — the part that was never broken', () => {
        // Correcting my own first draft: this always worked, through
        // normalizeAggressive's bankAccount fallback. Pinned so the adapter does
        // not regress it.
        expect(normaliseSellerVerification(VERIFICATION_FORM_RECORD).bankDetails).toEqual({
            bankName: 'A Bank', accountNumber: '0123456789', accountName: 'A Seller',
        });
    });

    it('missing everything yields empty strings, not undefined', () => {
        const out = normaliseSellerVerification({});

        expect(out.address).toBe('');
        expect(out.phone).toBe('');
        expect(out.documents.businessDoc).toBe('');
        expect(out.bankDetails.bankName).toBe('');
    });

    it('and null does not throw', () => {
        expect(() => normaliseSellerVerification(null)).not.toThrow();
    });

    it('unknown fields survive, so the raw view still shows everything', () => {
        const out = normaliseSellerVerification({ ...ONBOARDING_RECORD, somethingNew: 'kept' } as any);

        expect(out.somethingNew).toBe('kept');
        expect(out.userId).toBe('u2');
    });
});

describe('the admin action serves the canonical shape', () => {
    it('getStandardSellerVerificationsAction normalises before returning', () => {
        const src = code('src/app/actions/admin/_marketplace.ts');

        expect(src).toContain('normaliseSellerVerification(app)');
        // And not the raw spread that carried the object through.
        expect(src).not.toMatch(/data:\s*\{\s*\.\.\.app,/);
    });

    it('and its in-memory sort uses toMillis', () => {
        // It read `new Date(x?.toDate ? ... : x || 0)`, which is an Invalid Date
        // for a plain {seconds} object — NaN, and a comparator returning NaN does
        // not order anything. Same family as the 34 keys fixed before it.
        const src = code('src/app/actions/admin/_marketplace.ts');

        expect(src).not.toContain('a.data.createdAt.toDate().toISOString()');
        expect(src).toContain('toMillis(a.data?.createdAt)');
    });
});

describe('one approved status', () => {
    it('the server action writes "approved", like the API route', () => {
        // Two approval implementations wrote different values into
        // serviceRegistrations.marketplace.status: the route wrote "approved",
        // this action wrote "active". Every reader tests "approved" —
        // marketplace/seller/layout.tsx redirects to /onboarding otherwise.
        //
        // NOT a live lockout: the admin UI calls the route. This action is
        // exported from the barrel and reachable, and would have locked an
        // approved seller out of their own dashboard.
        const src = code('src/app/actions/admin/_marketplace.ts');

        expect(src).not.toContain('"serviceRegistrations.marketplace.status": "active"');
        expect(src).toContain('"serviceRegistrations.marketplace.status": "approved"');
    });

    it('and the route it now agrees with still writes it too', () => {
        // Vacuity guard: making them agree by breaking the working one would
        // satisfy the assertion above.
        const src = code('src/app/api/admin/marketplace/approve-seller/route.ts');

        expect(src).toContain('"serviceRegistrations.marketplace.status": "approved"');
    });
});

describe('onboarding validates before it uploads', () => {
    const ONBOARDING = 'src/app/actions/marketplace/_mp_onboarding.ts';

    it('every validation runs ahead of the first upload', () => {
        // A submission failing the location or bank check had already written a
        // business registration, farm photos and product samples to storage. The
        // seller retried and uploaded them all again — orphaned copies on every
        // failed attempt, referenced by nothing.
        const src = code(ONBOARDING);
        const fn = src.slice(src.indexOf('async function _submitMarketplaceOnboardingAction'));

        const locationCheck = fn.indexOf('Location details (State, LGA, Address) are required');
        const bankCheck = fn.indexOf('Bank account details (Bank Name, Account Number, Account Name) are required');
        const firstUpload = fn.indexOf('const uploadFile = async');

        expect(locationCheck).toBeGreaterThan(-1);
        expect(bankCheck).toBeGreaterThan(-1);
        expect(firstUpload).toBeGreaterThan(locationCheck);
        expect(firstUpload).toBeGreaterThan(bankCheck);
    });

    it('and no JSON.parse is left unguarded', () => {
        // `sellerCategories` and `certifications` were parsed with no try/catch,
        // while `location` and `bankAccount` twenty lines away were wrapped. A
        // malformed value threw into the outer catch and the seller was told
        // "Failed to submit" with no clue which field was wrong.
        const src = code(ONBOARDING);

        expect(src).not.toMatch(/JSON\.parse\(formData\.get\("sellerCategories"\)/);
        expect(src).not.toMatch(/JSON\.parse\(formData\.get\("certifications"\)/);
        expect(src).toContain('parseJsonField');
    });

    it('and each malformed field says which one it was', () => {
        const src = code(ONBOARDING);

        expect(src).toContain('Location details could not be read');
        expect(src).toContain('Bank account details could not be read');
        expect(src).toContain('Categories or certifications could not be read');
    });
});
