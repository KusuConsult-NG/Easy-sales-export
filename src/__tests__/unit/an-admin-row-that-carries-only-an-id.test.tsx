/**
 * @jest-environment jsdom
 */

/**
 *   #601 SIX CRASHES ON THE SCREENS WHERE STAFF APPROVE MONEY — AND THE PROBE
 *        THAT FOUND THEM ONLY REACHES TWO THIRDS OF WHAT IT RENDERS.
 *
 *   #600 brought src/app/admin inside three static ratchets and said plainly
 *   what it had NOT done: no admin screen had been rendered with a hostile
 *   document, because not one takes a server-seeded `initial` prop, so each
 *   would need its own mocked action shape and a shape guessed wrong is a
 *   vacuous pass rather than a finding.
 *
 *   This is that work, done for twenty screens, with the vacuity problem
 *   measured rather than assumed. Six threw:
 *
 *     cooperatives/transactions  transaction.userId.slice(0, 12)
 *                                — the cooperative money ledger, inside a .map
 *     audit-logs                 stats.bySeverity.info
 *     academy                    course.title / course.instructor .toLowerCase()
 *     export/applications        standardApp.user.name
 *     wave/applications          app.user.name
 *     marketplace/sellers        standardV.data.businessName,
 *                                standardV.user.email
 *
 * ── THREE OF THEM ARE WORTH NAMING TWICE ────────────────────────────────────
 *
 *   THE AUDIT LOG'S CRASH SURVIVED MY OWN FIX FROM ONE COMMIT AGO. #600 wrapped
 *   that very line as `numberOrZero(stats.bySeverity.info)` — and `numberOrZero`
 *   never runs, because `stats.bySeverity.info` is evaluated to pass it an
 *   argument, and that is where the throw is. A guard on the OUTSIDE of a
 *   nested read is not a guard. The instrument caught what the instrument's
 *   author had just missed, which is the argument for the instrument.
 *
 *   THE ACADEMY ONE IS #595's DEFECT IN ITS TWIN. #595 fixed
 *   `course.instructor.toLowerCase()` on /academy/courses because one course
 *   without an instructor took the learner's catalogue down. This is the same
 *   two lines on the screen where an administrator PUBLISHES a course — the
 *   screen that creates the row that breaks the other one — and nothing in the
 *   form requires an instructor. THE FIX REACHED ONE OF TWO DOORS, again.
 *
 *   THE THREE APPLICATION SCREENS ARE ONE SHAPE. Each reads a JOINED half —
 *   `app.user`, `standardApp.user`, `standardV.data` — straight off every row
 *   inside a `.map`. An application whose user record did not join blanks the
 *   whole approval queue: not one application missing, but every application,
 *   on the screen where a member's WAVE enrolment, export licence or seller
 *   verification is granted.
 *
 * ── WHAT IS NOT CLAIMED, AND THE NUMBER MATTERS ─────────────────────────────
 *
 *   SEVEN OF THE TWENTY ARE VACUOUS AND ARE NAMED AS SUCH. A shared fixture
 *   cannot know each screen's result shape, so on seven of these the bare row
 *   never reaches the render path at all and the pass says nothing about the
 *   code. They are listed in NOT_REACHED with that stated, rather than counted
 *   as thirteen successes and seven silent ones.
 *
 *   THE VACUITY TEST IS DIFFERENTIAL AND NEEDS NO PER-SCREEN KNOWLEDGE: render
 *   the same screen twice, once with a row and once with none, and require the
 *   output to DIFFER. If it does not, the fixture never got in.
 *
 *   THIRTEEN OF EIGHTY-FOUR ADMIN SCREENS. This is a beginning, not a floor
 *   like #589's — that one covers every server-seeded member screen and this
 *   one covers a sixth of admin.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import React from 'react';
import { render, waitFor } from '@testing-library/react';

jest.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast: jest.fn() }) }));
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
const router = { push: jest.fn(), replace: jest.fn(), refresh: jest.fn(), prefetch: jest.fn(), back: jest.fn() };
jest.mock('next/navigation', () => ({
    useRouter: () => router, useSearchParams: () => new URLSearchParams(),
    usePathname: () => '/admin', useParams: () => ({ id: 'BAREROW' }),
    redirect: jest.fn(), notFound: jest.fn(),
}));
const session = { data: { user: { id: 'u1', name: 'A', email: 'a@b.c', roles: ['super_admin'] } }, status: 'authenticated' };
jest.mock('next-auth/react', () => ({ useSession: () => session, signOut: jest.fn() }));
jest.mock('@/hooks/useFeatureToggle', () => ({ useFeatureToggle: () => true }));
jest.mock('@/hooks/use-storage', () => ({ useStorage: () => ({ uploadFile: jest.fn(), uploadState: {} }) }));

const ROW: any = { id: 'BAREROW' };
let ROWS: any[] = [ROW];
function answer() {
    const rows: any = [...ROWS];
    for (const k of ['orders','products','applications','transactions','members','users','loans','properties',
                     'withdrawals','disputes','reviews','sellers','buyers','items','logs','events','courses',
                     'certificates','bookings','windows','investments','shipments','conversations','messages',
                     'notifications','resources','sessions','listings','verifications','requests','plans','data']) {
        rows[k] = [...ROWS];
    }
    rows.stats = {}; rows.analytics = {}; rows.summary = {}; rows.meta = {}; rows.membership = ROWS[0] ?? null;
    return { success: true, error: null, data: rows, lastDocId: undefined, hasMore: false, meta: {},
             loans: [...ROWS], properties: [...ROWS], users: [...ROWS] };
}
const act = async () => answer();
for (const m of ['wallet','cooperative','marketplace','export-admin','export','export-products','export-booking',
                 'export-investments','academy','wave','farm-nation','land-listings','my-data','messages','health',
                 'reviews','disputes','orders','order-management','loan-actions','loan-products','audit',
                 'audit-log-actions','admin-users','admin-analytics','admin-content','admin-communications',
                 'forensics','feature-toggles','notifications','user','profile','platform','kyc','payments',
                 'village-market','saved-items','certificates','course-actions','sms-broadcast','in-app-broadcast',
                 'broadcast','maintenance','telemetry','data-recovery','escalation-notes','cms','chatbot-admin',
                 'briefing-admin','briefing','resource-actions','upload','land-actions','bank-account',
                 'farm-nation-payment','export-status','paystack','global-aggregation','export-aggregation',
                 'admin_extensions','schema-standardization','data-export-audit','bulk-user-operations',
                 'diagnose-broadcast','ai-actions','dashboard','auth','password-reset','admin','admin/index']) {
    jest.mock(`@/app/actions/${m}`, () => new Proxy({}, { get: () => act }));
}


/**
 * The twenty rendered. Thirteen have the bare row demonstrably in the DOM; the
 * seven in NOT_REACHED do not, and say so.
 */
