/**
 *   #621 A SELLER'S PUBLIC SHOP SAID "NOT FOUND" WHENEVER THE READ FAILED.
 *
 *   /marketplace/sellers/[sellerId] is a server component that reads its seller
 *   over HTTP from the platform's own API. That endpoint is careful about what
 *   it is saying:
 *
 *     400   the id is malformed
 *     404   there is no such seller
 *     500   something broke on our side
 *
 *   The page collapsed all three into `if (!res.ok) return null`, and `null`
 *   meant `notFound()`. A database blip therefore took a trading seller's
 *   storefront off the air with "This page could not be found".
 *
 *   AND THE HTTP STATUS IS THE PART THAT DOES THE LASTING DAMAGE. notFound()
 *   serves a 404, which tells a crawler or a link checker the shop is
 *   PERMANENTLY GONE; a 5xx is understood as "try later". A transient fault
 *   could quietly de-index a seller's shop, and nobody would connect the two.
 *
 * ── #514 SETTLED THIS PRINCIPLE ON THIS PAGE AND DID NOT REACH THIS LINE ────
 *
 *   The page already says, in its own comment: "`products` and `reviews` are
 *   null when the endpoint COULD NOT READ them, and [] / {0,0} when it read
 *   them and there was nothing there… An absence is not a fact. Where it is
 *   unknown this page says so."
 *
 *   That is exactly the rule being broken one level up, in the read of the
 *   seller itself. The inner doors were fixed and the outer one was not — the
 *   shape this audit keeps finding, this time inside a fix for the same class.
 *
 * ── WHY A THROW AND NOT A FRIENDLY PANEL ────────────────────────────────────
 *
 *   marketplace/error.tsx already exists and catches this, and Next serves it
 *   as a 5xx. A panel rendered at HTTP 200 would tell a crawler the page is
 *   fine and that an apology IS the shop's content. Of the three possible
 *   answers — "gone", "here is an apology, indexed as the shop", and "come back
 *   later" — only the last is true.
 *
 *   NOTE ON THE MOCK BELOW, because the first explanation written here was
 *   WRONG and a wrong explanation in a comment outlives the code it describes.
 *   This file could not load the page at all: next-auth/react ships an ESM build
 *   that jest does not transform, reached through SaveItemButton. I recorded
 *   that as an artefact of `@jest-environment node` and removed the directive —
 *   and it failed identically under jsdom. The environment was never the cause;
 *   the sibling sweep only works because it MOCKS the package, which is what
 *   this now does too.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

//   Not under test here, and its real module is an untransformed ESM build —
//   see the note above.
jest.mock('next-auth/react', () => ({
    useSession: () => ({ data: null, status: 'unauthenticated' }),
    SessionProvider: ({ children }: any) => children,
    signIn: jest.fn(),
    signOut: jest.fn(),
}));

const PAGE = 'src/app/marketplace/sellers/[sellerId]/page.tsx';
const API = 'src/app/api/marketplace/sellers/[sellerId]/route.ts';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

/**
 * The page's OWN reader, run against a controlled `fetch`, and the title it
 * produces for each answer.
 *
 * Loaded rather than re-implemented: #612's lesson, where a test wrote its own
 * copy of the function under test and two mutants on the shipped one survived.
 *
 * generateMetadata is the way in, because it is exported and calls the same
 * private reader — so the title IS the reader's verdict, in a form a test can
 * hold. It is named for what it returns, after the first version was annotated
 * with the reader's return type it does not have; the stricter typecheck over
 * src/__tests__ caught that, which `tsc --noEmit` on the app alone did not.
 */
async function metadataFor(fetchImpl: typeof fetch): Promise<{ title: string; description?: string }> {
    const original = global.fetch;
    (global as any).fetch = fetchImpl;
    try {
        jest.resetModules();
        const mod = require('@/app/marketplace/sellers/[sellerId]/page');
        return await mod.generateMetadata({ params: Promise.resolve({ sellerId: 'seller-1' }) });
    } finally {
        (global as any).fetch = original;
    }
}

const jsonResponse = (status: number, body: any) => ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
}) as unknown as Response;

