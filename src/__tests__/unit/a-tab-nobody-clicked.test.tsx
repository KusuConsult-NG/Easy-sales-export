/**
 * @jest-environment jsdom
 */

/**
 *   #611 #589's FLOOR RENDERS EIGHTY-THREE MEMBER SCREENS AND OPERATES NONE OF
 *        THEM, AND SIX OF THEM SHOW SOMETHING DIFFERENT UNDER EVERY TAB.
 *
 *   The seeded-render floor is the strongest instrument in this audit: every
 *   server-seeded member screen, rendered with a document carrying only an id,
 *   required not to throw. It renders each screen ONCE — in whatever tab or
 *   filter it opens on.
 *
 *   A tab is a different set of fields off the same row. /dashboard/certificates
 *   opens on "Academy" and has an "Uploaded" tab beside it, reading a different
 *   list; /dashboard/disputes has five filters; /dashboard/notifications has ten
 *   branches. The floor proves the row survives the FIRST of those and says
 *   nothing about the rest — which is the same gap #609 found on the admin side,
 *   where six screens rendered nothing at all until a button was pressed.
 *
 *   So this presses. Each screen is seeded with a bare row, every control on it
 *   is clicked in turn, and the screen is required to survive all of them — and
 *   to have CHANGED, so a pass cannot come from a tab that was never switched.
 *
 * ── WHY THESE SIX AND NOT EIGHT ─────────────────────────────────────────────
 *
 *   /profile and /escrow branch on a tab too and are NOT here: their `initial`
 *   matches are framer-motion props, not a server seed, so they are not on
 *   #589's floor and a seeded probe would be measuring something it had made up.
 *   Checking that before writing the list is what stopped this file claiming
 *   eight screens it does not cover.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import React from 'react';
import { render, fireEvent, act } from '@testing-library/react';
import { readFileSync } from 'fs';
import { join } from 'path';

jest.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast: jest.fn() }) }));
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
const router = { push: jest.fn(), replace: jest.fn(), refresh: jest.fn(), prefetch: jest.fn(), back: jest.fn() };
jest.mock('next/navigation', () => ({
    useRouter: () => router, useSearchParams: () => new URLSearchParams(),
    usePathname: () => '/dashboard', useParams: () => ({}),
}));
const session = { data: { user: { id: 'u1', name: 'A', email: 'a@b.c', roles: ['member'] } }, status: 'authenticated' };
jest.mock('next-auth/react', () => ({ useSession: () => session, signOut: jest.fn() }));
jest.mock('@/hooks/useFeatureToggle', () => ({ useFeatureToggle: () => true }));
jest.mock('@/hooks/use-storage', () => ({ useStorage: () => ({ uploadFile: jest.fn(), uploadState: {} }) }));

const ROW: any = { id: 'BAREROW' };

/**
 * The rows behind EVERY reader, seed and mock alike.
 *
 *   #611 — the differential guard below first reported /dashboard/notifications
 *   as vacuous, and the cause was here rather than in the screen: the seed went
 *   empty for the second render but the MOCKED ACTION kept answering with a row,
 *   so the screen polled, refilled, and produced identical output both times.
 *   Emptying half a fixture measures nothing. #602 and #604 each found the same
 *   thing from the other direction — the first suspect is always the instrument.
 */
let ROWS: any[] = [ROW];

function answer(): any {
    const rows: any = [...ROWS];
    for (const k of ['disputes', 'notifications', 'certificates', 'products', 'purchases',
                     'orders', 'items', 'requests', 'data']) {
        rows[k] = [...ROWS];
    }
    //   #611 — `verification` is a SINGLE object, not a list, and without it
    //   /marketplace/sell renders its "get verified" onboarding state: one button
    //   that navigates, nothing to switch, and the probe reported the screen
    //   unexercised for a reason that was entirely the fixture's. That is #602's
    //   and #604's lesson for the third time — the first suspect is the fixture.
    rows.verification = ROWS.length ? { ...ROWS[0], status: 'approved' } : null;
    const result: any = { success: true, error: null, data: rows, meta: {} };
    for (const k of Object.keys(rows)) {
        if (k !== 'data' && Number.isNaN(Number(k))) result[k] = rows[k];
    }
    return result;
}
const act_ = async () => answer();

/**
 *   #611 — SOME READERS ANSWER WITH A BARE ARRAY, NOT A RESULT ENVELOPE.
 *
 *   `getMyNotifications(n)` returns the rows themselves, and the screen feeds
 *   them straight to `windowOf`. A Proxy that hands every name the same envelope
 *   made that window empty — so pressing "Show more", which re-runs the poll,
 *   REPLACED the seeded row with nothing and the screen said "No Notifications.
 *   You're all caught up!" while holding a row.
 *
 *   That looked exactly like a defect and was not one. #604 hit the same shape on
 *   /admin/cms and named it there; this is the third fixture correction in this
 *   file alone, which is the honest cost of a shared answer meeting readers with
 *   different contracts.
 */
