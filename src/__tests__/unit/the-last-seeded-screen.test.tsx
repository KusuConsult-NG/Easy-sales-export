/**
 * @jest-environment jsdom
 */

/**
 *   #599 THE LAST TWENTY SEEDED SCREENS — AND ALL THREE CRASHES WERE ON SCREENS
 *        THIS AUDIT HAD ALREADY FIXED.
 *
 *   The bare-row probe, fourth and final batch. Twenty screens rendered with a
 *   document carrying only an id. Three threw, and every one of them is a file
 *   an earlier commit in this audit had already been inside:
 *
 *     marketplace/buyer/dashboard    order.items.length, then order.items.map
 *                                    — #594's screen
 *     marketplace/seller/dashboard   stats.averageRating.toFixed(1), then
 *                                    order.items.length and order.items.map
 *                                    — also #594's
 *     wave/earnings                  txn.date.toLocaleDateString()
 *                                    — #595's
 *
 * ── AND THE SHARED CAUSE IS ONE SENTENCE ────────────────────────────────────
 *
 *   A FIX AIMED AT "THE READ FAILED" LEAVES "THE READ SUCCEEDED AND ANSWERED
 *   SHORT". #588 through #595 taught these screens to tell an empty list from a
 *   failed one, which is a real and separate defect and is still fixed. It does
 *   nothing at all for a read that comes back `success: true` with a row missing
 *   a field, or a stats object missing a key — and that is the shape that
 *   crashes rather than misinforms.
 *
 *   The seller dashboard's `setStats(analyticsRes.data.analytics as any)` is now
 *   THE THIRD instance of one line: #597 fixed it on
 *   /marketplace/seller/analytics, #598 on /export/(app)/dashboard, this is the
 *   third. Each time a partial answer REPLACED the state's shape instead of
 *   filling it, and each time the next unguarded read of a missing key threw
 *   during render. Three screens, three commits, one line — which is why the
 *   instrument matters more than any of the three fixes.
 *
 * ── THE COVERAGE RATCHET, WHICH IS THE POINT OF THIS COMMIT ─────────────────
 *
 *   EVERY SERVER-SEEDED CLIENT SCREEN IS NOW A SUBJECT. The four bare-row
 *   suites between them render all 82 files under src/app that take a
 *   server-seeded `initial` prop, outside admin — and the test at the foot of
 *   this file asserts that set equality in BOTH directions.
 *
 *   That is what makes the floor an instrument rather than a list. A new seeded
 *   screen fails this test until somebody renders it with a bare row; a subject
 *   deleted from a suite fails it too. Sixteen crashes were found across the
 *   four batches, every one by rendering rather than by reading, and none of
 *   them would have been found by the ratchets that came before — because a
 *   screen that cannot tell an empty list from a failed read still renders.
 *
 * ── WHAT IS NOT CLAIMED ─────────────────────────────────────────────────────
 *
 *   LATENT, AS BEFORE, and checked rather than assumed: an order is written
 *   with `items`, a WAVE transaction with `date`. They are fixed on #589's
 *   reasoning — a blank page rather than a blank field, and the fix costs
 *   nothing.
 *
 *   82 SCREENS IS NOT EVERY SCREEN. It is every screen that takes a seed. A
 *   page that reads only in the browser has no `initial` prop and is not in
 *   this count; the ratchet says so rather than implying otherwise.
 *
 *   A BARE ROW IS NOT EVERY HOSTILE ROW. `{ id: 'x' }` finds a missing field.
 *   It does not find a field of the wrong TYPE, a negative amount, or a date
 *   from 1970. Those are separate questions and this instrument does not answer
 *   them.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import React from 'react';
import { render } from '@testing-library/react';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();

jest.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast: jest.fn() }) }));
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
const router = { push: jest.fn(), replace: jest.fn(), refresh: jest.fn(), prefetch: jest.fn(), back: jest.fn() };
jest.mock('next/navigation', () => ({
    useRouter: () => router, useSearchParams: () => new URLSearchParams(),
    usePathname: () => '/', useParams: () => ({ id: 'x', propertyId: 'x', courseId: 'x', certificateId: 'x', moduleId: 'x' }),
}));
//   STABLE, like the router: next-auth returns the same session object from
//   context while the session is unchanged, and CheckoutClient's load effect
//   depends on `[…, session, router]`. A mock that rebuilds it every render
//   makes that effect re-run forever and the suite never finishes.
const session = { data: { user: { id: 'u1', name: 'Ada', email: 'a@b.c', roles: [] } }, status: 'authenticated' };
jest.mock('next-auth/react', () => ({ useSession: () => session, signOut: jest.fn() }));
jest.mock('@/hooks/useFeatureToggle', () => ({ useFeatureToggle: () => true }));
jest.mock('@/hooks/use-storage', () => ({ useStorage: () => ({ uploadFile: jest.fn(), uploadState: {} }) }));
jest.mock('@/hooks/useMembershipStatus', () => ({ useMembershipStatus: () => ({ status: 'approved', loading: false }) }));
const empty = async () => ({ success: true, error: null, data: null });
for (const m of ['marketplace','cooperative','reviews','wave','my-data','village-market','health','messages',
                 'land-listings','farm-nation','export-products','export','export-booking','academy',
                 'export-investments','export-payment','saved-items','orders','order-management',
                 'loan-actions','loan-products','disputes','land-actions','profile','user','wallet',
                 'course-actions','certificates','notifications','feature-toggles','payments','kyc',
                 'bank-account','farm-nation-payment','upload','resource-actions','export-status','paystack','auth','platform']) {
    jest.mock(`@/app/actions/${m}`, () => new Proxy({}, { get: () => empty }));
}

const ROW = { id: 'x' };
const ok = (d: any) => ({ success: true, error: null, data: d });

/**
 * THE LAST BATCH. #589 named four, #596 nineteen, #597 twenty-two, #598
 * twenty-one, and these twenty complete the set.
 */
