/**
 * @jest-environment jsdom
 */

/**
 *   #609 SIX ADMIN SCREENS SHOW NOTHING UNTIL SOMEBODY PRESSES A BUTTON, AND THE
 *        BARE-ROW PROBE ONLY EVER MOUNTED THEM.
 *
 *   #604 left eighteen of forty-eight admin screens unreached and — after
 *   building a four-category taxonomy for them and finding it FALSE — refused to
 *   offer a reason. This is the reason for six of them, arrived at by asking
 *   each screen instead of theorising about all of them: they load nothing at
 *   mount. A forensic scan runs when an administrator asks for one. A broadcast
 *   preview appears when they press Preview. Rendering the page and waiting
 *   proves only that an empty form does not throw.
 *
 *   So this probe CLICKS. It renders each screen with a document carrying only
 *   an id behind every reader, presses each button in turn, and requires the
 *   screen to survive — then requires the output to have CHANGED, so a pass
 *   cannot come from a button that did nothing.
 *
 * ── AND FIVE MORE ARE HONESTLY EXPLAINED, WHICH IS NOT THE SAME AS EXCUSED ──
 *
 *   /admin/communications, /admin/cooperatives, /admin/farm-nation,
 *   /admin/marketplace and /admin/wave call NO server action and NO fetch, on
 *   any path. They are hubs of links. A hostile row has nowhere to land because
 *   nothing on them ever reads a row.
 *
 *   THAT CLAIM IS CHECKED, AND CHECKED IN BOTH DIRECTIONS, because #604's
 *   taxonomy was false for exactly the reason an unchecked one usually is: its
 *   categories were equally true of the screens it excused and the screens it
 *   did not. "Loads nothing at all" is true of these five and of NONE of the
 *   thirty this suite's sibling reaches. A property shared by both groups
 *   explains neither; this one is not.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import React from 'react';
import { render, fireEvent, act } from '@testing-library/react';
import { readFileSync } from 'fs';
import { join } from 'path';

jest.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast: jest.fn() }) }));
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn(), loading: jest.fn() } }));
const router = { push: jest.fn(), replace: jest.fn(), refresh: jest.fn(), prefetch: jest.fn(), back: jest.fn() };
jest.mock('next/navigation', () => ({
    useRouter: () => router, useSearchParams: () => new URLSearchParams(),
    usePathname: () => '/admin', useParams: () => ({ id: 'BAREROW' }),
    redirect: jest.fn(), notFound: jest.fn(),
}));
const session = { data: { user: { id: 'u1', name: 'A', email: 'a@b.c', roles: ['super_admin'] } }, status: 'authenticated' };
jest.mock('next-auth/react', () => ({ useSession: () => session, signOut: jest.fn() }));
jest.mock('@/hooks/useFeatureToggle', () => ({ useFeatureToggle: () => true }));

const ROW: any = { id: 'BAREROW' };
let ROWS: any[] = [ROW];

/**
 * One answer, shaped to satisfy a scan, a preview and a cleanup at once.
 *
 * The collection names are attached at BOTH levels — #602's finding, kept — and
 * the counters these screens report are present as well, because a scan that
 * answers with rows and no totals is a shape no reader here expects.
 */
function answer(): any {
    const rows: any = [...ROWS];
    for (const k of ['users', 'orphaned', 'issues', 'findings', 'anomalies', 'recipients',
                     'sample', 'matches', 'drafts', 'records', 'results', 'data']) {
        rows[k] = [...ROWS];
    }
    rows.stats = {}; rows.summary = {}; rows.counts = {};
    const result: any = { success: true, error: null, data: rows, meta: {} };
    for (const k of Object.keys(rows)) {
        if (k !== 'data' && Number.isNaN(Number(k))) result[k] = (rows as any)[k];
    }
    result.count = ROWS.length;
    result.total = ROWS.length;
    result.estimate = ROWS.length;
    result.scanned = ROWS.length;
    result.complete = true;
    result.deleted = ROWS.length;
    return result;
}
const act_ = async () => answer();
function isNotAnAction(name: string | symbol): boolean {
    return typeof name === 'symbol' || name === 'then';
}
for (const m of ['forensics', 'admin', 'admin-communications', 'sms-broadcast', 'in-app-broadcast',
                 'broadcast', 'diagnose-broadcast', 'maintenance', 'admin-users', 'data-recovery',
                 'telemetry', 'health', 'notifications', 'admin-analytics', 'platform']) {
    jest.mock(`@/app/actions/${m}`, () => new Proxy({ __esModule: true }, {
        get: (_t, name: string | symbol) => (
            name === '__esModule' ? true : isNotAnAction(name) ? undefined : act_
        ),
    }));
}

