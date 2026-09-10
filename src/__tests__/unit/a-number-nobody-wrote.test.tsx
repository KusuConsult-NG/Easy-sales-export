/**
 * @jest-environment jsdom
 */

/**
 *   #598 THE FIX REACHED ONE OF TWO DOORS, ONE COMMIT LATER — AND A NUMBER
 *        NOBODY WROTE TOOK FOURTEEN MORE SCREENS DOWN.
 *
 *   The bare-row probe again: twenty-one more screens rendered with a document
 *   carrying only an id. TWO threw, and one of them is the interesting one.
 *
 *   /export/(app)/dashboard THREW ON A PARTIAL FIGURES OBJECT, AND #597 HAD
 *   JUST FIXED THAT EXACT FAULT NEXT DOOR. #597 found
 *   /marketplace/seller/analytics blanking because its `setStats` spread a
 *   THREE-key defaults literal over a NINE-key shape. This screen had the same
 *   thing in TWO places at once:
 *
 *       useState<PortfolioStats>(initial?.stats ?? { …four zeroes })
 *       setStats(statsResult.data)
 *
 *   A seed whose `stats` is a partial object REPLACES the zeroes rather than
 *   filling them, and every later read does the same, so
 *   `stats.totalInvested.toLocaleString()` throws during render. #595 had
 *   already been in this file — it guarded the FAILED read and left the partial
 *   one. That is this audit's most-repeated shape, THE FIX REACHED ONE OF N
 *   DOORS, caught here by an instrument rather than by reading.
 *
 *   /land/map threw on `listing.price.toLocaleString()`.
 *
 * ── AND toLocaleString IS A CLASS, FOR THE SAME REASON .replace WAS ─────────
 *
 *   It reads as harmless. It is a method on Number, so a field nobody wrote is
 *   a TypeError during render — the whole page, not the figure. A sweep found
 *   fourteen more sites on stored fields across member-facing screens, most of
 *   them inside a `.map` where one bad row costs the list:
 *
 *     loan.amount               /loans and /loans/approve
 *     row.listing.price         /farm-nation/saved
 *     stats.productsCount       /marketplace  (the PUBLIC landing figures)
 *     stats.tradersCount        /marketplace
 *     item.product.pricePerMT   the export cart and the export buyer catalogue
 *     stats.totalValue          /export/portfolio, and three more there
 *     listing.price             /land and /land/verify
 *     item.amount               /wave/dashboard
 *     tierPreview.maxLoan       /cooperatives/contribute
 *     stats.totalHectares       /farm-nation/dashboard
 *
 * ── WHAT IS NOT CLAIMED ─────────────────────────────────────────────────────
 *
 *   LATENT, AS BEFORE. None is firing on today's data; all were found by
 *   rendering. They are fixed on #589's reasoning: a blank page rather than a
 *   blank field, and the fix costs nothing.
 *
 *   TWO OF THE THREE "CRASHES" IN THE FIRST PROBE RUN WERE MINE, NOT THE
 *   CODE'S, and that is worth recording because both were the harness failing
 *   to be what it stood in for. /farm-nation/checkout hung forever because its
 *   load effect depends on `[…, session, router]` and my `useSession` mock
 *   rebuilt the session object on every render; next-auth returns the same
 *   object from context. /profile/bank-account failed to parse because it pulls
 *   in the Paystack action module, which was not mocked. #595 lost time to the
 *   identical fault with `useRouter`. THE MOCK MUST MATCH THE THING IT REPLACES
 *   — three times now.
 *
 *   THE CONSTANTS ARE NOT GUARDED AND SHOULD NOT BE. `CURRENCY_CONFIG.symbol`
 *   and `COOPERATIVE_CONFIG.registrationFee` are module constants, not
 *   documents; wrapping them would say something false about where the risk is.
 *   The ratchet below tells them apart by the CASE of the root identifier,
 *   which is stated rather than assumed — and it gets one wrong: /academy maps
 *   over `ACADEMY_CONFIG.plans`, so its `plan.fee` is a constant wearing a
 *   lower-case name. That file is excluded BY NAME, with the reason, and the
 *   exclusion is capped at one by a test, rather than the regex being widened
 *   until the number came out right.
 *
 *   THE FLOOR IS SIXTY-THREE SCREENS, not sixty-five: two of the twenty-one
 *   here — /cooperatives/directory and /export/windows/[id] — were already
 *   #589's own subjects, and are re-rendered here rather than counted twice.
 *   What has been PROVEN, never what is safe.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

const ROOT = process.cwd();

jest.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast: jest.fn() }) }));
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
//   STABLE, both of them. Next's useRouter and next-auth's useSession each
//   return the same object across renders, and several of these screens have
//   load effects that depend on one or both. A mock that rebuilds them every
//   render makes those effects re-run forever: /farm-nation/checkout never
//   finished rendering until this was fixed.
const router = { push: jest.fn(), replace: jest.fn(), refresh: jest.fn(), prefetch: jest.fn(), back: jest.fn() };
const session = { data: { user: { id: 'u1', name: 'Ada', email: 'a@b.c', roles: [] } }, status: 'authenticated' };
jest.mock('next/navigation', () => ({
    useRouter: () => router,
    useSearchParams: () => new URLSearchParams(),
    usePathname: () => '/',
    useParams: () => ({ id: 'x', propertyId: 'x', courseId: 'x', certificateId: 'x', moduleId: 'x' }),
}));
jest.mock('next-auth/react', () => ({ useSession: () => session, signOut: jest.fn() }));
jest.mock('@/hooks/useFeatureToggle', () => ({ useFeatureToggle: () => true }));
jest.mock('@/hooks/use-storage', () => ({ useStorage: () => ({ uploadFile: jest.fn(), uploadState: {} }) }));
jest.mock('@/hooks/useMembershipStatus', () => ({ useMembershipStatus: () => ({ status: 'approved', loading: false }) }));

const empty = async () => ({ success: true, error: null, data: null });
//   `@/app/actions/export` is mocked BY NAME rather than through the proxy,
//   because one test below has to change what it answers and a proxy that
//   returns the same plain function for every property cannot be told to.
const getUserExportStatsAction = jest.fn() as jest.Mock<any>;
const getUserExportInvestmentsAction = jest.fn() as jest.Mock<any>;
jest.mock('@/app/actions/export', () => ({
    getUserExportStatsAction: (...a: any[]) => getUserExportStatsAction(...a),
    getUserExportInvestmentsAction: (...a: any[]) => getUserExportInvestmentsAction(...a),
}));
for (const m of ['marketplace', 'cooperative', 'reviews', 'wave', 'my-data', 'village-market', 'health',
    'messages', 'land-listings', 'farm-nation', 'export-products', 'export-booking', 'academy',
    'export-investments', 'export-payment', 'saved-items', 'orders', 'order-management', 'loan-actions',
    'loan-products', 'disputes', 'land-actions', 'profile', 'user', 'wallet', 'course-actions',
    'certificates', 'notifications', 'feature-toggles', 'payments', 'kyc', 'bank-account',
    'farm-nation-payment', 'upload', 'resource-actions', 'export-status', 'paystack']) {
    jest.mock(`@/app/actions/${m}`, () => new Proxy({}, { get: () => empty }));
}

const ROW = { id: 'x' };
const ok = (d: any) => ({ success: true, error: null, data: d });

/**
 * THE FLOOR, RAISED A THIRD TIME. #589 named four, #596 nineteen, #597
 * twenty-two, and these are twenty-one more.
 */
