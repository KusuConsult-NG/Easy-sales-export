/**
 * @jest-environment node
 */

/**
 *   #906 THE EXPORT LISTING DOOR ASKED FOR A SESSION AND NOTHING ELSE.
 *
 *   Found auditing the files no test had named — export/(app)/products/create
 *   was on that list, and reading it led to the action behind it.
 *
 *   #486 found exactly this shape on the three land-listing writers and wrote
 *   down the rule: "THE GATE IS THE MODULE'S OWN ACCESS RULE, NOT APPROVAL."
 *   It never visited Export. submitExportProductAction did this and only this:
 *
 *       const sessionResult = await requireSession();
 *       if (!sessionResult.session) return …
 *       if (!session?.user) return …
 *       const dataToSave = { ...productData };
 *
 *   So any signed-in account on the platform could put a listing into the
 *   catalogue queue an admin works: an academy student, a marketplace buyer,
 *   somebody who has never opened Export.
 *
 * ── AND THE FORM BEING BEHIND A GATED LAYOUT IS NOT THE SAME THING ──────────
 *
 *   /export/(app)/layout.tsx redirects anybody checkModuleAccess refuses to
 *   /export/onboarding, so the SCREEN was protected. A server action is a POST
 *   endpoint reachable without it, which is the reasoning #803 recorded on the
 *   land door in this same audit: "A server action is callable directly, so
 *   whatever the form does client-side is not a guard."
 *
 * ── WHAT THE GATE IS NOT ────────────────────────────────────────────────────
 *
 *   NOT AN APPROVED SELLER CHECK. It is the same `checkModuleAccess` the layout
 *   makes, so the action admits exactly whom the screen admits. A stricter bar
 *   would refuse people the platform has already let in, and the listing lands
 *   `status: pending` for an admin either way — which is asserted below, because
 *   "gated" must not quietly become "auto-approved".
 *
 *   NOT A SCHEMA. productData is still an unvalidated `any`. Measured before
 *   leaving it: `status`, `isActive`, `userId` and the timestamps are written
 *   AFTER the spread so a caller cannot set them, lib/export-catalog-reader
 *   coerces every field it publishes, and the checkout refuses a non-positive
 *   stored price. An injected field reaches the row and nothing reads it. A
 *   schema here is worth doing and is a behaviour change to a live intake path,
 *   so it is recorded rather than bundled into a gate fix.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from '@/lib/testing/strip-comments';

const code = (rel: string) => stripComments(readFileSync(join(process.cwd(), rel), 'utf8'), { label: rel });

const SELLER = 'exporter-1';
const OUTSIDER = 'academy-student-1';

jest.mock('@/lib/audit-log', () => ({
    recordAdminAction: jest.fn(async () => ({})),
    createAdminAuditLog: jest.fn(async () => ({})),
}));
jest.mock('@/lib/record-retirement', () => ({
    retirementPatch: jest.fn(() => ({})),
    isRetired: jest.fn(() => false),
}));

const mockModuleAccess = jest.fn() as jest.Mock<any>;
jest.mock('@/lib/module-access-check', () => ({
    checkModuleAccess: (...a: any[]) => mockModuleAccess(...a),
}));

function setSession(id: string, roles: string[] = []) {
    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id, email: `${id}@e.com`, name: id, roles } },
        error: null,
    }));
}

const added = (): Record<string, any>[] =>
    (global as any).mockFirestoreAdd.mock.calls
        .map((c: any[]) => c[c.length - 1])
        .filter(Boolean);

async function submit(overrides: Record<string, any> = {}) {
    const { submitExportProductAction } = await import('@/app/actions/export-products');
    return submitExportProductAction({
        name: 'Grade A Cocoa',
        category: 'nuts',
        origin: 'Ondo',
        pricePerMT: 2_500,
        minOrderMT: 20,
        grades: ['A'],
        certifications: [],
        images: [],
        ...overrides,
    }) as any;
}

describe('who may put a listing in the export queue', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('A MEMBER WITH EXPORT ACCESS STILL LISTS (control)', () => {
        /*
         *   THE control, and it is the one that matters most on a gate: every
         *   assertion below is a refusal, and a door that refused EVERYONE would
         *   satisfy all of them while taking the module's listing form offline.
         */
        setSession(SELLER);
        mockModuleAccess.mockResolvedValue(true);

        return submit().then((r) => {
            expect(r.success).toBe(true);
            expect(added().length).toBe(1);
        });
    });

    it('AND AN ACCOUNT WITH NO EXPORT ACCESS IS REFUSED, AND NOTHING IS WRITTEN', async () => {
        //   THE test. This is what any signed-in account could do.
        setSession(OUTSIDER);
        mockModuleAccess.mockResolvedValue(false);

        const r = await submit();

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/export account/i);
        expect(added()).toEqual([]);
    });

    it('AND THE GATE IS ASKED BEFORE ANYTHING IS WRITTEN', async () => {
        //   Order matters: a check made after the add would leave the row in the
        //   queue and return a refusal, which is the worst of both.
        setSession(OUTSIDER);
        mockModuleAccess.mockResolvedValue(false);

        await submit();

        expect(mockModuleAccess).toHaveBeenCalledTimes(1);
        expect((global as any).mockFirestoreAdd).not.toHaveBeenCalled();
    });

    it('AND IT IS ASKED ABOUT THE SESSION\'S OWN ID AND THE EXPORT MODULE', async () => {
        /*
         *   Not the request's idea of who is listing. #486's sibling finding on
         *   the land door was that it "took ownerId as a parameter — so a
         *   listing could be created in anyone's name".
         */
        setSession(SELLER, ['exporter']);
        mockModuleAccess.mockResolvedValue(true);

        await submit({ userId: 'somebody-else' });

        const [id, roles, app] = mockModuleAccess.mock.calls[0] as any[];
        expect(id).toBe(SELLER);
        expect(roles).toEqual(['exporter']);
        expect(app).toBe('export');
    });

    it('AND THE ROW STILL RECORDS THE SESSION AS THE SUBMITTER', async () => {
        //   The gate must not have replaced the ownership rule that was already
        //   right: `userId` is written after the spread, so a caller cannot
        //   list in somebody else's name.
        setSession(SELLER);
        mockModuleAccess.mockResolvedValue(true);

        await submit({ userId: 'somebody-else' });

        expect(added()[0].userId).toBe(SELLER);
    });

    it('AND A GATED LISTING IS STILL PENDING, NOT APPROVED', async () => {
        /*
         *   The other vacuity guard, and the one a reader should be most
         *   suspicious of: adding a gate is exactly the moment somebody decides
         *   the listing "must be trustworthy now". It is not — an admin still
         *   approves it, and `isActive` is what the public catalogue filters on.
         */
        setSession(SELLER);
        mockModuleAccess.mockResolvedValue(true);

        await submit({ status: 'live', isActive: true });

        expect(added()[0].status).toBe('pending');
        expect(added()[0].isActive).toBe(false);
    });

    it('AND A REFUSED READ OF THE GATE DOES NOT ADMIT THE CALLER', async () => {
        //   Fails CLOSED. A gate that throws must not become a gate that passes
        //   — #277's rule, on the ImageKit account id, in this same audit.
        setSession(OUTSIDER);
        mockModuleAccess.mockImplementation(() => Promise.reject(new Error('db down')));

        const r = await submit();

        expect(r.success).toBe(false);
        expect(added()).toEqual([]);
    });
});