const ARRAY_RETURNING = /^(getMyNotifications)$/;

/**
 * The names above must really return a bare array, or this branch is a fiction
 * that makes the probe disagree with the application it is probing. Checked
 * against the declaration rather than remembered — "the mock must match the
 * thing it replaces" is only a rule if something enforces it.
 */
const ARRAY_RETURNING_CONTRACTS: [string, string][] = [
    ['getMyNotifications', 'src/app/actions/my-data.ts'],
];
function isNotAnAction(name: string | symbol): boolean {
    return typeof name === 'symbol' || name === 'then';
}
for (const m of ['disputes', 'notifications', 'certificates', 'marketplace', 'farm-nation',
                 'land-listings', 'orders', 'my-data', 'user', 'profile', 'academy',
                 'wave', 'upload', 'saved-items', 'village-market', 'reviews']) {
    jest.mock(`@/app/actions/${m}`, () => new Proxy({ __esModule: true }, {
        get: (_t, name: string | symbol) => (
            name === '__esModule' ? true
                : isNotAnAction(name) ? undefined
                    : ARRAY_RETURNING.test(String(name)) ? (async () => [...ROWS])
                        : act_
        ),
    }));
}

/**
 * Press every enabled control, then report what happened.
 *
 * Named rather than inlined, and exercised against screens whose behaviour this
 * file controls, because A MUTANT THAT DELETES AN ASSERTION ALWAYS SURVIVES —
 * #599, #600, #602 and #609 each recorded that, and #609 is where the shape of
 * this function came from.
 */
async function pressAndObserve(
    container: HTMLElement,
): Promise<{ pressed: number; changed: boolean; states: string[] }> {
    const before = container.textContent ?? '';
    const controls = Array.from(container.querySelectorAll('button'))
        .filter(b => !(b as HTMLButtonElement).disabled);

    //   EVERY STATE ALONG THE WAY, NOT ONLY THE LAST ONE.
    //
    //   Pressing every button includes the destructive ones. On
    //   /dashboard/notifications the probe pressed Delete, removed the very row
    //   it was testing, and then ended on the "Orders" filter — so the run with a
    //   row and the run without one finished in the same empty screen and the
    //   differential below called the whole thing vacuous. It was not: the row
    //   rendered perfectly well, and was then deleted by the instrument.
    //
    //   The sequence is the honest measurement. It asks whether the row was
    //   visible AT ANY POINT while the screen was operated, which is the question
    //   the differential is actually for.
    const states: string[] = [before];
    for (const b of controls) {
        await act(async () => {
            fireEvent.click(b);
            await new Promise(r => setTimeout(r, 20));
        });
        states.push(container.textContent ?? '');
    }
    //   Settle whether or not anything was pressed, or a screen still loading is
    //   measured before it has loaded and reported unchanged. #609's gap.
    await act(async () => { await new Promise(r => setTimeout(r, 30)); });
    states.push(container.textContent ?? '');
    return { pressed: controls.length, changed: (container.textContent ?? '') !== before, states };
}

function isProperlyExercised(o: { pressed: number; changed: boolean }): boolean {
    return o.pressed > 0 && o.changed;
}

/** True when the hostile row was visible at some point during the operation. */
function rowWasSeen(withRow: string[], withoutRow: string[]): boolean {
    return withRow.join('\u0000') !== withoutRow.join('\u0000');
}

/** The same seed with every list emptied — the other half of the differential. */
function emptySeed(seed: any): any {
    if (Array.isArray(seed)) return [];
    if (seed && typeof seed === 'object') {
        const out: any = {};
        for (const [k, v] of Object.entries(seed)) out[k] = emptySeed(v);
        return out;
    }
    return seed;
}

/** Each seeded screen, and the bare seed its own prop shape requires. */
const SEEDED_WITH_TABS: [string, string, any][] = [
    ['dashboard/notifications', '@/app/dashboard/notifications/NotificationsClient', [ROW]],
    ['dashboard/disputes', '@/app/dashboard/disputes/DisputesClient', [ROW]],
    ['dashboard/certificates', '@/app/dashboard/certificates/CertificatesClient',
        { academy: [ROW], uploaded: [ROW] }],
    ['farm-nation/my-purchases', '@/app/farm-nation/(member)/my-purchases/MyPurchasesClient', [ROW]],
    ['marketplace/sell', '@/app/marketplace/sell/SellerHomeClient',
        { productsRes: answer(), verificationRes: answer() }],
    ['marketplace/seller/products', '@/app/marketplace/seller/products/SellerProductsClient', answer()],
];

