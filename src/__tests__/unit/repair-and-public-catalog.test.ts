/**
 * @jest-environment node
 */

/**
 * A repair that guessed a protected attribute, and a public endpoint that
 * published whatever was stored.
 *
 * 1. GENDER GUESSED FROM A NAME, DEFAULTING TO THE ANSWER THAT EXCLUDES
 * ---------------------------------------------------------------------
 * repairOrphanedUser rebuilds a Firestore profile for a user who exists in Auth
 * and lost theirs. It wrote:
 *
 *     const gender = inferGenderFromName(fullName);
 *
 * and that function was twelve hard-coded first names, five suffixes
 * ("-a", "-e", "-ie", "-lyn", "-elle"), and:
 *
 *     // Default to male if uncertain (user can update in profile)
 *     return 'male';
 *
 * /api/wave/check-eligibility then reads exactly that field:
 *
 *     const isMale = gender?.toLowerCase() === "male";
 *     const isWaveBlocked = isMale && (isNewMaleUser || (!hasWaveRole && !hasWaveReg));
 *
 * WAVE is a women's programme. So an automated repair inferred a protected
 * attribute from a name, defaulted to the value that excludes, and locked the
 * user out — with nothing on any screen to say a guess had been made. Against
 * the platform's actual user base the heuristic is close to a weighted coin
 * toss.
 *
 * It is left unset now. An unset gender reads as null in the eligibility check,
 * isMale is false, and the repaired user is in the position of anyone else who
 * has not filled it in — which is the truth about what is known. The function
 * is deleted rather than left unused, because an available gender-from-name
 * helper is an invitation to the next person who needs a gender and has not
 * got one.
 *
 * The same profile also set `verified: true, // Auto-verify`.
 *
 * I nearly left that alone. My first look for readers of `verified` on a user
 * document found only reviews, land verifications and listings — other
 * collections — so it looked like a dead field, and this audit has three times
 * nearly broken something correct by acting on an unchecked premise. Writing
 * the assertion is what found the rest:
 *
 *     // 7. Unify Verification Fields
 *     if (userData.verified === true && userData.isVerified !== true) {
 *         updates.isVerified = true;          data-recovery.ts:168
 *
 * isVerified is the real flag, read in 88 places — the KYC surface, admin
 * member views, the "Verified" column of the user CSV export. So the repair
 * granted identity-verified status on the next data-recovery run. It is false
 * now: a user who really was verified re-verifies, which is a nuisance, and the
 * other direction hands unverified accounts a status the platform sells trust
 * on.
 *
 * 2. A PUBLIC CATALOGUE THAT PUBLISHED THE DOCUMENT
 * -------------------------------------------------
 * /api/export/catalog has no authentication, correctly — it is a public product
 * list. It returned:
 *
 *     { id: doc.id, ...doc.data() }
 *
 * Every listing carries `userId`, the internal id of the seller who submitted
 * it, so the public catalogue published one per listing. And submitExportProduct
 * stores its input wholesale — its own comment says "productData arrives as
 * `any` and is stored wholesale — no schema, no checks" — so any field a seller
 * chose to include went public the moment an admin set isActive.
 *
 * An allow-list, not a deny-list: a field added later is private by default,
 * which is the way round that survives somebody else's change.
 */

import { describe, it, expect } from '@jest/globals';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';

function source(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8');
}

function codeOnly(src: string): string {
    return src
        .split('\n')
        .filter((l) => {
            const t = l.trim();
            return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
        })
        .join('\n');
}

const repair = source('src/lib/orphaned-user-repair.ts');
/**
 * #578 MOVED THE BODY OF THIS HANDLER INTO A READER the server page shares, so
 * the claims below are made where the rule now lives. The route is still read,
 * to assert that it did not keep a second copy.
 */
const catalog = source('src/lib/export-catalog-reader.ts');
const catalogRoute = source('src/app/api/export/catalog/route.ts');

