/**
 * @jest-environment jsdom
 */

/**
 *   #626 ONE STEP OF THE WAVE APPLICATION COULD NOT REFUSE ANYTHING.
 *
 *   The second interaction-path test. #625 asked what happens when you ARRIVE at
 *   a step you should not be on; this asks what happens when you try to LEAVE
 *   one you have not filled in.
 *
 *   CivicStatusStep — Section B, National Identity & Civic Status — validated
 *   like this:
 *
 *       const validateForm = (): boolean => {
 *           setErrors({});
 *           return true;
 *       };
 *
 *   A check that cannot fail. Every line depending on it was therefore dead:
 *   handleNext's `else`, its "Please correct the errors in the form" toast, and
 *   its scroll-to-the-first-error. The NIN input is already wired with
 *   `error={errors.nin}`, so the field was built to display a message nothing
 *   could ever produce.
 *
 *   ITS FIVE SIBLINGS ALL VALIDATE PROPERLY. That is what makes this the
 *   audit's most familiar shape rather than an oversight: one of six doors.
 *
 * ── WHAT IT ACTUALLY COST ───────────────────────────────────────────────────
 *
 *   Not stored data. #501 put `nationalIdField('NIN')` on the submit schema, so
 *   a malformed or placeholder NIN was always refused by the server.
 *
 *   It cost an applicant their time, which on a seven-step government-style form
 *   is not a small thing: mistype the NIN on step 2, fill in five more steps,
 *   and get refused at the end — with the error arriving from a submit handler
 *   rather than beside the field that caused it.
 *
 *   #357 FOUND THE SAME SHAPE IN KYCForm — "this component imported
 *   isObviouslyFakeId and never called it" — and fixed it there. This is that
 *   finding one door along.
 *
 * ── THE FIX USES THE SERVER'S OWN RULE ──────────────────────────────────────
 *
 *   `nationalIdField('NIN')`, the same schema the submit action validates
 *   against, rather than a hand-written copy. Two copies of one contract is the
 *   other pattern this audit keeps finding, and the copy that drifts would be
 *   the client's — which produces a form that submits and then fails.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import React from 'react';
import { render, fireEvent, act } from '@testing-library/react';

jest.mock('@/contexts/ToastContext', () => ({
    ToastProvider: ({ children }: any) => children,
    useToast: () => ({ showToast: jest.fn() }),
}));

/*
 *   jsdom IMPLEMENTS NEITHER OF THESE, and their absence reads as a defect in
 *   the step. Every one of these steps, on refusing, scrolls to the first error
 *   — so the moment the fix started working, three steps "failed" with
 *   `firstError.scrollIntoView is not a function`. The step was refusing
 *   correctly; the browser it was refusing in had no scrolling.
 *
 *   Tenth instrument fault of this sweep, and the same shape as the rest: the
 *   harness breaks in a way that looks like the application.
 */
(Element.prototype as any).scrollIntoView = jest.fn();
(window as any).scrollTo = jest.fn();

//   Real, not stubbed: these steps read the location lists to populate their
//   ward and polling-unit selects, and a stub would hide a step that cannot
//   render its own fields.
const STEP_DIR = '@/app/wave/application/steps';

/**
 * A list read straight off `data` with nothing guarding it.
 *
 * Hoisted out of the ratchet so it can be ASKED QUESTIONS. Left inline, a mutant
 * that narrowed it back to the faulty version survived — with the code clean
 * nothing matches either way, so the corpus could not tell the two patterns
 * apart. #620's lesson, and the canary below is the same repair.
 */
const UNGUARDED_LIST_READ = /data\.[a-zA-Z]+\.(includes|map|filter|length|join|forEach|some|every)/g;

interface Step {
    name: string;
    module: string;
    /** Data that should NOT be enough to advance. */
    invalid: Record<string, unknown>;
}

/**
 * Every step of the WAVE application that has a Next button.
 *
 * ReviewStep is deliberately absent — it submits rather than advancing, and its
 * guard is handleSubmit's, tested where that lives.
 */