describe('#621 — the endpoint distinguishes three answers, and now so does the page', () => {
    it('THE ENDPOINT REALLY DOES RETURN 404 AND 500 SEPARATELY', () => {
        //   The claim the whole finding rests on. If the API only ever returned
        //   404, conflating them would cost nothing and this file would be
        //   asserting a distinction that does not exist.
        const api = read(API);
        expect(api).toContain('{ status: 404 }');
        expect(api).toContain('{ status: 500 }');
        expect(api).toContain('{ status: 400 }');
    });

    it('404 IS THE ONLY STATUS TREATED AS "THERE IS NO SUCH SELLER"', () => {
        const page = read(PAGE);
        expect(page).toContain('if (res.status === 404) return { status: "not_found" };');
        //   And the blanket refusal that caused this is gone.
        expect(page).not.toContain('if (!res.ok) return null;');
    });

    it('AND AN UNREADABLE SHOP IS THROWN, so Next serves a 5xx and not a 404', () => {
        const page = read(PAGE);
        expect(page).toContain('if (result.status === "unreadable")');
        expect(page).toMatch(/throw new Error\(`Seller storefront could not be read/);

        //   The boundary that catches it exists, or this is a crash rather than
        //   a handled failure.
        expect(() => read('src/app/marketplace/error.tsx')).not.toThrow();
    });

    it('AND notFound() IS STILL CALLED FOR A SELLER THAT REALLY IS GONE', () => {
        //   The fix must not have removed the legitimate 404.
        expect(read(PAGE)).toContain('if (result.status === "not_found") notFound();');
    });
});

describe('#621 — the reader, run against each answer the endpoint can give', () => {
    it('A 500 IS NOT "NOT FOUND"', async () => {
        const meta = await metadataFor(async () => jsonResponse(500, { error: 'Internal server error' }));
        expect(meta.title).toBe('Seller unavailable | Easy Sales Export');
        expect(meta.title).not.toContain('not found');
    });

    it('A REFUSED CONNECTION IS NOT "NOT FOUND" EITHER', async () => {
        //   The least knowable outcome of all, and the one that used to escape
        //   as a raw crash because nothing caught it.
        const meta = await metadataFor(async () => { throw new Error('ECONNREFUSED'); });
        expect(meta.title).toBe('Seller unavailable | Easy Sales Export');
    });

    it('A 400 IS NOT "NOT FOUND" — a malformed id is our fault, not a missing shop', async () => {
        const meta = await metadataFor(async () => jsonResponse(400, { error: 'sellerId is required' }));
        expect(meta.title).toBe('Seller unavailable | Easy Sales Export');
    });

    it('BUT A 404 IS', async () => {
        const meta = await metadataFor(async () => jsonResponse(404, { error: 'Seller not found' }));
        expect(meta.title).toBe('Seller not found | Easy Sales Export');
    });

    it('AND A SELLER THAT READS FINE IS UNAFFECTED', async () => {
        //   Vacuity guard: if the reader could not succeed at all, every
        //   assertion above would pass for the wrong reason.
        const meta = await metadataFor(async () => jsonResponse(200, {
            seller: { businessName: 'Kano Grains Ltd', businessDescription: 'Millet and sorghum' },
            products: [], reviews: { avgRating: 0, reviewCount: 0 },
        }));
        expect(meta.title).toBe('Kano Grains Ltd | Easy Sales Export');
        expect(meta.description).toBe('Millet and sorghum');
    });

    it('AND METADATA NEVER THROWS, whatever the endpoint does', async () => {
        //   A throw here would take down a page that is otherwise able to
        //   render, which would turn a partial failure into a total one.
        for (const impl of [
            async () => jsonResponse(500, {}),
            async () => jsonResponse(404, {}),
            async () => { throw new Error('ECONNREFUSED'); },
        ] as (typeof fetch)[]) {
            await expect(metadataFor(impl)).resolves.toBeDefined();
        }
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored and diffed after each.
 *
 *     MUTANT                                                        RESULT
 *     THE DEFECT ITSELF: every failure is "not found" again          KILLED
 *     a 500 becomes not_found                                        KILLED
 *     a refused connection becomes not_found                         KILLED
 *     a genuine 404 stops being a 404                                KILLED
 *     an unreadable shop renders at 200 instead of throwing          KILLED
 *     metadata throws on an unreadable shop                          KILLED
 *     metadata reports a 500 as not found                            KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                             SURVIVED ✓
 *
 *   The fourth is the one a careless fix would introduce: a page so anxious not
 *   to say "gone" that it stops saying it when the seller really is. The two
 *   metadata mutants matter because that function runs for EVERY request to
 *   this route, including the ones that go on to render perfectly well — a
 *   throw there turns a partial failure into a total one.
 */