describe('the repair does not guess a protected attribute', () => {
    it('writes no gender at all', () => {
        // THE test.
        const code = codeOnly(repair);

        expect(code).not.toContain('inferGenderFromName');
        expect(code).not.toMatch(/^\s*gender,\s*$/m);
    });

    it('the heuristic is gone from the codebase', () => {
        const hits = execSync(`grep -rn 'inferGenderFromName' src --include='*.ts' --include='*.tsx' || true`, {
            encoding: 'utf-8',
            cwd: process.cwd(),
        }).split('\n').filter(Boolean).filter((l) => !l.includes('__tests__'));

        // Only the note explaining the removal, which is a comment.
        for (const line of hits) {
            const body = line.slice(line.indexOf(':', line.indexOf(':') + 1) + 1).trim();
            expect(body.startsWith('*') || body.startsWith('//') || body.startsWith('/*')).toBe(true);
        }
    });

    it('still rebuilds the profile it exists to rebuild', () => {
        // Vacuity guard: removing the write entirely would leave the orphaned
        // user with no profile, which is the thing being repaired.
        expect(repair).toContain("roles: ['general_user']");
        expect(repair).toContain('fullName,');
        expect(repair).toContain('email,');
        expect(repair).toContain('COLLECTIONS.USERS).doc(uid).set(');
    });

    it('an unset gender does not block WAVE', () => {
        // Why leaving it unset is safe rather than merely honest: the eligibility
        // rule tests for "male", so an absent gender is not male.
        //
        // This used to pin the literal `const isMale = gender?.toLowerCase() ===
        // "male"` inside the route. The route carried a line-for-line copy of the
        // rule and now calls the shared one, so the claim is asserted where it
        // actually lives — and as behaviour, which is stronger than matching the
        // text that implements it.
        const { checkWaveEligibility } = require('@/lib/wave-eligibility');

        expect(checkWaveEligibility({ roles: [] }).eligible).toBe(true);
        expect(checkWaveEligibility({ gender: null, roles: [] }).eligible).toBe(true);
        expect(checkWaveEligibility({ gender: '', roles: [] }).eligible).toBe(true);
        // Not vacuous: a recorded male IS blocked, so "absent is fine" is a
        // statement about absence and not about the rule doing nothing.
        expect(checkWaveEligibility({ gender: 'male', roles: [] }).eligible).toBe(false);

        const eligibility = source('src/app/api/wave/check-eligibility/route.ts');
        expect(eligibility).toContain('checkWaveEligibility(userData)');
    });

    it('records that WAVE eligibility is what read the guess', () => {
        // The link between the two files is the whole finding, and neither
        // mentions the other in code.
        expect(repair).toContain('check-eligibility');
    });
});

describe('the public catalogue publishes named fields only', () => {
    /**
     * ASSERTED AGAINST THE READER RUNNING, not against its text — #581.
     *
     * The allow-list used to be a `PUBLIC_CATALOG_FIELDS` array and these
     * checks matched on its name. It is an explicit shape now, because copying
     * a field only when it was defined published rows with no `grades` array
     * and the buyer page rendered `product.grades[0]` — a TypeError that took
     * the whole catalogue down. Running it is the stronger claim either way.
     */
    async function published(stored: Record<string, unknown>) {
        (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve({
            empty: false,
            docs: [{ id: 'listing-1', data: () => stored }],
        }));
        const { readPublicExportCatalog } = await import('@/lib/export-catalog-reader');
        const [product] = await readPublicExportCatalog();
        return product as unknown as Record<string, unknown>;
    }

    const STORED = {
        name: 'Cashew Nuts', icon: '\u{1F95C}', origin: 'Oyo', season: 'Feb - May',
        category: 'nuts', grades: ['W320'], certifications: ['NAFDAC'],
        pricePerMT: 2850, minOrderMT: 20,
        // What must never leave the building.
        userId: 'seller-77', status: 'live', createdAt: 'yesterday',
        internalMargin: 0.42, supplierPhone: '08030000000',
    };

    it('does not spread the stored document', async () => {
        // THE test.
        expect(codeOnly(catalog)).not.toContain('...data');
        expect(codeOnly(catalog)).not.toContain('...doc.data()');

        const product = await published(STORED);

        expect(Object.keys(product).sort()).toEqual([
            'category', 'certifications', 'grades', 'icon', 'id',
            'minOrderMT', 'name', 'origin', 'pricePerMT', 'season',
        ]);
    });

    it("does not publish the seller's user id", async () => {
        const product = await published(STORED);

        for (const secret of ['userId', 'status', 'createdAt', 'internalMargin', 'supplierPhone']) {
            expect({ secret, published: secret in product }).toEqual({ secret, published: false });
        }
    });

    it('publishes everything the buyer page reads', async () => {
        // Vacuity guard: publishing nothing satisfies every assertion above and
        // empties the catalogue.
        const product = await published(STORED);

        expect(product).toMatchObject({
            name: 'Cashew Nuts', origin: 'Oyo', season: 'Feb - May', category: 'nuts',
            grades: ['W320'], certifications: ['NAFDAC'], pricePerMT: 2850, minOrderMT: 20,
        });
    });

    it('the id is still returned, since the cart keys on it', async () => {
        expect((await published(STORED)).id).toBe('listing-1');
    });

    it('still serves only approved listings', () => {
        // The check that was already right, pinned so the field work above
        // cannot displace it. isActive is set by an admin on approval.
        expect(catalog).toContain('.where("isActive", "==", true)');
        // And the route did not keep a second copy of the query.
        expect(codeOnly(catalogRoute)).not.toContain('COLLECTIONS.EXPORT_CATALOG');
        expect(codeOnly(catalogRoute)).toContain('readPublicExportCatalog()');
    });

    it('the allow-list matches what ExportProduct declares', async () => {
        // If the type gains a field the buyer page renders, this fails and
        // whoever added it is told where to add it.
        const ctx = source('src/contexts/ExportCartContext.tsx');
        const iface = ctx.slice(ctx.indexOf('export interface ExportProduct'), ctx.indexOf('export interface ExportCartItem'));
        const declared = [...iface.matchAll(/^\s{4}(\w+)[?]?:/gm)].map((m) => m[1]).filter((f) => f !== 'id');

        const product = await published(STORED);

        expect(declared.length).toBeGreaterThan(5);
        for (const field of declared) {
            expect({ field, published: field in product }).toEqual({ field, published: true });
        }
    });
});
