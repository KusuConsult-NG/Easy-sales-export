/**
 * @jest-environment jsdom
 */

/**
 *   #604 FIVE OF THE TWENTY-FIVE "UNREACHED" SCREENS WERE UNREACHED BECAUSE OF
 *        THE FIXTURE, AND THEY WERE HIDING SIX DEFECTS.
 *
 *   #603 closed with twenty-five of forty-eight admin screens declared
 *   NOT_REACHED and a warning attached: "#602 found that five of seven such
 *   screens were unreached because of MY FIXTURE, and three of those five were
 *   hiding real defects. The list is a to-do, not an exoneration." That warning
 *   was right for the second time running.
 *
 *   THE INSTRUMENT WAS BROKEN IN TWO WAYS AT ONCE, and both were mine:
 *
 *     THE ACTION-MODULE PROXY WAS A THENABLE. `await import("@/app/actions/x")`
 *     reads `.then` off the module namespace first. A Proxy that answers every
 *     name with the same async function answers one for `then` too, so the
 *     awaited value looked like a promise, was called as `then(resolve, reject)`
 *     by the runtime, ignored both, and never settled. Any screen that loads its
 *     action inside the effect — /admin and /admin/settings/logs both do —
 *     stayed on "Loading…" forever and was recorded as unreachable.
 *
 *     AND `__esModule` HAD TO BE `true`, NOT ABSENT. Answering `undefined` there
 *     makes the interop wrap the Proxy as `{ default: proxy }`, so the
 *     destructured action is undefined and nothing loads either. Fixing the
 *     first half alone changed nothing, which is what made the second half
 *     visible.
 *
 *   Widening the fixture to the shapes those screens actually read — a `reports`
 *   object, an `activities` list, a `settings` document — reached five of the
 *   twenty-five. What they had been covering for:
 *
 *     /admin                    `stats.platformOverview.revenueAvailable` and
 *                               three `stats.counts.x` reads with no `?.`, in the
 *                               same array as two tiles that DO guard. A partial
 *                               stats answer blanked the admin dashboard.
 *     wave/members              `item.user.id` inside the loader's map — and a
 *                               second copy of the same mapping in the CSV
 *                               export — plus `error` destructured and never
 *                               rendered, plus `getDisplayName(m).charAt(0)`.
 *                               Three defects; own suite.
 *     settings/localization     `lang.code.toUpperCase()`, and `setSettings`
 *                               REPLACING the shape rather than filling it.
 *     settings/logs             "Invalid Date" for a row without one.
 *     cooperatives/dashboard    the same.
 *
 *   THE UNREACHED ARE EIGHTEEN NOW, AND NO REASON IS CLAIMED FOR THEM. This
 *   commit built a four-category taxonomy to replace the flat list, checked it,
 *   and found it false: the two properties that looked like reasons — no loader
 *   at mount, no list state — are equally true of eighteen screens the row
 *   DOES reach. `wouldExcuse` below keeps that refutation where the next attempt
 *   will find it. A category that explains both groups explains neither.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file. Two of the
 *   fixes above survived this suite and were given their own: reaching a screen
 *   proves the fixture gets in, not that the screen is right.
 */



