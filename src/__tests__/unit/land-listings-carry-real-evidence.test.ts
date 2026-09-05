/**
 * @jest-environment node
 */

/**
 * THREE WRITERS PUT LAND ON THE PLATFORM. TWO OF THEM FABRICATED THE EVIDENCE.
 *
 * COLLECTIONS.LAND_LISTINGS has three writers. The one the live form uses is
 * correct. Neither of the other two has a caller anywhere in the app — which is
 * exactly why nothing surfaced them, and is no protection at all: one is an HTTP
 * route, always reachable by URL, and the other is an export of a "use server"
 * module, which makes it an endpoint whether or not a screen calls it.
 *
 *   writer                                  reachable   documents            status
 *   submitLandListingAction (the form)      yes         real upload URLs     pending_verification
 *   /api/farm-nation/create-listing         HTTP        placeholder_<name>   pending_verification
 *   listPropertyAction (barrel export)      action      {} — none at all     available
 *
 * DEFECT 1 — LAND ON SALE, LABELLED "Verified Land", WITH NO TITLE DEED.
 * _listPropertyAction wrote `status: "available"` beside `verified: false`,
 * `documents: {}` and `images: []`. Those contradict each other and the status
 * is the half that decides:
 *
 *     PURCHASABLE_STATUSES = ["verified", "available", "approved"]
 *     BROWSABLE_STATUSES   = PURCHASABLE_STATUSES
 *
 * _fn_purchases.ts gates a purchase on isPurchasable(property.status) and lets
 * it through. farm-nation/page.tsx renders the badge as
 * `isPurchasable(property.status) ? "Verified Land" : "Unverified Land"`. And
 * because "available" is not a pending status, the listing never appeared in the
 * review queue, which reads status == "pending_verification" — it could not be
 * reviewed, and did not need to be, because it was already for sale.
 *
 * DEFECT 2 — THE TITLE DEED WAS THE FILENAME.
 * The API route stored `placeholder_${file.name}` for all eight images, the
 * video, and the land title, survey plan and tax clearance, under a comment
 * reading "placeholder for cloud storage upload". Nothing was uploaded. It then
 * REQUIRED the title and survey plan before writing, so a listing reached the
 * verification queue carrying "placeholder_deed.pdf" as its proof of ownership.
 * That is worse than storing nothing: an empty documents object reads as "no
 * evidence supplied", and a populated one reads as evidence — to the reviewer
 * approving a land sale.
 *
 * Both files had been visited by earlier findings, which corrected other things
 * in them and left these.
 *
 * WHAT THE TESTS BELOW PIN
 * ------------------------
 * Not "these two functions are fixed" but the property both defects broke: no
 * writer of this collection may produce a listing that is purchasable without
 * documents, and no writer may store a document reference it did not obtain.
 * The last test runs the rule over every writer at once, so a fourth cannot
 * quietly disagree.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';
import { isPurchasable, isBrowsable, PURCHASABLE_STATUSES } from '@/lib/land-listing-status';

jest.mock('@/lib/redis', () => ({
    redis: null,
    getCached: async () => null,
    setCache: async () => undefined,
    deleteCache: async () => undefined,
    CACHE_TTL: {},
}));
jest.mock('next/cache', () => ({
    revalidateTag: jest.fn(), updateTag: jest.fn(), revalidatePath: jest.fn(),
    unstable_cache: (fn: unknown) => fn,
}));
jest.mock('@/lib/audit-log', () => ({
    recordAdminAction: jest.fn(async () => ({})),
    createAdminAuditLog: jest.fn(async () => ({})),
    logAdminAction: jest.fn(async () => ({})),
    logAuditAction: jest.fn(async () => undefined),
}));

const uploadFileToStorage = jest.fn(
    async (_file: unknown, path: string) => `https://cdn.test/${path}`);
jest.mock('@/lib/storage-admin', () => ({
    uploadFileToStorage: (f: unknown, p: string) => uploadFileToStorage(f, p),
}));

declare const global: any;

let store: FakeDbHandle;

const OWNER = 'owner-1';

function actAs(id: string = OWNER) {
    global.mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id, roles: ['general_user'], email: `${id}@example.com`, name: 'Ada Obi' } },
        error: null,
    }));
}

/** A member the listing action will accept: cooperative registration approved. */
function seedOwner() {
    store.seed(COLLECTIONS.USERS, OWNER, {
        email: `${OWNER}@example.com`, name: 'Ada Obi', phone: '08011111111',
        serviceRegistrations: { cooperatives: { status: 'approved' } },
    });
}