describe('the gate reads the database, not the token', () => {
    it('IT IS checkModuleAccess AND NOT hasAppAccess ALONE', () => {
        /*
         *   hasAppAccess answers from the JWT's roles, which is the #356 class:
         *   a registration revoked ten minutes ago is still in the token for up
         *   to eight hours. checkModuleAccess starts there and falls through to
         *   the database, so a revoked account is refused now.
         *
         *   Asserted as source because the distinction is WHICH function is
         *   called, and the behavioural cases above hold either way.
         */
        const action = code('src/app/actions/export-products.ts');

        expect(action).toContain('checkModuleAccess(');
        expect(action).toContain('"export"');
        //   And the session's id, not a parameter.
        expect(action).toContain('session.user.id');
    });

    it('AND THE SCREEN THE FORM LIVES ON MAKES THE SAME CHECK', () => {
        //   The point of choosing this check rather than a stricter one: the
        //   action admits exactly whom the layout admits.
        const layout = code('src/app/export/(app)/layout.tsx');

        expect(layout).toContain('checkModuleAccess(');
        expect(layout).toContain('"export"');
    });

    it('AND THE ONBOARDING DOOR IS DELIBERATELY NOT GATED', () => {
        /*
         *   The guard against fixing this by gating everything. Asking for
         *   export access cannot require export access, and a sweep that
         *   demanded a module check on every export write would have closed the
         *   only way in.
         */
        const onboarding = code('src/app/actions/export/_ex_onboarding.ts');
        const submitFn = onboarding.slice(onboarding.indexOf('export async function submitExportOnboardingAction'));

        expect(submitFn.slice(0, 2_000)).not.toContain('checkModuleAccess');
    });
});