beforeEach(() => {
    jest.clearAllMocks();
    ROWS = [ROW];
    (global as any).fetch = jest.fn(async () => ({
        ok: true, status: 200, json: async () => answer(), text: async () => JSON.stringify(answer()),
    }));
    (window as any).confirm = jest.fn(() => true);
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#611 — every tab of a seeded member screen, against a row with only an id', () => {
    for (const [name, mod, seed] of SEEDED_WITH_TABS) {
        it(`${name} SURVIVES EVERY TAB AND CONTROL`, async () => {
            const { default: Screen } = await import(mod);

            ROWS = [ROW];
            const { container } = render(<Screen initial={seed} />);
            const observed = await pressAndObserve(container);
            const summary = { pressed: observed.pressed, changed: observed.changed };
            expect({ name, ...summary, exercised: isProperlyExercised(observed) })
                .toEqual({ name, ...summary, exercised: true });

            //   AND THE ROW HAS TO HAVE REACHED THE PRESSED STATE. "Something
            //   changed" is satisfied by a spinner clearing, so on its own it
            //   proves the screen was operated and NOT that the hostile row was
            //   anywhere near the tab that was opened. This is #601's differential
            //   vacuity guard applied to the state AFTER the clicking: press the
            //   same screen with a row and with none, and require the two results
            //   to differ. If they are identical the fixture never got in, and
            //   surviving proves nothing about a row.
            ROWS = [];
            const { container: empty } = render(<Screen initial={emptySeed(seed)} />);
            const withoutRow = await pressAndObserve(empty);
            ROWS = [ROW];
            expect({ name, rowReachedTheTabs: rowWasSeen(observed.states, withoutRow.states) })
                .toEqual({ name, rowReachedTheTabs: true });
        });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#611 — the mock agrees with the action it replaces', () => {
    it.each(ARRAY_RETURNING_CONTRACTS)('%s really is declared to return an array', (name, file) => {
        const src = readFileSync(join(process.cwd(), file), 'utf8');
        const decl = new RegExp(`function ${name}\\([^)]*\\)\\s*:\\s*Promise<([^>]*)>`).exec(src);
        expect(decl).not.toBeNull();
        expect(decl![1].trim()).toMatch(/\[\]$/);
        //   And the pattern that gives it an array actually matches its name, so
        //   the two halves cannot drift apart.
        expect(ARRAY_RETURNING.test(name)).toBe(true);
    });

    it('AND THE PATTERN DOES NOT MATCH AN ENVELOPE-RETURNING ACTION', () => {
        //   A positive control on the pattern: without this, `/.*/ ` would pass
        //   the test above and hand every reader a bare array.
        expect(ARRAY_RETURNING.test('getMyDisputesAction')).toBe(false);
        expect(ARRAY_RETURNING.test('getSellerProductsAction')).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#611 — the instrument, against screens whose behaviour is known', () => {
    function Tabs() {
        const [tab, setTab] = React.useState('a');
        return (
            <div>
                <button onClick={() => setTab('a')}>A</button>
                <button onClick={() => setTab('b')}>B</button>
                <span>showing {tab}</span>
            </div>
        );
    }
    function DeadTabs() {
        return <div><button onClick={() => { /* deliberately */ }}>A</button><span>showing a</span></div>;
    }
    function NoControls() {
        return <div><span>showing a</span></div>;
    }
    function DisabledOnly() {
        return <div><span>showing a</span><button disabled>A</button></div>;
    }
    function LoadsByItself() {
        const [n, setN] = React.useState(0);
        React.useEffect(() => { const t = setTimeout(() => setN(1), 5); return () => clearTimeout(t); }, []);
        return <div><span>loaded {n}</span></div>;
    }

    it('SWITCHES THE TAB AND NOTICES', async () => {
        const { container } = render(<Tabs />);
        const observed = await pressAndObserve(container);
        expect({ pressed: observed.pressed, changed: observed.changed }).toEqual({ pressed: 2, changed: true });
        //   And the sequence records each state along the way — the entry the
        //   differential compares, and the reason a destructive button no longer
        //   erases the evidence it was testing.
        expect(observed.states.length).toBe(4);
        expect(observed.states[observed.states.length - 1]).toContain('showing b');
        expect(isProperlyExercised(observed)).toBe(true);
    });

    it('AND A TAB THAT DOES NOTHING IS NOT AN EXERCISED SCREEN', async () => {
        const observed = await pressAndObserve(render(<DeadTabs />).container);
        expect({ pressed: observed.pressed, changed: observed.changed }).toEqual({ pressed: 1, changed: false });
        expect(isProperlyExercised(observed)).toBe(false);
    });

    it('AND A SCREEN WITH NO CONTROLS IS NOT ONE EITHER', async () => {
        const observed = await pressAndObserve(render(<NoControls />).container);
        expect({ pressed: observed.pressed, changed: observed.changed }).toEqual({ pressed: 0, changed: false });
        expect(isProperlyExercised(observed)).toBe(false);
    });

    it('AND A DISABLED CONTROL IS NOT A PRESSED ONE', async () => {
        //   Otherwise a screen whose only control is greyed out reports itself
        //   exercised — the same lie in a quieter voice. A mutant that deleted the
        //   disabled filter SURVIVED until this fixture existed, because nothing
        //   else here has a disabled button.
        const observed = await pressAndObserve(render(<DisabledOnly />).container);
        expect({ pressed: observed.pressed, changed: observed.changed }).toEqual({ pressed: 0, changed: false });
    });

    it('AND rowWasSeen COMPARES THE WHOLE SEQUENCE, NOT THE ENDING', async () => {
        //   The differential is a function now, so a mutant has code to be wrong
        //   about — `expect(rowReachedTheTabs)` alone could be deleted and nothing
        //   would notice, which is the lesson #599, #600, #602 and #609 each
        //   recorded.
        expect(rowWasSeen(['a', 'b', 'c'], ['a', 'b', 'c'])).toBe(false);

        //   The case the whole rewrite is for: identical endings, different
        //   middles. /dashboard/notifications ends empty either way because this
        //   probe presses Delete; the row was plainly there beforehand.
        expect(rowWasSeen(['a', 'ROW', 'empty'], ['a', 'nothing', 'empty'])).toBe(true);

        //   And a difference only at the end still counts.
        expect(rowWasSeen(['a', 'b'], ['a', 'c'])).toBe(true);
    });

    it('AND A SCREEN THAT CHANGES ON ITS OWN IS NOT AN EXERCISED SCREEN', async () => {
        //   The case that separates the two clauses. Without it, dropping
        //   `pressed > 0` changes no answer — #609 shipped that gap and a mutant
        //   found it there.
        const observed = await pressAndObserve(render(<LoadsByItself />).container);
        expect({ pressed: observed.pressed, changed: observed.changed }).toEqual({ pressed: 0, changed: true });
        expect(isProperlyExercised(observed)).toBe(false);
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored and diffed after each.
 *
 *     MUTANT                                                        RESULT
 *     pressAndObserve: press nothing                                 KILLED
 *     pressAndObserve: count disabled controls as pressed            KILLED
 *     pressAndObserve: record only the final state                   KILLED
 *     isProperlyExercised: drop the `changed` clause                 KILLED
 *     isProperlyExercised: drop the `pressed > 0` clause             KILLED
 *     rowWasSeen: return true always                                 KILLED
 *     rowWasSeen: compare only the last state                        KILLED
 *     ARRAY_RETURNING: match every action name                       KILLED
 *
 *     SURVIVED, AND RECORDED RATHER THAN DRESSED UP
 *     the ARRAY_RETURNING branch deleted entirely                    SURVIVED —
 *                   the branch makes the mock agree with an action declared
 *                   `Promise<any[]>`, and the contract test above pins the
 *                   PATTERN against that declaration. But no screen assertion
 *                   needs the branch any more: it was added to rescue
 *                   /dashboard/notifications from a vacuous pass, and the
 *                   sequence comparison that replaced the final-state comparison
 *                   rescues that case independently. It is kept because a mock
 *                   that contradicts its action is a trap for the next reader,
 *                   not because anything here would fail without it. That is a
 *                   different thing from #598's dead exclusion, which never fired
 *                   at all — this one fires, it simply is not load-bearing.
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                             SURVIVED ✓
 *
 *   THE PROBE FOUND NO DEFECT IN THE SIX SCREENS, AND THAT IS THE RESULT. What
 *   it found instead was three faults in ITSELF, each of which had produced a
 *   confident wrong answer first:
 *
 *     the seed went empty for the second render while the MOCK kept answering
 *     with a row, so the two runs converged and the guard called a good screen
 *     vacuous;
 *
 *     `getMyNotifications` returns a bare array and the shared answer is an
 *     envelope, so "Show more" emptied the list — #604's /admin/cms shape again;
 *
 *     and pressing EVERY button includes Delete, so the probe removed the row it
 *     was testing and then compared two empty screens. The row had rendered
 *     perfectly well in between.
 *
 *   Each of those looked exactly like a defect on the screen. AUDIT THE
 *   INSTRUMENT BEFORE BELIEVING THE MEASUREMENT — three times in one file.
 */