function theOnlyListing(): Record<string, any> {
    const rows = store.all(COLLECTIONS.LAND_LISTINGS);
    expect(rows).toHaveLength(1);
    return rows[0][1] as Record<string, any>;
}

beforeEach(() => {
    jest.clearAllMocks();
    uploadFileToStorage.mockImplementation(async (_f, path) => `https://cdn.test/${path}`);
    store = installFakeDb();
    seedOwner();
    actAs();
});

describe('the premise: what "available" means to the rest of the platform', () => {
    it('is purchasable AND browsable, whatever `verified` says beside it', () => {
        // The two halves that contradicted each other, and which one decides.
        expect(PURCHASABLE_STATUSES).toContain('available');
        expect(isPurchasable('available')).toBe(true);
        expect(isBrowsable('available')).toBe(true);
    });

    it('and pending_verification is neither', () => {
        expect(isPurchasable('pending_verification')).toBe(false);
        expect(isBrowsable('pending_verification')).toBe(false);
    });

    it('and the badge is computed from the status, not from `verified`', () => {
        // farm-nation/page.tsx. Quoted so the finding rests on the screen's own
        // expression rather than on a description of it.
        const page = readFileSync(
            join(process.cwd(), 'src/app/farm-nation/page.tsx'), 'utf-8');

        expect(page).toContain('isPurchasable(property.status) ? "Verified Land" : "Unverified Land"');
    });
});

describe('listPropertyAction — the "use server" export with no caller', () => {
    const INPUT = {
        name: 'Two hectares at Epe',
        description: 'Cleared farmland with road access on the Lekki-Epe corridor.',
        location: 'Epe, Lagos',
        state: 'Lagos',
        lga: 'Epe',
        price: 4_500_000,
        size: 2,
        type: 'sale',
        category: 'farmland',
        features: ['road access'],
    };

    async function list() {
        const { listPropertyAction } = await import('@/app/actions/farm-nation/_fn_listings');
        return (await listPropertyAction(INPUT as any)) as any;
    }

    it('DOES NOT PUT THE LAND ON SALE — this wrote status: "available"', async () => {
        const res = await list();
        expect(res.success).toBe(true);

        const listing = theOnlyListing();
        expect(isPurchasable(listing.status)).toBe(false);
        expect(isBrowsable(listing.status)).toBe(false);
    });

    it('and it enters the verification queue instead', async () => {
        // The queue reads status == "pending_verification". At "available" the
        // listing was never in it — it could not be reviewed and did not need
        // to be.
        await list();

        expect(theOnlyListing().status).toBe('pending_verification');
    });

    it('and it is not labelled "Verified Land"', async () => {
        await list();

        // The badge the screen would print for this row.
        const badge = isPurchasable(theOnlyListing().status) ? 'Verified Land' : 'Unverified Land';
        expect(badge).toBe('Unverified Land');
    });

    it('and it still records that it has no documents', async () => {
        // Not papered over: the listing genuinely has none, which is why it
        // belongs in the queue.
        const listing = theOnlyListing.bind(null);
        await list();

        expect(listing().documents).toEqual({});
        expect(listing().images).toEqual([]);
        expect(listing().verified).toBe(false);
    });
});