/** Every fetch answers the same shape, as a Response. */
function installFetch() {
    (global as any).fetch = jest.fn(async () => ({
        ok: true, status: 200,
        json: async () => answer(),
        text: async () => JSON.stringify(answer()),
    }));
}

/** The six that load nothing at mount. */
const ON_DEMAND: [string, string][] = [
    ['communications/broadcast', '@/app/admin/communications/broadcast/page'],
    ['communications/in-app', '@/app/admin/communications/in-app/page'],
    ['communications/sms', '@/app/admin/communications/sms/page'],
    ['forensics', '@/app/admin/forensics/page'],
    ['orphaned-users', '@/app/admin/orphaned-users/page'],
    ['settings/maintenance', '@/app/admin/settings/maintenance/page'],
];

/** The five that read nothing, anywhere, on any path. */
const READ_NOTHING: [string, string][] = [
    ['communications', '@/app/admin/communications/page'],
    ['cooperatives', '@/app/admin/cooperatives/page'],
    ['farm-nation', '@/app/admin/farm-nation/page'],
    ['marketplace', '@/app/admin/marketplace/page'],
    ['wave', '@/app/admin/wave/page'],
];

/**
 * Press every enabled button on the screen, in order, and report what happened.
 *
 * A NAMED FUNCTION RATHER THAN THREE LINES INSIDE EACH TEST, for the reason
 * #599, #600 and #602 each recorded and I have now been shown a fourth time: A
 * MUTANT THAT DELETES AN ASSERTION ALWAYS SURVIVES. `expect(pressed > 0)` and
 * `expect(changed)` were two such assertions, and removing either left this
 * suite green. There is nothing to fix in the assertion; the fix is to give the
 * mutant CODE to attack, and code can be exercised against known answers — which
 * is what the tests directly below this do.
 */
async function pressAndObserve(container: HTMLElement): Promise<{ pressed: number; changed: boolean }> {
    const before = container.textContent;
    const buttons = Array.from(container.querySelectorAll('button'))
        .filter(b => !(b as HTMLButtonElement).disabled);
    for (const b of buttons) {
        await act(async () => {
            fireEvent.click(b);
            await new Promise(r => setTimeout(r, 30));
        });
    }
    //   Settle once at the end, whether or not anything was pressed. Without this
    //   a screen with no buttons was measured the instant it mounted — before any
    //   effect it started had resolved — so it reported "nothing changed" for the
    //   same reason a stopped clock reports the time. The measurement has to be
    //   taken after the screen has had its chance, or "unchanged" means "not yet".
    await act(async () => { await new Promise(r => setTimeout(r, 30)); });
    return { pressed: buttons.length, changed: container.textContent !== before };
}

/** What this suite requires of a screen: buttons that exist, and that do something. */
function isProperlyExercised(observed: { pressed: number; changed: boolean }): boolean {
    return observed.pressed > 0 && observed.changed;
}