const BARE_ROW_SUBJECTS: [string, string, any][] = [
    ['academy/certificate/[id]', '@/app/academy/certificate/[certificateId]/CertificateClient', { initial: { course: ROW, progress: ROW } }],
    ['academy/verify/[id]', '@/app/academy/verify/[certificateId]/CertificateVerificationClient', { certificateId: 'x', initial: { found: true, certificate: ROW } }],
    ['farm-nation/inquiries/[id]', '@/app/farm-nation/(member)/inquiries/[id]/InquiryDetailsClient', { initial: ROW }],
    ['farm-nation/checkout', '@/app/farm-nation/checkout/[propertyId]/CheckoutClient', { initial: ok({ listing: ROW }) }],
    ['marketplace/seller/products/[id]/edit', '@/app/marketplace/seller/products/[id]/edit/EditProductClient', { initial: ok({ product: ROW }) }],
    ['marketplace/village-market', '@/app/marketplace/village-market/VillageMarketClient', { initial: [ROW] }],
    ['marketplace/village-market/[id]', '@/app/marketplace/village-market/[id]/VillageMarketEventClient', { initial: ok({ event: ROW }) }],
    ['wave/certificates', '@/app/wave/(member)/certificates/WaveCertificatesClient', { initial: [ROW] }],
    ['wave/resources', '@/app/wave/(member)/resources/WaveResourcesClient', { initial: { eligibility: ok({ eligible: true }), resources: ok([ROW]) } }],
    ['wave/profile', '@/app/wave/(member)/profile/WaveProfileClient', { initial: { membership: ok({ enrolled: true, membership: ROW }), stats: ok({ stats: {} }) } }],
    ['profile/bank-account', '@/app/profile/bank-account/BankAccountClient', { initial: ok(ROW) }],
    ['export/landing', '@/app/export/ExportLandingClient', { initial: [ROW] }],
    ['export/windows/[id]', '@/app/export/windows/[id]/ExportWindowDetailClient', { initial: ROW }],
    ['messages', '@/app/messages/MessagesClient', { initial: [ROW] }],
    ['academy/live', '@/app/academy/live/AcademyLiveClient', { initial: ok([ROW]) }],
    ['cooperatives/directory', '@/app/cooperatives/(member)/directory/CooperativeDirectoryClient', { initial: [ROW] }],
    ['cooperatives/id-card', '@/app/cooperatives/(member)/id-card/IdCardClient', { initial: ROW }],
    ['export/(app)/dashboard', '@/app/export/(app)/dashboard/ExportDashboardClient', { initial: { stats: {}, investments: [ROW] } }],
    ['farm-nation/map', '@/app/farm-nation/map/FarmNationMapClient', { initial: [ROW] }],
    ['land/map', '@/app/land/LandMapClient', { initial: [ROW] }],
    ['academy/quiz', '@/app/academy/[courseId]/quiz/[moduleId]/QuizClient', { initial: ok({ course: { id: 'x', modules: [{ id: 'x', quiz: [] }] } }) }],
];