describe('/api/farm-nation/create-listing — the HTTP door', () => {
    function file(name: string, body = 'x'): File {
        return new File([body], name, { type: 'application/pdf' });
    }

    function request(overrides: Record<string, string | File | undefined> = {}) {
        const form = new FormData();
        const fields: Record<string, string> = {
            title: 'Two hectares at Epe',
            category: 'farmland',
            description: 'Cleared farmland with road access.',
            state: 'Lagos',
            lga: 'Epe',
            address: '12 Epe Road',
            size: '2',
            unit: 'hectares',
            pricePerUnit: '2250000',
            totalPrice: '4500000',
        };
        for (const [k, v] of Object.entries(fields)) form.set(k, v);
        form.set('landTitle', file('deed.pdf'));
        form.set('surveyPlan', file('survey.pdf'));
        form.set('image0', file('plot.jpg', 'img'));

        for (const [k, v] of Object.entries(overrides)) {
            if (v === undefined) form.delete(k);
            else form.set(k, v as any);
        }
        return { formData: async () => form } as any;
    }

    async function post(req: any) {
        const { POST } = await import('@/app/api/farm-nation/create-listing/route');
        const res = await POST(req);
        return { status: res.status, body: await res.json() };
    }

    it('STORES A REAL URL FOR THE TITLE DEED — this stored "placeholder_deed.pdf"', async () => {
        const { body } = await post(request());
        expect(body.success).toBe(true);

        const listing = theOnlyListing();
        expect(listing.documents.landTitle).toBe('https://cdn.test/land-listings/owner-1/land-title');
        expect(listing.documents.surveyPlan).toBe('https://cdn.test/land-listings/owner-1/survey-plan');
        expect(listing.images).toEqual(['https://cdn.test/land-listings/owner-1/image-0']);
    });

    it('and the file itself is what was uploaded', async () => {
        await post(request());

        // The uploader received a File, not a name. The whole defect was that
        // the name was all that ever moved.
        const uploaded = uploadFileToStorage.mock.calls.map((c) => c[0]);
        expect(uploaded.length).toBeGreaterThan(0);
        for (const f of uploaded) expect(f).toBeInstanceOf(File);
    });

    it('and refuses without a title or survey plan — uploading nothing first', async () => {
        const { status, body } = await post(request({ surveyPlan: undefined }));

        expect(status).toBe(400);
        expect(body.error).toBe('Land title and survey plan are required');
        // The refusal used to come after the placeholders were built. Nothing
        // should be spent on a request that is going to be refused.
        expect(uploadFileToStorage).not.toHaveBeenCalled();
        expect(store.size(COLLECTIONS.LAND_LISTINGS)).toBe(0);
    });

    it('and writes NOTHING when an upload fails', async () => {
        // Half a listing whose deed did not upload is the same misleading
        // record by another route.
        uploadFileToStorage.mockRejectedValueOnce(new Error('Cloudinary refused'));

        const { status } = await post(request());

        expect(status).toBe(500);
        expect(store.size(COLLECTIONS.LAND_LISTINGS)).toBe(0);
    });
});

describe('the rule, over every writer of this collection', () => {
    it('NO writer produces a purchasable listing without documents', async () => {
        /**
         * The property both defects broke, checked by running each writer that
         * can be run and reading what it stored — rather than by asserting that
         * two particular functions were edited.
         */
        const { listPropertyAction } = await import('@/app/actions/farm-nation/_fn_listings');
        await listPropertyAction({
            name: 'Two hectares at Epe',
            description: 'Cleared farmland with road access on the Lekki-Epe corridor.',
            location: 'Epe, Lagos', state: 'Lagos', lga: 'Epe',
            price: 4_500_000, size: 2, type: 'sale', category: 'farmland', features: [],
        } as any);

        for (const [, listing] of store.all(COLLECTIONS.LAND_LISTINGS)) {
            const l = listing as Record<string, any>;
            const hasDocuments = Object.keys(l.documents ?? {}).length > 0;
            if (isPurchasable(l.status)) {
                expect(hasDocuments).toBe(true);
            }
        }
    });

    it('and no writer stores a document reference it did not obtain', () => {
        // The placeholder shape, gone from every writer of this collection.
        const writers = [
            'src/app/api/farm-nation/create-listing/route.ts',
            'src/app/actions/farm-nation/_fn_listings.ts',
            'src/app/actions/land-listings.ts',
        ];

        for (const rel of writers) {
            const code = readFileSync(join(process.cwd(), rel), 'utf-8')
                .replace(/\/\*[\s\S]*?\*\//g, '')
                .replace(/^\s*\/\/.*$/gm, '');

            expect(code).not.toContain('placeholder_');
        }
    });

    it('and the live form path is unchanged — real URLs, pending_verification', () => {
        const code = readFileSync(
            join(process.cwd(), 'src/app/actions/land-listings.ts'), 'utf-8');
        const submit = code.slice(code.indexOf('async function _submitLandListingAction'));

        expect(submit).toContain('images: data.imageUrls');
        expect(submit).toContain('documents: data.documentUrls');
        expect(submit).toContain('status: "pending_verification"');
    });
});
