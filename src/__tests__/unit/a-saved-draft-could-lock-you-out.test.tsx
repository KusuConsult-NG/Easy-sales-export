/**
 * @jest-environment jsdom
 */

/**
 *   #625 A SAVED DRAFT COULD LOCK A USER OUT OF A FLOW FOR GOOD.
 *
 *   The first of the interaction-path tests, and it found this immediately.
 *   Everything before it asked what a screen does on ARRIVAL — #619 what chrome
 *   it wears, #620 and #622 what it does when its read fails. None of them ever
 *   pressed anything, so none could see a flow that is fine on step one and
 *   impossible on step eight.
 *
 *   Four flows save progress to localStorage and restore it on mount: the WAVE
 *   application and the marketplace, export and farm-nation onboardings. All
 *   four took the saved step at its word, and all four render their steps
 *   through a `switch` or a chain of `currentStep === N &&` WITH NO DEFAULT. A
 *   step outside the range matches nothing and renders nothing.
 *
 * ── WHAT IT LOOKS LIKE, MEASURED ────────────────────────────────────────────
 *
 *   The WAVE application is the worst of the four, and these are its own
 *   numbers, taken by rendering it with a poisoned draft:
 *
 *     saved step 0     14,061 chars of HTML, "Step 1 of 7", 2 buttons
 *     saved step 3     11,799 chars,          "Step 4 of 7", 3 buttons
 *     saved step 7      5,364 chars,           no indicator, ZERO BUTTONS
 *     saved step 99     5,364 chars,           no indicator, ZERO BUTTONS
 *     saved step -1     3,874 chars,          "Step 0 of 7", 1 dead button
 *
 *   Nothing to click. The navigation block is itself conditional on
 *   `currentStep < 6`, so the Back button vanishes along with the step content.
 *
 *   AND RELOADING DOES NOT HELP, which is what turns a glitch into a lockout:
 *   the page restores the same draft and lands on the same dead step. Short of
 *   clearing site data, that user cannot apply to WAVE again — and "clear your
 *   site data" is not an instruction a support queue can give 30,000 people.
 *
 *   The -1 case is the same trap in miniature: "Step 0 of 7", which is not a
 *   step, over an empty card, with a Back button that does nothing because
 *   prevStep requires `currentStep > 0`.
 *
 * ── HOW IT HAPPENS WITHOUT ANYBODY TAMPERING ────────────────────────────────
 *
 *   Remove a step from any of these flows and every draft saved at the old last
 *   step is instantly out of range. Drafts outlive the deploy and nothing
 *   migrates them. An ordinary product change becomes a support queue, and the
 *   people affected are exactly the ones who got furthest.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import React from 'react';
import { readFileSync } from 'fs';
import { join } from 'path';
import { render, act } from '@testing-library/react';
import { restoredStepIndex, restoredStepId } from '@/lib/draft-step';

jest.mock('@/lib/redis', () => require('@/lib/testing/sweep-stubs').libRedis());
jest.mock('@upstash/redis', () => require('@/lib/testing/sweep-stubs').upstashRedis());
jest.mock('next-auth/react', () => require('@/lib/testing/sweep-stubs').nextAuthReact());
jest.mock('isomorphic-dompurify', () => require('@/lib/testing/sweep-stubs').dompurify());

const ROUTER = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), refresh: jest.fn(), prefetch: jest.fn() };
jest.mock('next/navigation', () => ({
    useRouter: () => ROUTER,
    usePathname: () => '/',
    useSearchParams: () => new URLSearchParams(),
    useParams: () => ({}),
}));
jest.mock('@/contexts/ToastContext', () => ({
    ToastProvider: ({ children }: any) => children,
    useToast: () => ({ showToast: jest.fn() }),
}));

//   The session the sweep stubs hand out; the draft key is scoped by user id.
const USER_ID = 'sweep-user';

interface Flow {
    name: string;
    module: string;
    draftKey: string;
    /**
     * The server seed that puts this flow on its "fresh applicant" branch.
     *
     * Three of the four only restore a draft inside an `else` that is reached
     * after an async status check. Without this the restore never runs at all —
     * which is exactly how the first version of this file passed while testing
     * nothing. See the note on the guard below.
     */
    seed?: unknown;
    /** A step this flow genuinely has, to prove the harness restores at all. */
    realStep: number | string;
    /** Positions it does not have, each of which used to render nothing. */
    poison: (number | string)[];
    /**
     * Can this flow be driven end-to-end in jsdom?
     *
     * Two of the four cannot, and it is a limit of the harness rather than of
     * the fix. Their restore sits behind an awaited status call that never
     * settles here even when seeded, so `act` hangs. Rather than pretend, they
     * are asserted at source and this file says which coverage each one has.
     */
    driveable: boolean;
}