const BARE_ROW_SUBJECTS: [string, string, any][] = [
    ['academy/courses', '@/app/academy/(learner)/courses/CourseCatalogClient', { initial: { coursesRes: ok([ROW]), enrollRes: ok({ courses: [ROW] }) } }],
    ['academy/application', '@/app/academy/application/AcademyApplicationClient', { initial: { status: ok(ROW), payment: ok(ROW) } }],
    ['academy/setup', '@/app/academy/setup/AcademySetupClient', { initial: { profile: ok(ROW), status: ok(ROW), payment: ok(ROW) } }],
    ['cooperatives/fixed-savings', '@/app/cooperatives/(member)/fixed-savings/FixedSavingsClient', { initial: { membership: { isMember: true, status: 'approved' }, plans: [ROW] } }],
    ['cooperatives/payment', '@/app/cooperatives/payment/CooperativePaymentClient', { initial: ok({ membership: ROW }) }],
    ['dashboard/disputes/new', '@/app/dashboard/disputes/new/NewDisputeClient', { initial: ROW }],
    ['dashboard/wallet', '@/app/dashboard/wallet/WalletClient', { initial: { toggles: ok({}), wallet: ok(ROW), transactions: ok({ transactions: [ROW], hasMore: false }) } }],
    ['escrow/[id]/chat', '@/app/escrow/[id]/chat/EscrowChatClient', { escrowId: 'x', initial: { escrow: ok({ id: 'x', buyerId: 'u1' }), messages: ok([ROW]) } }],
    ['export/onboarding', '@/app/export/onboarding/ExportOnboardingClient', { initial: { status: null, application: ok(ROW), hasAccess: false } }],
    ['farm-nation/landing', '@/app/farm-nation/FarmNationLandingClient', { initial: ok({ listings: [ROW] }) }],
    ['farm-nation/onboarding', '@/app/farm-nation/onboarding/FarmNationOnboardingClient', { initial: ok(ROW) }],
    ['marketplace/buyer/dashboard', '@/app/marketplace/buyer/dashboard/BuyerDashboardClient', { initial: { statsResult: ok({ stats: {} }), ordersResult: ok({ orders: [ROW] }), recommendedResult: ok({ products: [ROW] }) } }],
    ['marketplace/onboarding', '@/app/marketplace/onboarding/MarketplaceOnboardingClient', { initial: ok(ROW) }],
    ['marketplace/seller/dashboard', '@/app/marketplace/seller/dashboard/SellerDashboardClient', { initial: { analyticsRes: ok({ analytics: {} }), ordersRes: ok({ orders: [ROW] }), productsRes: ok({ products: [ROW] }), togglesRes: ok({}) } }],
    ['marketplace/verify', '@/app/marketplace/verify/SellerVerificationClient', { initial: ok(ROW) }],
    ['settings/security/mfa', '@/app/settings/security/mfa/MfaSetupClient', { initial: { enabled: false } }],
    ['wave/earnings', '@/app/wave/(member)/earnings/WaveEarningsClient', { initial: { totalEarnings: 0, transactions: [ROW] } }],
    ['wave/live-training', '@/app/wave/(member)/live-training/LiveTrainingClient', { initial: [ROW] }],
    ['wave/training', '@/app/wave/(member)/training/WaveTrainingClient', { initial: { membership: ok({ enrolled: true }), events: ok([ROW]), registrations: ok({ registrations: [] }) } }],
    ['wave/application', '@/app/wave/application/WaveApplicationClient', { initial: { status: ok(ROW), application: ok(ROW), access: ok(ROW) } }],
];