const STEPS: Step[] = [
    { name: 'PersonalDetailsStep', module: `${STEP_DIR}/PersonalDetailsStep`, invalid: {} },
    {
        name: 'CivicStatusStep',
        module: `${STEP_DIR}/CivicStatusStep`,
        //   Empty is ALLOWED here — the server's rule for nin is optional — so
        //   the refusable case is a NIN that is present and wrong.
        invalid: { nin: '11111111111' },
    },
    { name: 'SocioEconomicStep', module: `${STEP_DIR}/SocioEconomicStep`, invalid: {} },
    { name: 'AgriInterestStep', module: `${STEP_DIR}/AgriInterestStep`, invalid: {} },
    { name: 'FinancialStep', module: `${STEP_DIR}/FinancialStep`, invalid: {} },
    { name: 'TrainingStep', module: `${STEP_DIR}/TrainingStep`, invalid: {} },
];

/**
 * Render one step and press the control that moves forward.
 *
 * Returns whether the wizard was told to advance. That is the whole question: a
 * step whose validation cannot fail calls onNext for any data at all.
 */
async function pressNext(step: Step, data: Record<string, unknown>) {
    const Component = require(step.module).default;
    const onNext = jest.fn();
    const onBack = jest.fn();

    let container!: HTMLElement;
    await act(async () => {
        container = render(
            React.createElement(Component, {
                data, updateData: jest.fn(), onNext, onBack,
            } as any),
        ).container;
    });

    //   The forward control is whatever says "continue" or "next" — the labels
    //   differ per step ("Continue to Civic Status", "Continue"), so matching
    //   the WORD rather than a literal keeps this from breaking on a rewording.
    const forward = [...container.querySelectorAll('button')]
        .filter(b => /continue|next|proceed/i.test(b.textContent ?? ''))
        .filter(b => !(b as HTMLButtonElement).disabled);

    for (const button of forward) {
        await act(async () => { fireEvent.click(button); });
    }

    return { advanced: onNext.mock.calls.length > 0, forwardButtons: forward.length, container };
}