beforeEach(() => {
    jest.clearAllMocks();
    getUserExportStatsAction.mockResolvedValue({ success: true, error: null, data: null });
    getUserExportInvestmentsAction.mockResolvedValue({ success: true, error: null, data: null });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#598 — the floor, raised to sixty-three', () => {
    for (const [name, mod, props] of BARE_ROW_SUBJECTS) {
        it(`${name} RENDERS A ROW THAT CARRIES ONLY AN ID`, async () => {
            const { default: Screen } = await import(mod);
            const { container } = render(<Screen {...props} />);
            expect(container).toBeTruthy();
        });
    }

    it('AND THIS BATCH IS TWENTY-ONE SUBJECTS, NAMED', () => {
        expect(BARE_ROW_SUBJECTS).toHaveLength(21);
        expect(new Set(BARE_ROW_SUBJECTS.map(s => s[0])).size).toBe(21);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#598 — a partial figures object fills the shape, it does not replace it', () => {
    it('THE EXPORT DASHBOARD SURVIVES A SEED WITH THREE OF ITS FOUR FIGURES', async () => {
        /**
         *   THE defect. This is not a failed read and not an empty one — it is
         *   a read that SUCCEEDED and answered with fewer keys than the screen
         *   draws, which is what happens when a figure is added to a screen
         *   before it is added to every row the action aggregates.
         */
        const { default: ExportDashboardClient } =
            await import('@/app/export/(app)/dashboard/ExportDashboardClient');

        const { container } = render(
            <ExportDashboardClient initial={{ stats: { totalInvested: 250_000 }, investments: [] } as any} />
        );

        expect(container.textContent).toContain('250,000');
        //   The three the seed did not carry are zeroes, not a blank page.
        expect(container.textContent).toMatch(/total returns/i);
        expect(container.textContent).not.toMatch(/undefined|NaN/);

        /**
         *   AND THE SHAPE ITSELF IS FILLED, NOT MERELY THE RENDER GUARDED. A
         *   SURVIVING MUTANT IS WHY THIS LINE EXISTS: with the spread reverted,
         *   `numberOrZero` still stopped the crash on the three money figures,
         *   so the test above passed either way. `activeInvestments` is drawn as
         *   a bare `{stats.activeInvestments}` — no formatter, no guard — so it
         *   renders "0" when the shape was filled and NOTHING when it was
         *   replaced. That is the difference the fix is actually about.
         */
        const counts = Array.from(container.querySelectorAll('div'))
            .map(d => d.textContent?.trim())
            .filter(t => t === '0');
        expect(counts.length).toBeGreaterThan(0);
    });

    it('AND SO DOES A LATER READ THAT ANSWERS WITH FEWER KEYS', async () => {
        /**
         *   The other half, and the other surviving mutant. The seed is only
         *   the FIRST answer; `setStats(statsResult.data)` had the identical
         *   fault on every read after it, and no test drove that path.
         */
        getUserExportStatsAction.mockResolvedValue({ success: true, error: null, data: { totalInvested: 7_000 } });
        getUserExportInvestmentsAction.mockResolvedValue({ success: true, error: null, data: [] });

        const { default: ExportDashboardClient } =
            await import('@/app/export/(app)/dashboard/ExportDashboardClient');
        const { container } = render(<ExportDashboardClient initial={null} />);

        await waitFor(() => expect(container.textContent).toContain('7,000'));
        expect(container.textContent).not.toMatch(/undefined|NaN/);
        //   The keys the answer did not carry are zeroes on screen.
        expect(container.textContent).toMatch(/total returns/i);
        const zeroes = Array.from(container.querySelectorAll('div'))
            .map(d => d.textContent?.trim()).filter(t => t === '0');
        expect(zeroes.length).toBeGreaterThan(0);
    });

    it('AND AN INVESTMENT ROW WITH NO AMOUNT DOES NOT TAKE THE LIST DOWN', async () => {
        const { default: ExportDashboardClient } =
            await import('@/app/export/(app)/dashboard/ExportDashboardClient');

        const { container } = render(
            <ExportDashboardClient
                initial={{ stats: {}, investments: [{ id: 'i1', commodity: 'Cocoa' }, { id: 'i2', commodity: 'Sesame', amount: 90_000 }] } as any}
            />
        );

        //   Both rows, not neither.
        expect(container.textContent).toContain('Cocoa');
        expect(container.textContent).toContain('Sesame');
        expect(container.textContent).toContain('90,000');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#598 — and no member-facing screen calls toLocaleString on a stored field', () => {
    /**
     * A dotted path with `.toLocaleString()` on the end, where the ROOT
     * identifier is not a module constant.
     *
     * SCREAMING_SNAKE is the rule for telling them apart, and it is a rule this
     * codebase already follows: CURRENCY_CONFIG, COOPERATIVE_CONFIG and
     * ACADEMY_CONFIG are constants and are safe; `loan.amount` and
     * `listing.price` came off a document. Stating the rule is the point —
     * an exclusion nobody can explain is how a ratchet becomes decoration.
     */
    /**
     * One file, named, with its reason — not a silent regex widening.
     *
     * /academy maps over `ACADEMY_CONFIG.plans`, so its `plan.fee` and
     * `plan.originalFee` ARE module constants; the rule below sees only the
     * loop variable `plan` and cannot know that. Guarding them would say
     * something false about where the risk is, so the file is excluded by name
     * and the exclusion is capped at one by a test.
     */
    const CONSTANTS_UNDER_A_LOWERCASE_NAME = ['src/app/academy/page.tsx'];

    function unguardedLocaleStrings(src: string): string[] {
        //   COMMENTS STRIPPED FIRST. Two of this file's own comments quote the
        //   defect, and the first version of this scan reported them as
        //   offenders — the audit's own recurring trap.
        const code = stripComments(src, { label: 'the screen' });
        const re = /([A-Za-z_$][\w$]*)((?:\??\.[A-Za-z_$][\w$]*)+)\.toLocaleString\(\)/g;
        const hits: string[] = [];
        let m: RegExpExecArray | null;
        while ((m = re.exec(code))) {
            if (/^[A-Z0-9_]+$/.test(m[1])) continue;    // a module constant
            if (m[0].includes('?.')) continue;          // guarded
            hits.push(m[0]);
        }
        return hits;
    }

    let lastSeen = 0;
    function scan(): { file: string; hits: string[] }[] {
        const found: { file: string; hits: string[] }[] = [];
        let seen = 0;
        const walk = (dir: string) => {
            for (const entry of readdirSync(dir)) {
                const full = join(dir, entry);
                if (statSync(full).isDirectory()) {
                    if (entry !== 'admin') walk(full);
                } else if (entry.endsWith('.tsx')) {
                    seen += 1;
                    const rel = full.slice(ROOT.length + 1);
                    if (CONSTANTS_UNDER_A_LOWERCASE_NAME.includes(rel)) continue;
                    const hits = unguardedLocaleStrings(readFileSync(full, 'utf-8'));
                    if (hits.length) found.push({ file: rel, hits });
                }
            }
        };
        walk(join(ROOT, 'src/app'));
        lastSeen = seen;
        return found;
    }

    it('THE COUNT IS ZERO, EXACTLY', () => {
        expect(scan()).toEqual([]);
    });

    it('AND THE SCAN CAN STILL FIND ONE — the guard that zero needs', () => {
        scan();
        expect(lastSeen).toBeGreaterThan(100);
        expect(unguardedLocaleStrings('<p>{loan.amount.toLocaleString()}</p>;')).toHaveLength(1);
        expect(unguardedLocaleStrings('<p>{row.listing.price.toLocaleString()}</p>;')).toHaveLength(1);
        //   And the three shapes it must NOT claim.
        //   The wrapped form is excused by the SHAPE of the pattern, not by a
        //   separate exclusion. The first draft had one — `if (before matches
        //   numberOrZero() continue` — and a mutant that deleted it changed
        //   nothing, because the regex requires an IDENTIFIER before
        //   `.toLocaleString()` and `numberOrZero(x)` ends in a bracket. A
        //   check that cannot fail is exactly what this audit keeps finding, so
        //   it was removed rather than left in looking useful.
        expect(unguardedLocaleStrings('<p>{numberOrZero(loan.amount).toLocaleString()}</p>;')).toHaveLength(0);
        expect(unguardedLocaleStrings('<p>{Number(loan.amount).toLocaleString()}</p>;')).toHaveLength(0);
        expect(unguardedLocaleStrings('<p>{loan.amount?.toLocaleString()}</p>;')).toHaveLength(0);
        expect(unguardedLocaleStrings('<p>{COOPERATIVE_CONFIG.registrationFee.toLocaleString()}</p>;')).toHaveLength(0);
    });

    it('AND THE ONE EXCLUSION IS ONE, NAMED, AND STILL THERE', () => {
        //   An exclusions list that grows quietly turns a ratchet into
        //   decoration, so its length is asserted and each file must exist.
        expect(CONSTANTS_UNDER_A_LOWERCASE_NAME).toHaveLength(1);
        for (const f of CONSTANTS_UNDER_A_LOWERCASE_NAME) {
            expect({ f, exists: statSync(join(ROOT, f)).isFile() }).toEqual({ f, exists: true });
        }
    });

    it('AND A COMMENT QUOTING THE DEFECT IS NOT THE DEFECT', () => {
        //   The trap this audit keeps falling into, guarded explicitly.
        expect(unguardedLocaleStrings(
            'const a = 1;\n// once this said window.fundedAmount.toLocaleString() and threw\nconst b = 2;'
        )).toHaveLength(0);
    });
});

/**
 * ── THE MUTATION TABLE ──────────────────────────────────────────────────────
 *
 *   Against a green baseline, one anchored swap at a time, each restored and
 *   verified with `diff -q` before the next:
 *
 *     export dashboard: the seed replaces the shape again  KILLED  ← see below
 *     export dashboard: the later read replaces the shape  KILLED  ← see below
 *     export dashboard: an investment amount unguarded     KILLED (3 tests)
 *     land map: the location guard removed                 KILLED
 *     land map: the price unguarded again                  KILLED (2)
 *     loans: the amount unguarded again                    KILLED
 *     marketplace landing: the public figures unguarded    KILLED
 *     ratchet: comments no longer stripped                 KILLED (2)
 *     ratchet: the constant rule dropped                   KILLED (2)
 *     ratchet: the scan pointed at another directory       KILLED
 *     ratchet: a second exclusion smuggled in              KILLED
 *     ratchet: a subject dropped from this batch           KILLED (2)
 *     ledger: a name added to #589's PROVEN without a
 *             render being added here                      KILLED (2)
 *     reword this header                                   SURVIVED, as intended
 *
 *   THREE SURVIVED THE FIRST RUN, AND THE THIRD WAS THE INTERESTING ONE.
 *
 *   The two export-dashboard mutants survived because `numberOrZero` stopped
 *   the crash on the three MONEY figures whether the shape was filled or
 *   replaced, so the test passed either way. `activeInvestments` is drawn as a
 *   bare `{stats.activeInvestments}` — no formatter, no guard — and renders "0"
 *   when the shape was filled and NOTHING when it was replaced. That is what
 *   the assertions check now, and there is a second test for the LOADER path,
 *   which no test had driven at all.
 *
 *   THE THIRD WAS A CHECK THAT COULD NOT FAIL, IN THIS FILE'S OWN RATCHET.
 *   Deleting the `if (before matches numberOrZero() continue` exclusion changed
 *   nothing, because the pattern requires an IDENTIFIER before
 *   `.toLocaleString()` and `numberOrZero(x)` ends in a bracket — the exclusion
 *   had never once fired. It was DELETED rather than left in looking useful,
 *   which is the whole finding of #588's own cap and #331's forensic checks
 *   turned on this file.
 */