/**
 *   #603 THIRTEEN MORE CRASHES ACROSS THE REST OF ADMIN — AND MORE THAN HALF OF
 *        WHAT THIS SUITE RENDERS STILL PROVES NOTHING.
 *
 *   #601 and #602 took twenty admin screens. These are the other forty-eight.
 *   Thirteen threw:
 *
 *     chatbot                   session.lastMessageAt.toLocaleString(...)
 *                               and MODULE_CONFIGS[module] — a session whose
 *                               module is not one of the four known values made
 *                               `cfg` undefined and took the list down
 *     cms                       announcements.map is not a function
 *     content-approval          status.toUpperCase()
 *     cooperatives/members      app.user.name
 *     disputes                  status.replace(/_/g, " ").toUpperCase()
 *     export/catalog            serverTotal.toLocaleString()
 *     farm-nation/escrow        tx.propertyId.substring(0, 8)
 *     feature-toggles           toggle.name.toLowerCase(), on every keystroke
 *     system-health             report.services.redis, and
 *                               Object.entries(report.featureToggles)
 *     system-health/diagnostics data?.services.firestore,
 *                               data.secretWeaknesses.length, and
 *                               Object.values(data.services)
 *
 * ── TWO OF THEM ARE NEW SHAPES, NOT MORE OF THE SAME ────────────────────────
 *
 *   `setAnnouncements(a ?? [])` ON /admin/cms IS A GUARD THAT DOES NOT GUARD.
 *   `?? []` catches null and undefined and nothing else, so a reader that
 *   answers with an ERROR OBJECT gets stored as the list and
 *   `announcements.map` is then not a function. The screen does not show "no
 *   announcements"; it goes blank. `Array.isArray` is the check that was
 *   meant.
 *
 *   `data?.services.firestore` ON THE DIAGNOSTICS PAGE IS AN OPTIONAL CHAIN
 *   THAT STOPS ONE LEVEL EARLY — the same fault as #601's `numberOrZero(stats
 *   .bySeverity.info)`, in the opposite notation. Somebody thought about the
 *   outer object and not the inner one, and `?.` on the outside reads as
 *   thorough. This is the second instance in three commits, so it is a shape
 *   rather than an oversight.
 *
 * ── AND THE HONEST NUMBER: TWENTY-ONE OF FORTY-EIGHT ────────────────────────
 *
 *   Twenty-seven of these forty-eight are VACUOUS — the shared fixture never
 *   reaches their render path, so the pass proves they do not throw on MOUNT
 *   and nothing at all about a hostile row. Most are settings forms and
 *   dashboards rather than document lists, which is a plausible reason and NOT
 *   a verified one, so it is not claimed: they are named, capped, and left as
 *   stated work.
 *
 *   #602 is the reason that matters. There, five of seven "unreached" screens
 *   turned out to be unreached because of MY FIXTURE, and three of those five
 *   were hiding real defects. The same is likely true of some of these
 *   twenty-seven. The list is a to-do, not an exoneration.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
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
                     'notifications','resources','sessions','listings','verifications','requests','plans','records','data']) {
        rows[k] = [...ROWS];
    }
    rows.stats = {}; rows.analytics = {}; rows.summary = {}; rows.meta = {}; rows.membership = ROWS[0] ?? null;
    //   #604 — three more shapes, each found by asking the screen rather than
    //   guessing. `reports` is an ARRAY THAT ALSO CARRIES OBJECT KEYS because the
    //   two screens that read it disagree: /admin/cooperatives/contributions wants
    //   `data.reports.topContributors` and a list screen would want to map it.
    //   Satisfying both is what stops the next fixture widening from un-reaching a
    //   screen this one reaches.
    rows.reports = Object.assign([...ROWS], { topContributors: [...ROWS], monthly: [...ROWS] });
    rows.activities = [...ROWS];
    rows.toggles = [...ROWS];
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
    //   #604 — the settings screens read through `loadSettings`, which requires a
    //   `settings` key and treats its absence as a failed read. Without this the
    //   three settings screens rendered their load-error banner and the bare row
    //   never reached a field.
    result.settings = { languages: [...ROWS], currencies: [...ROWS] };
    return result;
}
const act = async () => answer();
/**
 * #604 — SOME READERS ANSWER WITH A BARE ARRAY, NOT A RESULT ENVELOPE.
 *
 * /admin/cms calls getActiveAnnouncementsAction and getActiveBannersAction and
 * uses what comes back AS the list. A Proxy that hands every name the same
 * envelope makes those two screens unreachable, which is a fact about the
 * fixture. The name is available on the Proxy trap, so branch on it.
 */
const ARRAY_RETURNING = /^getActive(Announcements|Banners)Action$/;