beforeAll(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('#626 — no step of the WAVE application waves invalid data through', () => {
    it.each(STEPS.map(s => [s.name, s] as const))(
        '%s HAS A FORWARD CONTROL — the guard on the assertion below',
        async (_name, step) => {
            /*
             *   Vacuity guard, and it is the one that matters here: if a step
             *   rendered no Next button at all, "it did not advance" would be
             *   true for the emptiest possible reason and the real assertion
             *   would pass while measuring nothing.
             */
            const { forwardButtons } = await pressNext(step, step.invalid);
            expect(forwardButtons).toBeGreaterThan(0);
        },
    );

    it.each(STEPS.map(s => [s.name, s] as const))(
        '%s REFUSES TO ADVANCE ON DATA THE SERVER WOULD REJECT',
        async (_name, step) => {
            const { advanced } = await pressNext(step, step.invalid);
            expect({ step: _name, advanced }).toEqual({ step: _name, advanced: false });
        },
    );
});

describe('#626 — and the civic step refuses exactly what the server refuses', () => {
    const CIVIC = STEPS.find(s => s.name === 'CivicStatusStep')!;

    it('A PLACEHOLDER NIN IS REFUSED', async () => {
        //   The owner's rule, in as many words: not 11111111111 or similar, but
        //   a number that looks like a real NIN.
        for (const fake of ['11111111111', '12345678901', '00000000000']) {
            const { advanced } = await pressNext(CIVIC, { nin: fake });
            expect({ nin: fake, advanced }).toEqual({ nin: fake, advanced: false });
        }
    });

    it('AND SO IS ONE OF THE WRONG LENGTH', async () => {
        for (const wrong of ['123', '1234567890', '123456789012']) {
            const { advanced } = await pressNext(CIVIC, { nin: wrong });
            expect({ nin: wrong, advanced }).toEqual({ nin: wrong, advanced: false });
        }
    });

    it('BUT A PLAUSIBLE NIN GOES THROUGH', async () => {
        //   Without this the fix would be indistinguishable from a step that
        //   refuses everything, which is a worse defect than one that refuses
        //   nothing: it cannot be got past at all.
        const { advanced } = await pressNext(CIVIC, { nin: '23948571062' });
        expect(advanced).toBe(true);
    });

    it('AND AN EMPTY NIN GOES THROUGH, because the server allows it', async () => {
        /*
         *   The divergence that would be invisible until somebody hit it. The
         *   submit schema has `nationalIdField('NIN')`, which is `.optional()`.
         *   A client that demanded a NIN would refuse applicants the server was
         *   willing to accept — the same class of defect in the other direction.
         */
        for (const empty of [undefined, '', '   ']) {
            const { advanced } = await pressNext(CIVIC, empty === undefined ? {} : { nin: empty });
            expect({ nin: String(empty), advanced }).toEqual({ nin: String(empty), advanced: true });
        }
    });

    it('AND IT IS THE SERVER\'S OWN RULE, not a second copy of it', () => {
        //   Asserted as a string because the alternative — the client drifting
        //   from the schema — is exactly what produces a form that submits and
        //   then fails.
        const { readFileSync } = require('fs');
        const { join } = require('path');
        const src = readFileSync(join(process.cwd(), 'src/app/wave/application/steps/CivicStatusStep.tsx'), 'utf8');

        expect(src).toContain("nationalIdField('NIN').safeParse");
        //   And the check that could not fail is gone.
        expect(src).not.toContain('setErrors({});\n        return true;');

        //   The submit action validates with the same one, so the two agree by
        //   construction rather than by somebody remembering.
        const action = readFileSync(join(process.cwd(), 'src/app/actions/wave/_wv_applications.ts'), 'utf8');
        expect(action).toContain("nin: nationalIdField('NIN')");
    });
});

describe('#626 — and no step crashes on a row that is missing a list', () => {
    /*
     *   FOUND WHILE BUILDING THE TEST ABOVE, not by looking for it: TrainingStep
     *   threw `Cannot read properties of undefined (reading 'includes')` before
     *   it could render a button at all.
     *
     *   Six sites across three files read an array straight off `data` with no
     *   guard — `data.supportNeeded.includes(...)`, `.length`, `.join(...)` —
     *   while AgriInterestStep guards the identical shape throughout, and
     *   TrainingStep guarded it in ONE place and not the other three IN THE SAME
     *   FILE.
     *
     *   ReviewStep is the one that mattered most: it is the LAST step, so a
     *   crash there means an application that cannot be submitted at all, by
     *   somebody who has filled in all seven pages.
     *
     *   Reachable through revision mode, which merges a stored application row
     *   over the defaults — `{ ...prev, ...application }`. A row carrying null
     *   for one of these fields overwrites the default `[]` with null. JSON
     *   drops undefined, so the localStorage path cannot produce it; a database
     *   row can.
     */
    const ALL_STEPS = [
        ...STEPS,
        { name: 'ReviewStep', module: '@/app/wave/application/ReviewStep', invalid: {} },
    ];

    it.each(ALL_STEPS.map(s => [s.name, s.module] as const))(
        '%s RENDERS WITH EVERY LIST MISSING',
        async (_name, mod) => {
            const Component = require(mod).default;
            let container!: HTMLElement;

            //   Every field absent, which is what a row written before a field
            //   existed looks like after the merge.
            await act(async () => {
                container = render(
                    React.createElement(Component, {
                        data: {}, updateData: jest.fn(),
                        onNext: jest.fn(), onBack: jest.fn(),
                        onSubmit: jest.fn(), onEdit: jest.fn(), submitting: false,
                    } as any),
                ).container;
            });

            expect(container.innerHTML.length).toBeGreaterThan(0);
        },
    );

    it.each(ALL_STEPS.map(s => [s.name, s.module] as const))(
        '%s RENDERS WITH EVERY LIST EXPLICITLY null',
        async (_name, mod) => {
            //   The revision-mode case specifically: present, and null.
            const Component = require(mod).default;
            let container!: HTMLElement;

            await act(async () => {
                container = render(
                    React.createElement(Component, {
                        data: {
                            supportNeeded: null, valueChainAreas: null,
                            agricultureTypes: null, preferredCommodities: null,
                            accountNumber: null,
                        },
                        updateData: jest.fn(), onNext: jest.fn(), onBack: jest.fn(),
                        onSubmit: jest.fn(), onEdit: jest.fn(), submitting: false,
                    } as any),
                ).container;
            });

            expect(container.innerHTML.length).toBeGreaterThan(0);
        },
    );

    it('AND NO STEP READS A LIST OFF `data` WITHOUT A GUARD — the ratchet', () => {
        /*
         *   THE SCANNER THAT FOUND THESE HAD A FAULT OF ITS OWN, and it is the
         *   reason this assertion exists rather than a note. Its first pattern
         *   required a `(` after the property, so `.includes(` and `.map(`
         *   matched and `.length ===` did not — it reported four sites when
         *   there were six, and the two it missed were both crashes. #607's
         *   lesson, again: a grep that reads as all-clear is worse than no grep.
         */
        const { readdirSync, readFileSync } = require('fs');
        const { join } = require('path');
        const dir = join(process.cwd(), 'src/app/wave/application');

        const files = [
            ...readdirSync(join(dir, 'steps')).map((f: string) => join(dir, 'steps', f)),
            join(dir, 'ReviewStep.tsx'),
        ].filter((f: string) => f.endsWith('.tsx'));

        const offenders = files.flatMap((f: string) =>
            [...(readFileSync(f, 'utf8') as string).matchAll(new RegExp(UNGUARDED_LIST_READ.source, 'g'))]
                .map(m => `${f.split('/').pop()}: ${m[0]}`));

        expect(offenders).toEqual([]);
        //   Vacuity guard: the sweep is really reading the step files.
        expect(files.length).toBeGreaterThan(5);
    });

    it('AND THE SCANNER CATCHES BOTH SHAPES — the canary on its own fault', () => {
        /*
         *   ITS FIRST VERSION REQUIRED A `(` AFTER THE PROPERTY, so `.includes(`
         *   and `.map(` matched while `.length === 0` did not. It reported four
         *   sites when there were six, and BOTH it missed were crashes. A scanner
         *   that reads as all-clear is worse than no scanner — #607, again.
         *
         *   Asked with known answers, so narrowing it back cannot pass.
         */
        const find = (src: string) => [...src.matchAll(new RegExp(UNGUARDED_LIST_READ.source, 'g'))].map(m => m[0]);

        expect(find('data.supportNeeded.includes(x)')).toEqual(['data.supportNeeded.includes']);
        expect(find('if (data.supportNeeded.length === 0)')).toEqual(['data.supportNeeded.length']);
        expect(find('data.agricultureTypes.join(", ")')).toEqual(['data.agricultureTypes.join']);

        //   And a GUARDED read is not reported, or the ratchet would demand
        //   changes to code that is already correct and be switched off.
        expect(find('(data.supportNeeded || []).includes(x)')).toEqual([]);
        expect(find('data?.valueChainAreas || []')).toEqual([]);
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored and diffed after each.
 *
 *     MUTANT                                                        RESULT
 *     THE DEFECT: civic validate returns true again                  KILLED
 *     civic refuses EVERYTHING (nobody gets past step 2)             KILLED
 *     civic demands a NIN the server calls optional                  KILLED
 *     THE CRASH: TrainingStep reads the list unguarded again         KILLED
 *     THE CRASH: ReviewStep reads the list unguarded again           KILLED
 *     the ratchet's scanner goes back to requiring a call            KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                             SURVIVED ✓
 *
 *   THE SECOND AND THIRD ARE THE WAYS THIS FIX BECOMES A WORSE BUG. A step that
 *   refuses everything cannot be got past at all, and one that demands a NIN the
 *   submit schema calls optional turns away applicants the server would have
 *   accepted. Both look like tightened validation and are outages.
 *
 * ── THE SCANNER MUTANT SURVIVED FIRST, AND THAT IS THE POINT OF THE CANARY ──
 *
 *   Narrowing the ratchet's pattern back to its faulty version changed nothing:
 *   with the code clean, neither pattern matches anything, so the corpus could
 *   not tell a correct scanner from a broken one. The pattern is a named
 *   constant now and is asked directly about `.length ===`, `.includes(` and a
 *   guarded read. #620 had to learn this about its own verdict; this is the same
 *   repair on a regex.
 *
 * ── AND TWO INSTRUMENT FAULTS ON THE WAY ────────────────────────────────────
 *
 *   jsdom implements neither scrollIntoView nor scrollTo, and every one of these
 *   steps scrolls to the first error when it refuses. So the moment the fix
 *   started working, three steps "failed" — while refusing correctly, in a
 *   browser with no scrolling.
 *
 *   And the scanner that found the crashes had the fault described above, which
 *   is how it reported four sites when there were six. Both missed were crashes.
 */