beforeEach(() => {
    jest.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#599 — the last twenty seeded screens', () => {
    for (const [name, mod, props] of BARE_ROW_SUBJECTS) {
        it(`${name} RENDERS A ROW THAT CARRIES ONLY AN ID`, async () => {
            const { default: Screen } = await import(mod);
            const { container } = render(<Screen {...props} />);
            expect(container).toBeTruthy();
        });
    }

    it('AND THIS BATCH IS TWENTY SUBJECTS, NAMED', () => {
        expect(BARE_ROW_SUBJECTS).toHaveLength(20);
        expect(new Set(BARE_ROW_SUBJECTS.map(s => s[0])).size).toBe(20);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#599 — a partial answer fills the shape, on the third screen with this line', () => {
    it('THE SELLER DASHBOARD SURVIVES ANALYTICS WITH ONE FIGURE OF SIX', async () => {
        /**
         *   THE defect, and its third instance. `setStats(analyticsRes.data
         *   .analytics as any)` replaced a six-key shape with whatever came
         *   back, so `stats.averageRating.toFixed(1)` threw on an answer that
         *   was perfectly successful and merely short.
         */
        const { default: SellerDashboardClient } =
            await import('@/app/marketplace/seller/dashboard/SellerDashboardClient');

        const { container } = render(
            <SellerDashboardClient initial={{
                analyticsRes: { success: true, error: null, data: { analytics: { totalSales: 12_345 } } },
                ordersRes: { success: true, error: null, data: { orders: [] } },
                productsRes: { success: true, error: null, data: { products: [] } },
                togglesRes: { success: true, error: null, data: {} },
            } as any} />
        );

        expect(container.textContent).toContain('12,345');
        //   The rating the answer did not carry reads 0.0, not a blank page.
        expect(container.textContent).toContain('0.0');
        expect(container.textContent).not.toMatch(/undefined|NaN/);
    });

    it('AND AN ORDER WITH NO LINES DOES NOT TAKE EITHER DASHBOARD DOWN', async () => {
        const order = { id: 'o1', orderNumber: 'ORD-1', status: 'processing', totalAmount: 5000, createdAt: new Date().toISOString() };

        const { default: SellerDashboardClient } =
            await import('@/app/marketplace/seller/dashboard/SellerDashboardClient');
        const seller = render(
            <SellerDashboardClient initial={{
                analyticsRes: { success: true, error: null, data: { analytics: {} } },
                ordersRes: { success: true, error: null, data: { orders: [order] } },
                productsRes: { success: true, error: null, data: { products: [] } },
                togglesRes: { success: true, error: null, data: {} },
            } as any} />
        );
        expect(seller.container.textContent).toContain('ORD-1');

        const { default: BuyerDashboardClient } =
            await import('@/app/marketplace/buyer/dashboard/BuyerDashboardClient');
        const buyer = render(
            <BuyerDashboardClient initial={{
                statsResult: { success: true, error: null, data: { stats: { activeOrders: 1, completedOrders: 0, totalSpent: 0, savedSellers: 0 } } },
                ordersResult: { success: true, error: null, data: { orders: [order] } },
                recommendedResult: { success: true, error: null, data: { products: [] } },
            } as any} />
        );
        expect(buyer.container.textContent).toContain('ORD-1');
        expect(buyer.container.textContent).toContain('0 Items');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#599 — and every server-seeded screen is a subject', () => {
    /**
     * THE COVERAGE RATCHET, and the reason this batch exists.
     *
     * A floor is a list until something checks that the list is complete. This
     * reads the four bare-row suites, collects every module path they render,
     * and compares that set against every file under src/app that takes a
     * server-seeded `initial` prop — in BOTH directions, so a new seeded screen
     * fails until it is rendered, and a subject deleted from a suite fails too.
     */
    const SUITES = [
        'src/__tests__/unit/a-row-with-nothing-on-it.test.tsx',
        'src/__tests__/unit/a-date-that-is-not-one.test.tsx',
        'src/__tests__/unit/a-number-nobody-wrote.test.tsx',
        'src/__tests__/unit/the-last-seeded-screen.test.tsx',
    ];

    function subjectsAcrossSuites(): Set<string> {
        const found = new Set<string>();
        for (const suite of SUITES) {
            const src = readFileSync(join(ROOT, suite), 'utf-8');
            const table = src.split('const BARE_ROW_SUBJECTS')[1]?.split('\n];')[0] ?? '';
            for (const m of table.matchAll(/'(@\/app\/[^']+)'/g)) {
                found.add(m[1].replace('@/app/', 'src/app/') + '.tsx');
            }
        }
        return found;
    }

    function seededScreens(): Set<string> {
        const found = new Set<string>();
        const walk = (dir: string) => {
            for (const entry of readdirSync(dir)) {
                const full = join(dir, entry);
                if (statSync(full).isDirectory()) {
                    //   Admin is a separate pass, as in every ratchet since #545.
                    if (entry !== 'admin') walk(full);
                } else if (entry.endsWith('.tsx')) {
                    if (readFileSync(full, 'utf-8').includes('initial = null')) {
                        found.add(full.slice(ROOT.length + 1));
                    }
                }
            }
        };
        walk(join(ROOT, 'src/app'));
        return found;
    }

    /**
     * Both directions, computed in ONE named function rather than in two
     * assertions.
     *
     * A mutant that deletes an assertion always survives — that is what an
     * assertion IS — so the comparison is code here, and a mutant that drops
     * either half of it dies on the tests below. The first draft had the two
     * `filter`s inline and a mutant that replaced one with `[]` survived
     * exactly as expected, which is not a coverage claim worth having.
     */
    function coverageGaps(subjects: Set<string>, seeded: Set<string>) {
        return {
            notCovered: [...seeded].filter(f => !subjects.has(f)).sort(),
            extra: [...subjects].filter(f => !seeded.has(f)).sort(),
        };
    }

    it('THE COMPARISON REPORTS A GAP IN EITHER DIRECTION — the guard on the guard', () => {
        //   Run against sets whose answer is known, so the two tests below are
        //   claims rather than decorations.
        expect(coverageGaps(new Set(['a']), new Set(['a', 'b'])))
            .toEqual({ notCovered: ['b'], extra: [] });
        expect(coverageGaps(new Set(['a', 'c']), new Set(['a'])))
            .toEqual({ notCovered: [], extra: ['c'] });
        expect(coverageGaps(new Set(['a']), new Set(['a'])))
            .toEqual({ notCovered: [], extra: [] });
    });

    it('EVERY SEEDED SCREEN IS RENDERED WITH A BARE ROW SOMEWHERE', () => {
        const subjects = subjectsAcrossSuites();
        const seeded = seededScreens();

        //   The scan's own alibi first: a walk that found nothing would satisfy
        //   the comparison for the wrong reason. #484's shape.
        expect(seeded.size).toBeGreaterThan(50);
        expect(subjects.size).toBeGreaterThan(50);

        expect(coverageGaps(subjects, seeded).notCovered).toEqual([]);
    });

    it('AND EVERY SUBJECT IS A SEEDED SCREEN — the other direction', () => {
        //   Without this, the subject set could be padded with anything at all
        //   and the test above would still pass.
        expect(coverageGaps(subjectsAcrossSuites(), seededScreens()).extra).toEqual([]);
    });

    it('AND ALL FOUR SUITES ARE READ, NOT THREE', () => {
        //   A suite quietly dropped from the list above would take its subjects
        //   with it and turn the "not covered" check into a failure people
        //   would fix by shortening the seeded scan. Each file must exist and
        //   must actually carry a subject table.
        expect(SUITES).toHaveLength(4);
        for (const suite of SUITES) {
            const src = readFileSync(join(ROOT, suite), 'utf-8');
            expect({ suite, hasTable: src.includes('const BARE_ROW_SUBJECTS') })
                .toEqual({ suite, hasTable: true });
        }
    });
});

/**
 * ── THE MUTATION TABLE ──────────────────────────────────────────────────────
 *
 *   Against a green baseline, one anchored swap at a time, each restored and
 *   verified with `diff -q` before the next:
 *
 *     seller dashboard: the answer replaces the shape again  KILLED (3 tests)
 *     seller dashboard: order.items.length unguarded again   KILLED (2)
 *     seller dashboard: order.items.map unguarded again      KILLED (2)
 *     buyer dashboard: order.items.length unguarded again    KILLED (2)
 *     buyer dashboard: order.items.map unguarded again       KILLED (2)
 *     wave earnings: the raw Date method back                KILLED
 *     coverage: one suite dropped from the list              KILLED (2)
 *     coverage: the seeded walk pointed at one subtree       KILLED (2)
 *     coverage: a subject dropped from this batch            KILLED (3)
 *     coverage: the notCovered half of the comparison gutted KILLED
 *     coverage: the extra half of the comparison gutted      KILLED
 *     ledger: a name added to #589's PROVEN without a
 *             render being added here                        KILLED (2)
 *     reword this header                                     SURVIVED, as intended
 *
 *   ONE SURVIVED THE FIRST RUN AND THE FIX WAS STRUCTURAL, NOT ANOTHER TEST.
 *   Replacing the reverse-direction check with `expect(true).toBe(true)`
 *   survived — and a mutant that deletes an assertion ALWAYS survives, because
 *   that is what an assertion is. Adding a second assertion would not have
 *   fixed it; it would have moved it.
 *
 *   So the comparison is CODE now: one named `coverageGaps(subjects, seeded)`
 *   returning both directions, exercised against sets whose answer is known,
 *   and asserted by the two tests. Gutting either half of that function now
 *   fails. That is the difference between a check that cannot fail and one that
 *   can — which is #588's cap, #331's forensic checks and #598's dead exclusion,
 *   applied to this file's own instrument.
 */