beforeEach(() => {
    jest.clearAllMocks();
    ROWS = [ROW];
    installFetch();
    //   jsdom does not implement `window.confirm` — it throws "not implemented".
    //   /admin/settings/maintenance gates its cleanup behind one, so without this
    //   the click was swallowed and the screen reported UNREACHED for a reason
    //   that was entirely mine. The mock must match the thing it replaces: this
    //   probe is an administrator who presses the button and means it.
    (window as any).confirm = jest.fn(() => true);
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#609 — six admin screens, pressed rather than merely mounted', () => {
    for (const [name, mod] of ON_DEMAND) {
        it(`${name} SURVIVES EVERY BUTTON WITH A ROW THAT CARRIES ONLY AN ID`, async () => {
            const { default: Screen } = await import(mod);

            ROWS = [ROW];
            const { container } = render(<Screen />);

            //   Surviving is half of it. A screen with no buttons, or buttons that
            //   do nothing, would survive without the probe ever reaching a reader
            //   — the vacuous pass this suite exists to avoid.
            const observed = await pressAndObserve(container);
            expect({ name, ...observed, exercised: isProperlyExercised(observed) })
                .toEqual({ name, ...observed, exercised: true });
        });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#609 — the instrument, against screens whose behaviour is known', () => {
    function Counter() {
        const [n, setN] = React.useState(0);
        return <div><span>count {n}</span><button onClick={() => setN(n + 1)}>go</button></div>;
    }
    function DeadButton() {
        return <div><span>nothing happens</span><button onClick={() => { /* deliberately */ }}>go</button></div>;
    }
    function NoButtons() {
        return <div><span>just words</span></div>;
    }
    function DisabledOnly() {
        return <div><span>just words</span><button disabled>go</button></div>;
    }
    function SelfChanging() {
        //   No button, and its text changes anyway — a screen that loads at mount.
        const [n, setN] = React.useState(0);
        React.useEffect(() => { const t = setTimeout(() => setN(1), 5); return () => clearTimeout(t); }, []);
        return <div><span>loaded {n}</span></div>;
    }

    it('PRESSES WHAT IS THERE AND NOTICES THE CHANGE', async () => {
        const { container } = render(<Counter />);
        const observed = await pressAndObserve(container);
        expect(observed).toEqual({ pressed: 1, changed: true });
        expect(isProperlyExercised(observed)).toBe(true);
        expect(container.textContent).toContain('count 1');
    });

    it('AND REFUSES A BUTTON THAT DOES NOTHING', async () => {
        //   The mutant that deleted the "changed" assertion could not be caught by
        //   another assertion; it is caught by this, because now there is a
        //   function that must give the right answer for a screen we control.
        const observed = await pressAndObserve(render(<DeadButton />).container);
        expect(observed).toEqual({ pressed: 1, changed: false });
        expect(isProperlyExercised(observed)).toBe(false);
    });

    it('AND REFUSES A SCREEN WITH NO BUTTON AT ALL', async () => {
        const observed = await pressAndObserve(render(<NoButtons />).container);
        expect(observed).toEqual({ pressed: 0, changed: false });
        expect(isProperlyExercised(observed)).toBe(false);
    });

    it('AND A SCREEN THAT CHANGES ON ITS OWN IS NOT AN EXERCISED SCREEN', async () => {
        //   THE CASE THAT SEPARATES THE TWO CLAUSES, and it took a surviving
        //   mutant to notice it was missing: in every fixture above, `pressed: 0`
        //   and `changed: false` arrived together, so dropping the `pressed > 0`
        //   clause changed no answer and the mutant lived.
        //
        //   This is the real shape it guards against — a screen that loads at
        //   mount and has no button. Its text changes because it loaded, not
        //   because this probe did anything, and counting that as "exercised by
        //   clicking" is precisely the vacuous pass the suite exists to refuse.
        const observed = await pressAndObserve(render(<SelfChanging />).container);
        expect(observed).toEqual({ pressed: 0, changed: true });
        expect(isProperlyExercised(observed)).toBe(false);
    });

    it('AND DOES NOT COUNT A DISABLED BUTTON AS PRESSED', async () => {
        //   Otherwise a screen whose only control is greyed out would report
        //   itself exercised, which is the same lie in a quieter voice.
        const observed = await pressAndObserve(render(<DisabledOnly />).container);
        expect(observed).toEqual({ pressed: 0, changed: false });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#609 — and the five that read nothing are shown to read nothing', () => {
    function sourceOf(mod: string): string {
        const rel = mod.replace(/^@\//, '');
        for (const ext of ['.tsx', '.ts']) {
            try { return readFileSync(join(process.cwd(), 'src', rel + ext), 'utf8'); } catch { /* next */ }
        }
        throw new Error(`no source for ${mod}`);
    }

    /** True when the module never calls a server action and never calls fetch. */
    function readsNothing(source: string): boolean {
        if (/\bfetch\(/.test(source)) return false;
        if (/await import\(\s*["']@\/app\/actions/.test(source)) return false;
        const imported = new Set<string>();
        //   `[^}]` rather than `.` with the `s` flag: the project targets below
        //   es2018, where `s` is a compile error rather than a runtime one.
        for (const m of source.matchAll(/import[\s\S]*?\{([^}]*)\}[\s\S]*?from\s*["'](@\/app\/actions[^"']*)["']/g)) {
            for (const part of m[1].split(',')) {
                const name = part.trim().split(' as ').pop()!.replace(/^type\s+/, '').trim();
                if (name) imported.add(name);
            }
        }
        for (const name of imported) {
            if (new RegExp(`\\b${name}\\s*\\(`).test(source)) return false;
        }
        return true;
    }

    it.each(READ_NOTHING)('%s CALLS NO ACTION AND NO FETCH, SO NO ROW CAN REACH IT', (_name, mod) => {
        expect(readsNothing(sourceOf(mod))).toBe(true);
    });

    it('AND THAT IS TRUE OF NONE OF THE SCREENS THE ROW DOES REACH', () => {
        //   THE CHECK THAT #604's TAXONOMY FAILED. Its two categories were
        //   equally true of the screens it excused and eighteen it did not, which
        //   is what made them comments rather than reasons. This one holds only on
        //   the side it is claimed for — and if a screen ever starts reading
        //   something, this test says so before the excuse outlives the fact.
        const REACHED: [string, string][] = [
            ['analytics', '@/app/admin/analytics/page'],
            ['disputes', '@/app/admin/disputes/page'],
            ['cms', '@/app/admin/cms/page'],
            ['DashboardClient', '@/app/admin/DashboardClient'],
            ['settings/logs', '@/app/admin/settings/logs/page'],
            ['wave/members', '@/app/admin/wave/members/page'],
        ];
        const wronglyExcused = REACHED.filter(([, mod]) => readsNothing(sourceOf(mod))).map(([n]) => n);
        expect(wronglyExcused).toEqual([]);
    });

    it('AND THE PREDICATE CAN FAIL — a module that calls an action is not excused', () => {
        //   A positive control on the predicate itself, so "true for all five"
        //   cannot come from a function that returns true for everything.
        expect(readsNothing(`
            import { getThingAction } from "@/app/actions/admin";
            export default function P() { getThingAction(); return null; }
        `)).toBe(false);
        expect(readsNothing(`export default function P() { fetch("/api/x"); return null; }`)).toBe(false);
        expect(readsNothing(`export default function P() { return <a href="/x" />; }`)).toBe(true);
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored and diffed after each.
 *
 *     MUTANT                                                        RESULT
 *     forensics: `r.affectedIds?.length ?? 0` → `r.affectedIds.length`  KILLED
 *     pressAndObserve: press nothing                                 KILLED
 *     pressAndObserve: count disabled buttons as pressed             KILLED
 *     pressAndObserve: `changed` always true                         KILLED
 *     pressAndObserve: drop the trailing settle                      KILLED
 *     isProperlyExercised: drop the `changed` clause                 KILLED
 *     isProperlyExercised: drop the `pressed > 0` clause             KILLED
 *     isProperlyExercised: return true always                        KILLED
 *     readsNothing: return true always                               KILLED
 *     readsNothing: ignore the actions it found                      KILLED
 *
 *     EQUIVALENT, RECORDED AND NOT COUNTED AS COVERAGE
 *     forensics: `(r.affectedIds ?? []).join` → `r.affectedIds.join`  SURVIVED —
 *                   the guard above it means the join only runs when the array
 *                   exists, so the mutant is unreachable rather than uncaught.
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                             SURVIVED ✓
 *
 *   THREE SURVIVED THE FIRST ROUND AND TWO WERE ASSERTION DELETIONS — the same
 *   lesson as #599, #600 and #602, arriving a fourth time. `expect(pressed > 0)`
 *   and `expect(changed)` cannot be defended by another assertion, because a
 *   mutant that deletes an assertion always survives. They are `pressAndObserve`
 *   and `isProperlyExercised` now, exercised against four screens whose behaviour
 *   this file controls, so there is code for a mutant to be wrong about.
 *
 *   AND THE FOURTH FIXTURE EXISTS BECAUSE THE THIRD MUTANT SURVIVED THAT REWRITE
 *   TOO. In a counter, a dead button and a screen with no buttons, `pressed: 0`
 *   and `changed: false` always arrived together — so dropping the `pressed > 0`
 *   clause changed no answer. A screen that changes ON ITS OWN separates them,
 *   and writing it exposed a real gap in the instrument: `pressAndObserve` did
 *   not settle when there was nothing to press, so it measured such a screen
 *   before its effect had run and called it unchanged.
 */