/**
 * #604 — AND THE PROXY MADE EVERY ACTION MODULE A THENABLE.
 *
 * /admin/DashboardClient and /admin/settings/logs do not import their action at
 * the top of the file; they load it inside the effect:
 *
 *     const { getDashboardStatsAction } = await import("@/app/actions/admin-analytics");
 *
 * `await` on a module namespace reads `.then` off it first. A Proxy that hands
 * every name the same async function hands one back for `then` too — so the
 * awaited value LOOKS like a promise, gets called as `then(resolve, reject)` by
 * the runtime, ignores both arguments, and never settles. The effect hangs, the
 * screen stays on "Loading…", and the differential test reports NOT_REACHED.
 *
 * Two screens were on the to-do list for that reason and neither belonged
 * there. `then` — and the symbol keys the module machinery probes — must answer
 * undefined, which is what a real module namespace without a `then` export does.
 */
function isNotAnAction(name: string | symbol): boolean {
    return typeof name === 'symbol' || name === 'then';
}

/**
 * And some screens read through `fetch`, not through an action at all.
 * The same answer, as a Response.
 */
function installFetch() {
    (global as any).fetch = jest.fn(async () => ({
        ok: true, status: 200,
        json: async () => answer(),
        text: async () => JSON.stringify(answer()),
    }));
}

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
    jest.mock(`@/app/actions/${m}`, () => new Proxy({ __esModule: true }, {
        get: (_t, name: string | symbol) => (
            name === '__esModule' ? true
                : isNotAnAction(name) ? undefined
                    : ARRAY_RETURNING.test(String(name)) ? (async () => [...ROWS])
                        : act
        ),
    }));
}



/**
 * The forty-eight rendered. Thirty receive the row; the eighteen in NOT_REACHED
 * do not, and say so.
 */
const ADMIN_SUBJECTS: [string, string][] = [

    ['DashboardClient', '@/app/admin/DashboardClient'],
    ['analytics', '@/app/admin/analytics/page'],
    ['chatbot', '@/app/admin/chatbot/page'],
    ['cms', '@/app/admin/cms/page'],
    ['communications', '@/app/admin/communications/page'],
    ['communications/broadcast', '@/app/admin/communications/broadcast/page'],
    ['communications/history', '@/app/admin/communications/history/page'],
    ['communications/in-app', '@/app/admin/communications/in-app/page'],
    ['communications/sms', '@/app/admin/communications/sms/page'],
    ['content-approval', '@/app/admin/content-approval/page'],
    ['cooperatives', '@/app/admin/cooperatives/page'],
    ['cooperatives/contributions', '@/app/admin/cooperatives/contributions/page'],
    ['cooperatives/dashboard', '@/app/admin/cooperatives/dashboard/page'],
    ['cooperatives/loan-products', '@/app/admin/cooperatives/loan-products/page'],
    ['cooperatives/members', '@/app/admin/cooperatives/members/page'],
    ['disputes', '@/app/admin/disputes/page'],
    ['export/bookings', '@/app/admin/export/bookings/page'],
    ['export/catalog', '@/app/admin/export/catalog/page'],
    ['farm-nation', '@/app/admin/farm-nation/page'],
    ['farm-nation/escrow', '@/app/admin/farm-nation/escrow/page'],
    ['farm-nation/land-verification', '@/app/admin/farm-nation/land-verification/page'],
    ['farm-nation/listings', '@/app/admin/farm-nation/listings/page'],
    ['feature-toggles', '@/app/admin/feature-toggles/page'],
    ['forensics', '@/app/admin/forensics/page'],
    ['marketplace', '@/app/admin/marketplace/page'],
    ['marketplace/buyers', '@/app/admin/marketplace/buyers/page'],
    ['marketplace/escrow', '@/app/admin/marketplace/escrow/page'],
    ['marketplace/products', '@/app/admin/marketplace/products/page'],
    ['marketplace/village-market', '@/app/admin/marketplace/village-market/page'],
    ['messages', '@/app/admin/messages/page'],
    ['orphaned-users', '@/app/admin/orphaned-users/page'],
    ['settings/fees', '@/app/admin/settings/fees/page'],
    ['settings/general', '@/app/admin/settings/general/page'],
    ['settings/localization', '@/app/admin/settings/localization/page'],
    ['settings/logs', '@/app/admin/settings/logs/page'],
    ['settings/maintenance', '@/app/admin/settings/maintenance/page'],
    ['settings/notifications', '@/app/admin/settings/notifications/page'],
    ['settings/password-resets', '@/app/admin/settings/password-resets/page'],
    ['settings/security', '@/app/admin/settings/security/page'],
    ['system-health', '@/app/admin/system-health/page'],
    ['system-health/diagnostics', '@/app/admin/system-health/diagnostics/page'],
    ['wave', '@/app/admin/wave/page'],
    ['wave/compliance', '@/app/admin/wave/compliance/page'],
    ['wave/members', '@/app/admin/wave/members/page'],
    ['wave/registrations', '@/app/admin/wave/registrations/page'],
    ['wave/resources', '@/app/admin/wave/resources/page'],
    ['wave/training', '@/app/admin/wave/training/page'],
    ['wave/withdrawals', '@/app/admin/wave/withdrawals/page'],];