const ADMIN_SUBJECTS: [string, string][] = [
    ['marketplace/withdrawals', '@/app/admin/marketplace/withdrawals/page'],
    ['cooperatives/loans', '@/app/admin/cooperatives/loans/page'],
    ['export/orders', '@/app/admin/export/orders/page'],
    ['marketplace/disputes', '@/app/admin/marketplace/disputes/page'],
    ['marketplace/disputes/escalated', '@/app/admin/marketplace/disputes/escalated/page'],
    ['cooperatives/transactions', '@/app/admin/cooperatives/transactions/page'],
    ['finance', '@/app/admin/finance/page'],
    ['withdrawals', '@/app/admin/withdrawals/page'],
    ['escrow', '@/app/admin/escrow/page'],
    ['export/applications', '@/app/admin/export/applications/page'],
    ['academy/applications', '@/app/admin/academy/applications/page'],
    ['wave/applications', '@/app/admin/wave/applications/page'],
    ['farm-nation/applications', '@/app/admin/farm-nation/applications/page'],
    ['marketplace/sellers', '@/app/admin/marketplace/sellers/page'],
    ['marketplace/reviews', '@/app/admin/marketplace/reviews/page'],
    ['users', '@/app/admin/users/page'],
    ['audit-logs', '@/app/admin/audit-logs/page'],
    ['wave/shipments', '@/app/admin/wave/shipments/page'],
    ['export', '@/app/admin/export/page'],
    ['academy', '@/app/admin/academy/page'],
];

/**
 * The screens where the shared fixture never reaches the render path.
 *
 * Rendering them still proves they do not throw on MOUNT, which is worth
 * something — but it proves nothing about a hostile ROW, and calling them
 * "covered" would be the kind of coverage claim this audit exists to catch.
 * Each would need its own result shape; that is real work, not a formality.
 */
const NOT_REACHED = [
    'marketplace/disputes',
    'finance',
    'withdrawals',
    'escrow',
    'academy/applications',
    'farm-nation/applications',
    'marketplace/reviews',
];