const FLOWS: Flow[] = [
    {
        name: 'WAVE application',
        driveable: true,
        module: '@/app/wave/application/WaveApplicationClient',
        draftKey: `wave_app_draft_${USER_ID}`,
        realStep: 3,
        poison: [7, 99, -1, 2.5, NaN],
    },
    {
        name: 'Marketplace onboarding',
        driveable: false,
        module: '@/app/marketplace/onboarding/MarketplaceOnboardingClient',
        //   `marketplace_draft_`, not `marketplace_onboarding_draft_`. The
        //   first version of this file had the latter, so nothing was ever
        //   restored and every case passed — the strengthened guard below is
        //   what caught it.
        draftKey: `marketplace_draft_${USER_ID}`,
        seed: { success: true, data: { status: "none", accountType: null } },
        realStep: 2,
        poison: [7, 99, 0, -1, NaN],
    },
    {
        name: 'Export onboarding',
        driveable: true,
        module: '@/app/export/onboarding/ExportOnboardingClient',
        draftKey: `export_draft_${USER_ID}`,
        seed: { success: true, data: { status: "none", application: null, hasAccess: null } },
        realStep: 'bank',
        poison: ['retired-step', '', 'PROFILE'],
    },
    {
        name: 'Farm Nation onboarding',
        driveable: false,
        module: '@/app/farm-nation/onboarding/FarmNationOnboardingClient',
        draftKey: `farmnation_draft_${USER_ID}`,
        seed: { success: true, data: "none" },
        realStep: 'interests',
        poison: ['retired-step', '', 'ROLE'],
    },
];

/**
 * Render a flow with a given step already in its saved draft, and report what a
 * user would actually find on the screen.
 *
 * `buttons` is the number that matters. A flow with nothing to click is one the
 * user cannot leave, and — because the draft survives the reload — cannot
 * escape by refreshing either.
 */
async function openWithDraft(flow: Flow, step: number | string | undefined) {
    localStorage.clear();
    if (step !== undefined) {
        localStorage.setItem(flow.draftKey, JSON.stringify({ step, data: { surname: 'Okafor' } }));
    }

    /*
     *   NO jest.resetModules() HERE, and the reason is worth keeping: it was in
     *   the first draft and every single test failed with "Cannot read
     *   properties of null (reading 'useState')". Resetting the registry hands
     *   the component a FRESH React instance, separate from the one this file
     *   imported, so its hooks have no dispatcher. It also was not needed —
     *   each mount re-reads localStorage in its own effect.
     */
    const Client = require(flow.module).default;

    let container!: HTMLElement;
    await act(async () => {
        container = render(React.createElement(Client, { initial: flow.seed ?? null } as any)).container;
    });

    const enabled = [...container.querySelectorAll('button')].filter(b => !(b as HTMLButtonElement).disabled);
    return {
        container,
        enabledButtons: enabled.length,
        text: (container.textContent ?? '').replace(/\s+/g, ' ').trim(),
    };
}