/**
 * Rendered, but the shared fixture never reaches their render path.
 *
 * NOT AN EXONERATION — see the header. #602 found that five of seven such
 * screens were unreached because of the fixture rather than the screen, and
 * three of those were hiding defects; #604 found the same of five of
 * twenty-five. This is a to-do list with a number on it.
 *
 * AND NO REASON IS CLAIMED FOR THESE EIGHTEEN. #604 built a four-category
 * taxonomy for them, checked it, and found it false — see `wouldExcuse` below,
 * which keeps the refutation where the next person will look for it.
 *
 * #609 ACCOUNTED FOR ELEVEN OF THEM, ONE SCREEN AT A TIME RATHER THAN BY A
 * THEORY, and they stay on this list because THIS suite still does not reach
 * them — being covered elsewhere is not the same as being covered here, and
 * collapsing the two is how a to-do list becomes an exoneration:
 *
 *   six load nothing until a button is pressed, so they are probed by
 *   `an-admin-screen-that-does-nothing-until-you-click.test.tsx`, which found a
 *   crash on /admin/forensics;
 *   five call no action and no fetch on any path, which that file checks in both
 *   directions — the check #604's taxonomy could not survive.
 *
 * #610 TOOK THE LAST SEVEN — settings/fees, settings/general,
 * settings/notifications, settings/security, system-health,
 * system-health/diagnostics and wave/compliance — in
 * `the-last-seven-admin-screens.test.tsx`, which gives each the answer it
 * actually reads instead of guessing one shape for all of them. That is what
 * #601 said would be needed at the start, and what the eighteen were waiting for.
 *
 * ALL EIGHTEEN ARE NOW ACCOUNTED FOR, AND NONE OF THEM HAS MOVED OFF THIS LIST.
 * This suite still cannot reach them; being covered elsewhere is not being
 * covered here, and the number below stays honest about what THIS instrument
 * proves. It is the difference between "forty-eight screens covered" and
 * "thirty covered here, eighteen covered by three other files, and no screen
 * covered by nobody".
 */
const NOT_REACHED = [
    'communications',
    'communications/broadcast',
    'communications/in-app',
    'communications/sms',
    'cooperatives',
    'farm-nation',
    'forensics',
    'marketplace',
    'orphaned-users',
    'settings/fees',
    'settings/general',
    'settings/maintenance',
    'settings/notifications',
    'settings/security',
    'system-health',
    'system-health/diagnostics',
    'wave',
    'wave/compliance',
];