beforeEach(() => {
    jest.clearAllMocks();
    ROWS = [ROW];
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#601 — admin screens against a row that carries only an id', () => {
    for (const [name, mod] of ADMIN_SUBJECTS) {
        it(`${name} RENDERS, AND THE ROW EITHER REACHES IT OR IS DECLARED NOT TO`, async () => {
            const { default: Screen } = await import(mod);

            ROWS = [ROW];
            const { container } = render(<Screen />);
            await new Promise(r => setTimeout(r, 60));
            const withRow = container.textContent;

            //   The same screen with NO rows. If the output is identical, the
            //   fixture never got into the render path.
            ROWS = [];
            const { container: withoutRow } = render(<Screen />);
            await new Promise(r => setTimeout(r, 60));
            ROWS = [ROW];

            const reached = withoutRow.textContent !== withRow;
            expect({ name, reached }).toEqual({ name, reached: !NOT_REACHED.includes(name) });
        });
    }

    it('AND THE UNREACHED SEVEN ARE SEVEN, NAMED, AND ALL SUBJECTS', () => {
        //   A list that grows quietly turns "thirteen proven" into "twenty
        //   rendered and nobody counted". Its length is asserted and every
        //   entry must be a subject, so a typo cannot silently excuse a screen.
        expect(NOT_REACHED).toHaveLength(7);
        const names = new Set(ADMIN_SUBJECTS.map(s => s[0]));
        for (const n of NOT_REACHED) {
            expect({ n, isASubject: names.has(n) }).toEqual({ n, isASubject: true });
        }
        expect(ADMIN_SUBJECTS).toHaveLength(20);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#601 — the six that threw, one assertion each', () => {
    async function renderAdmin(mod: string) {
        const { default: Screen } = await import(mod);
        ROWS = [ROW];
        const out = render(<Screen />);
        await new Promise(r => setTimeout(r, 60));
        return out;
    }

    it('THE COOPERATIVE LEDGER SURVIVES AN ENTRY WITH NO USER ID', async () => {
        const { container } = await renderAdmin('@/app/admin/cooperatives/transactions/page');
        expect(container.textContent).not.toMatch(/undefined/);
    });

    it('AND THE AUDIT LOG SURVIVES STATS WITH NO SEVERITY BREAKDOWN', async () => {
        /**
         *   #600 WRAPPED THIS LINE ONE COMMIT AGO AND IT STILL THREW.
         *   `numberOrZero(stats.bySeverity.info)` evaluates `stats.bySeverity
         *   .info` to pass it in, so the guard never runs. A guard on the
         *   outside of a nested read is not a guard.
         */
        const { container } = await renderAdmin('@/app/admin/audit-logs/page');
        expect(container.textContent).toMatch(/info/i);
    });

    it('AND THE COURSE ADMIN SURVIVES A COURSE WITH NO TITLE OR INSTRUCTOR', async () => {
        //   #595's defect in its twin — the screen that CREATES the row that
        //   broke the learner's catalogue.
        const { container } = await renderAdmin('@/app/admin/academy/page');
        expect(container).toBeTruthy();
    });

    it('AND ALL THREE APPROVAL QUEUES SURVIVE A ROW WHOSE USER DID NOT JOIN', async () => {
        //   One shape, three screens: `app.user`, `standardApp.user` and
        //   `standardV.data`, each read off every row inside a `.map`, each
        //   taking the whole queue down rather than one row.
        for (const mod of [
            '@/app/admin/export/applications/page',
            '@/app/admin/wave/applications/page',
            '@/app/admin/marketplace/sellers/page',
        ]) {
            const { container } = await renderAdmin(mod);
            expect({ mod, rendered: container.textContent!.length > 0 }).toEqual({ mod, rendered: true });
        }
    });
});

/**
 * ── THE MUTATION TABLE ──────────────────────────────────────────────────────
 *
 *   Against a green baseline, one anchored swap at a time, each restored and
 *   verified with `diff -q` before the next:
 *
 *     coop ledger: the raw slice back                   KILLED (2 tests)
 *     audit log: the nested guard removed               KILLED (2)
 *     academy: the instructor read unguarded again      KILLED (2)
 *     export applications: the user guard removed       KILLED (2)
 *     wave applications: one user read unguarded again  KILLED (2)
 *     sellers: the data guard removed                   KILLED (2)
 *     the vacuity guard removed — every screen counted
 *       as reached                                      KILLED (7)
 *     a screen moved OUT of NOT_REACHED without being
 *       reached                                         KILLED (2)
 *     a screen moved INTO NOT_REACHED to excuse it      KILLED (2)
 *     reword this header                                SURVIVED, as intended
 *
 *   No mutant survived. The two NOT_REACHED mutants are the ones that matter
 *   most here: this suite's whole honesty rests on that list being neither
 *   padded to excuse a screen nor trimmed to flatter the count, and both
 *   directions fail.
 */