beforeAll(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('#625 — the guard, asked with known answers', () => {
    /*
     *   The rule itself, before any screen. #620 learned that an assertion
     *   written over a corpus tests the corpus; these ask the function.
     */
    it('A STEP THE FLOW HAS IS ACCEPTED', () => {
        expect(restoredStepIndex(0, 7)).toBe(0);
        expect(restoredStepIndex(6, 7)).toBe(6);
        expect(restoredStepId('bank', ['profile', 'kyc', 'bank'])).toBe('bank');
    });

    it('AND ONE IT DOES NOT HAVE IS REFUSED, not clamped', () => {
        //   Clamping would put somebody on the last step of a form they never
        //   filled in. A position that cannot be trusted is not evidence of how
        //   far they got.
        expect(restoredStepIndex(7, 7)).toBeNull();
        expect(restoredStepIndex(99, 7)).toBeNull();
        expect(restoredStepIndex(-1, 7)).toBeNull();
        expect(restoredStepId('retired-step', ['profile', 'kyc'])).toBeNull();
    });

    it('AND NaN DOES NOT SLIP THROUGH A RANGE CHECK', () => {
        //   NaN is a number and defeats every comparison: `NaN < 0` is false and
        //   `NaN > 6` is false, so a plain range test admits it. This audit has
        //   been caught by that before, on money.
        expect(restoredStepIndex(NaN, 7)).toBeNull();
        expect(restoredStepIndex(Infinity, 7)).toBeNull();
        expect(restoredStepIndex(2.5, 7)).toBeNull();
    });

    it('AND NEITHER DOES A VALUE OF THE WRONG TYPE', () => {
        for (const junk of [null, undefined, '3', {}, [], true]) {
            expect(restoredStepIndex(junk, 7)).toBeNull();
            expect(restoredStepId(junk, ['profile'])).toBeNull();
        }
    });

    it('AND A ONE-BASED FLOW COUNTS FROM ONE', () => {
        //   The marketplace onboarding starts at 1, not 0. A shared helper that
        //   assumed 0 would refuse its first step and silently reset everyone.
        expect(restoredStepIndex(1, 6, 1)).toBe(1);
        expect(restoredStepIndex(6, 6, 1)).toBe(6);
        expect(restoredStepIndex(0, 6, 1)).toBeNull();
        expect(restoredStepIndex(7, 6, 1)).toBeNull();
    });
});

describe('#625 — and no saved draft leaves a flow with nothing to click', () => {
    for (const flow of FLOWS.filter(f => f.driveable)) {
        describe(flow.name, () => {
            it('RESTORES A REAL SAVED STEP — the guard on everything below', async () => {
                /*
                 *   THE FIRST VERSION OF THIS GUARD ONLY CHECKED THAT SOMETHING
                 *   WAS CLICKABLE, and it passed on all four flows while two of
                 *   them were not restoring drafts AT ALL — their restore sits
                 *   in an `else` behind an async status check the harness never
                 *   satisfied. Both rendered step one whatever the draft said,
                 *   so "a poisoned draft does not break it" was true and
                 *   meaningless. Mutation testing found it: putting the defect
                 *   back in those two flows changed nothing.
                 *
                 *   A restored draft has to CHANGE THE SCREEN. If it does not,
                 *   this flow is not being exercised and says so here rather
                 *   than reporting green from the poison cases below.
                 */
                const restored = await openWithDraft(flow, flow.realStep);
                const fresh = await openWithDraft(flow, undefined);

                expect(restored.enabledButtons).toBeGreaterThan(0);
                expect(restored.text).not.toEqual(fresh.text);
            });

            it.each(flow.poison)('AND SURVIVES A SAVED STEP OF %p', async (step) => {
                const { enabledButtons } = await openWithDraft(flow, step as number | string);

                //   The whole finding in one number. Zero meant a user stuck on
                //   an empty card that a reload restored them straight back to.
                expect({ step: String(step), enabledButtons: enabledButtons > 0 })
                    .toEqual({ step: String(step), enabledButtons: true });
            });
        });
    }
});

describe('#625 — the two flows that cannot be driven here, asserted at source', () => {
    /*
     *   STATED PLAINLY BECAUSE IT IS WEAKER COVERAGE. The marketplace and
     *   farm-nation onboardings restore their drafts inside an `else` reached
     *   after an awaited status call, and in jsdom that call never settles —
     *   even seeded — so `act` hangs rather than rendering. Driving them needs
     *   a fixture for each flow's whole server surface, which is a different
     *   piece of work.
     *
     *   What IS behaviourally tested for them: the guard itself, above, in full.
     *   What is only read: that each flow calls it. A string assertion pins a
     *   phrase rather than a behaviour — #618's lesson — so this is the floor,
     *   not the ceiling, and it is labelled as such.
     */
    const UNDRIVEABLE: [string, string, 'index' | 'id'][] = [
        ['Marketplace onboarding', 'src/app/marketplace/onboarding/MarketplaceOnboardingClient.tsx', 'index'],
        ['Farm Nation onboarding', 'src/app/farm-nation/onboarding/FarmNationOnboardingClient.tsx', 'id'],
    ];

    it.each(UNDRIVEABLE)('%s ASKS THE GUARD RATHER THAN TRUSTING THE DRAFT', (_name, path, shape) => {
        const src = readFileSync(join(process.cwd(), path), 'utf8');

        //   Two shapes, because two of these flows index their steps by number
        //   and two by string id. Asserting the wrong one passes vacuously.
        const guard = shape === 'index' ? 'restoredStepIndex(parsed.step' : 'restoredStepId(parsed.step';
        const setter = shape === 'index' ? 'setCurrentStep(savedStep)' : 'setCurrentStepId(savedStep)';
        const oldLine = shape === 'index'
            ? 'if (parsed.step) setCurrentStep(parsed.step)'
            : 'if (parsed.step) setCurrentStepId(parsed.step)';

        expect(src).toContain(guard);
        expect(src).toContain(`if (savedStep !== null) ${setter}`);
        //   And the line that caused this is gone.
        expect(src).not.toContain(oldLine);
    });

    it('AND THE TWO SHAPES ARE BOTH REPRESENTED, so neither assertion is vacuous', () => {
        expect(UNDRIVEABLE.map(u => u[2]).sort()).toEqual(['id', 'index']);
    });

    it('AND BOTH DRIVEABLE FLOWS REALLY ARE DRIVEN, so this is not the only coverage', () => {
        //   Vacuity guard on the split itself: if every flow were marked
        //   undriveable, the block above would be the whole file and it would
        //   look complete.
        expect(FLOWS.filter(f => f.driveable).map(f => f.name))
            .toEqual(['WAVE application', 'Export onboarding']);
    });
});

describe('#625 — and nothing the user typed is thrown away', () => {
    it('THE DATA IS RESTORED EVEN WHEN THE POSITION IS REFUSED', async () => {
        /*
         *   The cost of refusing rather than clamping, and the reason it is
         *   acceptable: the user starts at step one again, but their answers are
         *   still there. Discarding the DATA as well would make this fix a
         *   second, quieter version of the bug it repairs.
         */
        const { container } = await openWithDraft(FLOWS[0], 99);
        expect(container.innerHTML).toContain('Okafor');
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored and diffed after each.
 *
 *     MUTANT                                                        RESULT
 *     THE DEFECT: WAVE trusts the saved step again                   KILLED
 *     THE DEFECT: marketplace trusts it again                        KILLED
 *     THE DEFECT: export trusts it again                             KILLED
 *     THE DEFECT: farm-nation trusts it again                        KILLED
 *     the guard clamps instead of refusing                           KILLED
 *     NaN slips through (Number.isInteger dropped)                   KILLED
 *     the id guard accepts anything                                  KILLED
 *     the one-based offset is ignored                                KILLED
 *     the guard refuses EVERYTHING (resets every user)               KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                             SURVIVED ✓
 *
 *   The last one is the way this fix becomes its own outage: a guard that
 *   refuses every saved position sends every user in every flow back to step
 *   one, silently, and looks like a fix while doing it.
 *
 * ── THE FIRST RUN FOUND THIS FILE TESTING TWO FLOWS AND CLAIMING FOUR ───────
 *
 *   Putting the defect back into the marketplace and farm-nation flows SURVIVED.
 *   Both restore their drafts inside an `else` reached after an awaited status
 *   call that the harness never satisfied, so neither ever restored anything;
 *   they rendered step one whatever the draft said, and "a poisoned draft does
 *   not break it" was true and empty.
 *
 *   THE VACUITY GUARD PASSED TOO, because it only asked whether something was
 *   clickable — and step one has buttons. It now requires a restored draft to
 *   CHANGE THE SCREEN against the same flow opened with no draft, which is the
 *   assertion that would have caught it. Rewriting it immediately found a second
 *   fault: the marketplace draft key in this file was `marketplace_onboarding_draft_`
 *   and the application writes `marketplace_draft_`, so that flow had never
 *   been handed a draft at all.
 *
 *   Two of the four still cannot be driven in jsdom and are asserted at source
 *   instead, which is weaker and is labelled as such above rather than counted
 *   as the same thing.
 *
 *   AND ONE MORE, EARLIER: every test in the first version failed with "Cannot
 *   read properties of null (reading 'useState')". `jest.resetModules()` in the
 *   mount helper handed each component a FRESH React instance, so its hooks had
 *   no dispatcher. Ninth instrument fault in this sweep; the pattern is that a
 *   harness fails in ways that read as application defects.
 */