beforeEach(() => {
    jest.clearAllMocks();
    ROWS = [ROW];
    installFetch();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#603 — the rest of admin, against a row that carries only an id', () => {
    for (const [name, mod] of ADMIN_SUBJECTS) {
        it(`${name} RENDERS, AND THE ROW EITHER REACHES IT OR IS DECLARED NOT TO`, async () => {
            const { default: Screen } = await import(mod);

            ROWS = [ROW];
            const { container } = render(<Screen />);
            await new Promise(r => setTimeout(r, 60));
            const withRow = container.textContent;

            ROWS = [];
            const { container: withoutRow } = render(<Screen />);
            await new Promise(r => setTimeout(r, 60));
            ROWS = [ROW];

            const reached = withoutRow.textContent !== withRow;
            expect({ name, reached }).toEqual({ name, reached: !NOT_REACHED.includes(name) });
        });
    }

    /**
     * #604 — THE TAXONOMY THIS COMMIT WAS GOING TO SHIP, AND THE CHECK THAT
     *        REFUTED IT.
     *
     * A flat to-do list of eighteen screen names is unsatisfying, so the plan
     * was to replace it with named categories: a screen with no loader at mount
     * has nothing to load, and a screen with no list state has nowhere to put a
     * row. Both read as obviously true.
     *
     * Both are false, and this says so with a number. THIRTY of these
     * forty-eight screens ARE reached by the bare row, and eighteen of those
     * thirty satisfy one of the two "reasons" — they have no mount-time effect,
     * or no `useState([])` — and are reached anyway, through `useAdminData`,
     * through state seeded from a prop, through a child that loads on mount.
     *
     * A category that is equally true of the screens it excuses and the screens
     * it does not excuse is not a reason; it is a comment that reads like one.
     * The eighteen stay a to-do list, and this test is here so the next attempt
     * at the same taxonomy is refuted in a second rather than believed.
     */
    function wouldExcuse(source: string): 'NO_LOADER_AT_MOUNT' | 'NO_LIST_STATE' | null {
        if (!source.includes('useEffect(')) return 'NO_LOADER_AT_MOUNT';
        if (!/useState(<[^>]*>)?\(\s*\[\s*\]\s*\)/.test(source)) return 'NO_LIST_STATE';
        return null;
    }

    function sourceOf(mod: string): string {
        const rel = mod.replace(/^@\//, '');
        for (const ext of ['.tsx', '.ts']) {
            try { return readFileSync(join(process.cwd(), 'src', rel + ext), 'utf8'); } catch { /* next */ }
        }
        throw new Error(`no source for ${mod}`);
    }

    it('AND "NO LOADER AT MOUNT" IS NOT A REASON — IT IS TRUE OF EIGHTEEN SCREENS THE ROW REACHES', () => {
        const excusedButReached = ADMIN_SUBJECTS
            .filter(([name]) => !NOT_REACHED.includes(name))
            .filter(([, mod]) => wouldExcuse(sourceOf(mod)) !== null)
            .map(([name]) => name);

        //   Named, not counted, so that a screen moving between the two lists
        //   has to be looked at rather than absorbed by a number.
        expect(excusedButReached.sort()).toEqual([
            'DashboardClient', 'analytics', 'content-approval', 'cooperatives/contributions',
            'cooperatives/loan-products', 'cooperatives/members', 'disputes', 'export/catalog',
            'farm-nation/land-verification', 'farm-nation/listings', 'marketplace/buyers',
            'marketplace/escrow', 'marketplace/village-market', 'settings/localization',
            'wave/registrations', 'wave/resources', 'wave/training', 'wave/withdrawals',
        ]);

        //   And the predicate really is true of every unreached screen — which is
        //   exactly why it looked like an explanation. It explains both groups,
        //   so it explains neither.
        for (const name of NOT_REACHED) {
            const mod = ADMIN_SUBJECTS.find(s => s[0] === name)![1];
            expect({ name, excused: wouldExcuse(sourceOf(mod)) !== null }).toEqual({ name, excused: true });
        }
    });

    it('AND THE UNREACHED ARE COUNTED, NAMED, AND ALL SUBJECTS', () => {
        //   Capped in both directions: this suite's honesty is the difference
        //   between "forty-eight screens covered" and "thirty covered and
        //   eighteen still to do".
        expect(ADMIN_SUBJECTS).toHaveLength(48);
        //   #604 — 25 → 18. Only ever downwards: this number going UP means a
        //   screen stopped being reached, which is a regression in the fix or in
        //   the fixture and either way is not something to absorb quietly.
        expect(NOT_REACHED).toHaveLength(18);
        const names = new Set(ADMIN_SUBJECTS.map(s => s[0]));
        for (const n of NOT_REACHED) {
            expect({ n, isASubject: names.has(n) }).toEqual({ n, isASubject: true });
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#603 — the two guards that were not guards', () => {
    it('A LIST READER THAT ANSWERS WITH AN OBJECT LEAVES THE CMS SCREEN EMPTY, NOT BLANK', () => {
        //   `?? []` catches null and undefined and nothing else. This is the
        //   check that was meant, stated as a claim about the rule rather than
        //   about the screen, because the screen is one of twenty-seven the
        //   fixture cannot reach.
        const asList = (v: unknown) => (Array.isArray(v) ? v : []);
        expect(asList(undefined)).toEqual([]);
        expect(asList(null)).toEqual([]);
        expect(asList({ success: false, error: 'nope' })).toEqual([]);
        expect(asList(['a'])).toEqual(['a']);
        //   And the guard it replaces really does let the object through: `??`
        //   only fires for null and undefined, so a non-null object passes
        //   straight into the list state.
        const fromReader: unknown = { success: false, error: 'nope' };
        expect(Array.isArray(fromReader ?? [])).toBe(false);
    });

    it('AND AN OPTIONAL CHAIN THAT STOPS ONE LEVEL EARLY IS NOT A GUARD', () => {
        /**
         *   `data?.services.firestore` — the same fault as #601's
         *   `numberOrZero(stats.bySeverity.info)` in the opposite notation.
         *   Second instance in three commits, so it is a shape.
         */
        const data: any = { };
        expect(() => data?.services.firestore).toThrow();
        expect(data?.services?.firestore).toBeUndefined();
    });
});

/**
 * ── THE MUTATION TABLE ──────────────────────────────────────────────────────
 *
 *   Against a green baseline, one anchored swap at a time, each restored and
 *   verified with `diff -q` before the next:
 *
 *     chatbot: the raw date method back                 KILLED
 *     chatbot: the module fallback removed              KILLED
 *     cms: Array.isArray back to `?? []`                KILLED
 *     content-approval: the raw toUpperCase back        KILLED
 *     coop members: the user guard removed              KILLED
 *     disputes: the raw humaniser back                  KILLED
 *     export catalog: the figure unguarded again        KILLED
 *     farm-nation escrow: the raw substring back        KILLED
 *     feature toggles: the name read unguarded again    KILLED
 *     system health: the services guard removed         KILLED
 *     system health: the featureToggles guard removed   KILLED
 *     diagnostics: the chain stops one level early again KILLED
 *     the vacuity guard removed — every screen counted
 *       as reached                                      KILLED (27)
 *     NOT_REACHED padded to excuse a screen             KILLED (2)
 *     reword this header                                SURVIVED, as intended
 *
 *   #604 added, against the same discipline:
 *
 *     dashboard: revenueAvailable unguarded again       KILLED
 *     dashboard: stats.counts unguarded again           KILLED
 *     localization: lang.code.toUpperCase() back        KILLED
 *     localization: setSettings replaces, not fills     KILLED
 *     the Proxy answers `act` for `then` again          KILLED (2 — the two
 *                   screens that load their action inside the effect stop
 *                   being reached, and the cap says so)
 *     the Proxy answers undefined for `__esModule`      KILLED (2)
 *     wouldExcuse: return null for everything           KILLED
 *     wouldExcuse: the excused-but-reached list trimmed KILLED
 *     reword this header                                SURVIVED, as intended
 *
 *   TWO MUTANTS SURVIVED AND ARE RECORDED RATHER THAN HIDDEN:
 *
 *     system-health: the stats guard removed            SURVIVED — /admin/system-health
 *                   is one of the eighteen this suite cannot reach, so it was
 *                   proving nothing about that file. Backed now by
 *                   `a-health-report-with-half-the-answer.test.tsx`.
 *     wave/members: the loader guards removed           SURVIVED — this suite
 *                   reports that screen as REACHED, and the differential check
 *                   only asks whether the output DIFFERS with a row and without
 *                   one. A crash differs from an empty state just as loudly as a
 *                   member does. Backed now by
 *                   `the-wave-register-said-nobody-was-enrolled.test.tsx`, which
 *                   found a third defect on that screen while being written.
 *
 *   The vacuity guard is still the load-bearing check: without it this file
 *   would report forty-eight screens covered when thirty are. But those two
 *   survivors are the sharper lesson — REACHED IS NOT COVERED. This suite proves
 *   a screen renders and that the fixture got in. Whether what it rendered is
 *   right is a different question, and it needs a different test.
 */
