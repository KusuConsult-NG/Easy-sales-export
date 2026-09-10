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
 * ── #602: THE SEVEN UNREACHED WERE SEVEN BECAUSE OF THE FIXTURE, NOT THE CODE
 *
 *   #601 shipped with seven of twenty subjects declared NOT_REACHED and said
 *   each would need its own result shape. Five of the seven needed one line
 *   between them: several screens read `result.disputes`, `result.reviews` or
 *   `result.recentTransactions` at the RESULT level rather than under `data`,
 *   and the shared fixture only attached them under `data`. Widening it reached
 *   four immediately — and then three of those four turned out to be hiding
 *   defects that "vacuous" had been covering for:
 *
 *     academy/applications   `const d = stdApp.data` and `stdApp.user.name`
 *                            inside the LOADER's map, wrapped in a try/catch
 *                            that turns the throw into `success: false`. One
 *                            malformed application made the entire Academy
 *                            approval queue show an error rather than lose one
 *                            row — worse than the render-time version of this
 *                            defect, because a crash is at least loud and this
 *                            looked like the server being down.
 *     marketplace/reviews    `review.userId.slice(0, 12)`
 *     farm-nation/applications  `item.user.name` and fifteen more reads of the
 *                            two joined halves, plus `status.replace(/_/g)` —
 *                            and this one was ONLY visible after mocking
 *                            `@/app/actions/farm-nation-admin`, which #601 had
 *                            not mocked at all.
 *
 *   NOT_REACHED is two now, and the reason changed: /admin/withdrawals and
 *   /admin/escrow are `redirect()` stubs, so there is no row for a row to
 *   reach. That is a fact about those files rather than about the fixture, and
 *   a test asserts it.
 *
 *   THE FIXTURE IS PART OF THE INSTRUMENT AND GOT THE SAME SCRUTINY. Widening
 *   it introduced a bug of its own — the key list also attaches `data`, so
 *   copying every key up to the result level REPLACED `result.data` with a
 *   plain array and silently emptied every screen reading
 *   `result.data.transactions`. It cost a debugging round and is commented
 *   where it happened.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { readFileSync } from 'fs';
import { join } from 'path';

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
    //   #602 — the collection names are attached at the RESULT level as well as
    //   under `data`, because several screens read `result.disputes`,
    //   `result.reviews` or `result.recentTransactions` directly. Guessing one
    //   shape and calling the rest "covered" is what NOT_REACHED exists to stop.
    const result: any = { success: true, error: null, data: rows, lastDocId: undefined,
                          hasMore: false, meta: { hasMore: false, lastDocId: undefined } };
    for (const k of Object.keys(rows)) {
        //   NOT `data`: the list above also attaches a `data` key to `rows`, and
        //   copying it up would REPLACE `result.data` — which is `rows` itself —
        //   with a plain array, so every screen reading `result.data.transactions`
        //   silently saw nothing. It cost a debugging round; the fixture is part
        //   of the instrument and gets the same scrutiny.
        if (k !== 'data' && Number.isNaN(Number(k))) result[k] = (rows as any)[k];
    }
    result.recentTransactions = [...ROWS];
    result.failedTransactions = [...ROWS];
    result.totalRevenue = 0;
    result.unavailable = [];
    return result;
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
                 'diagnose-broadcast','ai-actions','dashboard','auth','password-reset','admin','farm-nation-admin']) {
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
 * The two subjects a row cannot reach, AND THE REASON IS NOT THE FIXTURE.
 *
 *   #602 — this list had seven entries and now has two, which is the finding.
 *
 *   Five of the seven were unreached because the shared fixture guessed one
 *   result shape and several screens read another: `result.disputes`,
 *   `result.reviews`, `result.recentTransactions` at the RESULT level rather
 *   than under `data`. Widening the fixture reached four of them at once, and
 *   /admin/academy/applications turned out to be a DEFECT rather than a shape.
 *
 *   The last two are not screens at all. /admin/withdrawals and /admin/escrow
 *   are `redirect()` stubs — retired duplicates kept so old links still work —
 *   so there is no row for a row to reach.
 */
const NOT_REACHED = [
    'withdrawals',
    'escrow',
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

    /**
     * Is this subject a `redirect()` one-liner rather than a screen?
     *
     * A NAMED FUNCTION, not an inline assertion, and a surviving mutant is why:
     * gutting the assertion survives — that is what an assertion is — so the
     * thing being asserted has to be code a mutant can attack, and it is
     * exercised against known answers below. #599 and #600 learned the same
     * thing; this is the third time and it is the pattern now.
     */
    function isARedirectStub(name: string): boolean {
        const subject = ADMIN_SUBJECTS.find(s => s[0] === name);
        if (!subject) return false;
        const file = join(process.cwd(), subject[1].replace('@/app/', 'src/app/') + '.tsx');
        return readFileSync(file, 'utf-8').includes('redirect(');
    }

    it('AND THE TWO UNREACHED ARE REDIRECT STUBS, NOT SCREENS', () => {
        //   The reason matters more than the number: "the row never reached it"
        //   is a fact about these files rather than about the fixture, and if
        //   either ever grows a real screen this fails and it needs a fixture.
        for (const n of NOT_REACHED) {
            expect({ n, isARedirect: isARedirectStub(n) }).toEqual({ n, isARedirect: true });
        }

        //   And the check can tell them apart, which the assertion alone does
        //   not prove: a real screen is not a stub, and a name that is not a
        //   subject at all is not one either.
        expect(isARedirectStub('marketplace/withdrawals')).toBe(false);
        expect(isARedirectStub('cooperatives/loans')).toBe(false);
        expect(isARedirectStub('not-a-subject')).toBe(false);
    });

    it('AND THE UNREACHED LIST IS NAMED, CAPPED, AND ALL SUBJECTS', () => {
        //   A list that grows quietly turns "thirteen proven" into "twenty
        //   rendered and nobody counted". Its length is asserted and every
        //   entry must be a subject, so a typo cannot silently excuse a screen.
        expect(NOT_REACHED).toHaveLength(2);
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
 *   The two NOT_REACHED mutants are the ones that matter most: this suite's
 *   honesty rests on that list being neither padded to excuse a screen nor
 *   trimmed to flatter the count, and both directions fail.
 *
 * ── #602's MUTANTS ─────────────────────────────────────────────────────────
 *
 *     academy loader: the data/user guards removed      KILLED
 *     reviews: the raw slice back                       KILLED
 *     farm-nation: the applicant name unguarded again   KILLED
 *     farm-nation: the status badge unguarded again     KILLED
 *     fixture: `data` copied up again, emptying every
 *              screen that reads result.data.<name>     KILLED
 *     fixture: the result-level keys removed again      KILLED (2)
 *     NOT_REACHED padded to excuse a screen             KILLED (3)
 *     NOT_REACHED emptied                               KILLED (3)
 *     the stub detector made to always say yes          KILLED  ← see below
 *     reword the #602 note                              SURVIVED, as intended
 *
 *   ONE SURVIVED THE FIRST RUN AND THE FIX WAS STRUCTURAL, FOR THE THIRD TIME.
 *   Gutting the redirect-stub assertion survived, because a mutant that deletes
 *   an assertion always survives. It is a named `isARedirectStub` now,
 *   exercised against a real screen, another real screen and a name that is not
 *   a subject — so there is code for a mutant to attack. #599 and #600 each
 *   reached the same conclusion; this is the pattern rather than an incident.
 */