/*
 *   AND THE TWO UPLOAD PATHS THAT WOULD HAVE FILED SOMEBODY UNDER "anonymous".
 *
 *   Found in the same pass, in the create form that led here. Both built a
 *   storage path as `${session?.user?.id || 'anonymous'}/…`:
 *
 *       export/onboarding/ExportOnboardingClient   export-kyc/…  — an ID
 *                                                  document and a proof of
 *                                                  address
 *       export/(app)/products/create               export-catalog/…
 *
 *   MEASURED BEFORE BEING CALLED A DEFECT, and it is a trap rather than a live
 *   leak: middleware's PROTECTED_PATHS covers /export/onboarding and
 *   /export/products/create, so neither form renders without a session and the
 *   fallback is unreachable today. What makes it worth closing is what it is
 *   waiting for — the folder is shared by every caller that lands in it, so the
 *   day either route is made public, or a session read races, one person's
 *   identity documents are written into a directory another person also writes
 *   into. #277's rule, on the ImageKit account id: a check that cannot be made
 *   fails CLOSED.
 */
describe('nothing is filed under a literal', () => {
    it('NEITHER UPLOAD PATH HAS AN "anonymous" FALLBACK', () => {
        for (const rel of [
            'src/app/export/onboarding/ExportOnboardingClient.tsx',
            'src/app/export/(app)/products/create/page.tsx',
        ]) {
            const src = code(rel);
            expect({ rel, fallback: /session\?\.user\?\.id\s*\|\|\s*['"]anonymous['"]/.test(src) })
                .toEqual({ rel, fallback: false });
            expect({ rel, literal: src.includes("'anonymous'") || src.includes('"anonymous"') })
                .toEqual({ rel, literal: false });
        }
    });

    it('AND EACH REFUSES BEFORE IT UPLOADS', () => {
        //   The vacuity guard: deleting the fallback and letting `undefined`
        //   into the path would satisfy the assertion above and write to
        //   `export-kyc/undefined/`, which is the same shared folder with a
        //   worse name.
        for (const rel of [
            'src/app/export/onboarding/ExportOnboardingClient.tsx',
            'src/app/export/(app)/products/create/page.tsx',
        ]) {
            const src = code(rel);
            expect({ rel, guarded: src.includes('if (!ownerId)') })
                .toEqual({ rel, guarded: true });
            expect({ rel, uses: src.includes('${ownerId}') })
                .toEqual({ rel, uses: true });
        }
    });

    it('AND BOTH ROUTES ARE PROTECTED, which is why this was a trap and not a leak', () => {
        /*
         *   Stated as a measurement rather than asserted in prose. If either of
         *   these ever becomes public the guard above is what stands between a
         *   stranger and a shared folder — and this test will still be here
         *   saying that it used to be unreachable.
         */
        const { isProtectedPath } = require('@/lib/route-manifest');

        expect(isProtectedPath('/export/onboarding')).toBe(true);
        expect(isProtectedPath('/export/products/create')).toBe(true);
    });
});
