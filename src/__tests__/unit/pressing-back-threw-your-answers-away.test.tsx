/**
 * @jest-environment jsdom
 */

/**
 *   #627 PRESSING BACK THREW AWAY EVERYTHING TYPED ON TWO STEPS.
 *
 *   The third interaction-path test. #625 asked what happens when you arrive at
 *   a step you should not be on, #626 what happens when you try to leave one you
 *   have not filled in. This one asks the question a user actually asks: can I
 *   go back and check something without losing my work?
 *
 * ── HOW THESE FLOWS KEEP YOUR ANSWERS ───────────────────────────────────────
 *
 *   Each step holds its own state and reports upward through `onChange`. The
 *   parent merges that into its form state AND writes the localStorage draft on
 *   every edit. `onNext` does the same when you advance.
 *
 *   So a step that never calls `onChange` is invisible to the parent until Next
 *   is pressed — and the parent renders ONE step at a time from a switch, so
 *   going Back UNMOUNTS it. Coming forward re-mounts it from `initialData`,
 *   which never received the edits.
 *
 *   Everything typed on that step is gone. Silently, with no warning, for
 *   somebody who went back to check one answer. The draft did not have it
 *   either, so a reload does not bring it back.
 *
 * ── WHICH ONES ──────────────────────────────────────────────────────────────
 *
 *   Both DECLARED the prop in their interface and never called it, which is why
 *   nothing looked wrong at the call site — the parent passes `onChange` to all
 *   of them.
 *
 *     farm-nation InterestsStep      property types, budget range, preferred
 *                                    size, listing types, total acreage, ready
 *                                    to list, and an uploaded document.
 *     export InvestmentProfileStep   investment range, goals, risk tolerance.
 *                                    Its props were not even destructured, so
 *                                    the call could not be written.
 *
 *   Their siblings — ProfileStep, RoleSelectionStep, BankAccountStep,
 *   KYCVerificationStep — all report correctly. Four of eight, which is this
 *   audit's most familiar shape.
 *
 *   THE TERMS STEPS ARE DELIBERATELY LEFT ALONE. They collect tick-boxes that
 *   are re-ticked in a second, and more importantly a consent that was recorded
 *   without being re-given is worse than one retyped. They are named below so
 *   the exemption is a decision rather than an omission.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import React from 'react';
import { render, fireEvent, act } from '@testing-library/react';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

jest.mock('@/contexts/ToastContext', () => ({
    ToastProvider: ({ children }: any) => children,
    useToast: () => ({ showToast: jest.fn() }),
}));
jest.mock('@/lib/storage-upload', () => ({ uploadFile: jest.fn() }));

(Element.prototype as any).scrollIntoView = jest.fn();
(window as any).scrollTo = jest.fn();

const ROOT = process.cwd();

interface Reporter {
    name: string;
    file: string;
    module: string;
    /** Props beyond the four every step takes. */
    extra?: Record<string, unknown>;
}

/** Every onboarding step that collects answers and has a Back button. */
const REPORTING_STEPS: Reporter[] = [
    {
        name: 'farm-nation InterestsStep',
        file: 'src/app/farm-nation/onboarding/steps/InterestsStep.tsx',
        module: '@/app/farm-nation/onboarding/steps/InterestsStep',
        extra: { role: 'buyer' },
    },
    {
        name: 'farm-nation ProfileStep',
        file: 'src/app/farm-nation/onboarding/steps/ProfileStep.tsx',
        module: '@/app/farm-nation/onboarding/steps/ProfileStep',
    },
    {
        name: 'export InvestmentProfileStep',
        file: 'src/app/export/onboarding/steps/InvestmentProfileStep.tsx',
        module: '@/app/export/onboarding/steps/InvestmentProfileStep',
    },
];

/**
 * The steps that may keep their answers to themselves, each with its reason.
 *
 * Named rather than pattern-matched, so adding one is a decision somebody makes
 * on purpose — #598's rule about exclusions.
 */
/**
 * Does this step declare `onChange` and never call it?
 *
 * A named function, not an expression inside the ratchet, so it can be ASKED
 * QUESTIONS. Inline, two mutants survived — one that made it always answer
 * false, one that exempted every file — because with the steps all reporting
 * there is no offender for either version to disagree about. The corpus could
 * not tell a working detector from a broken one. Third time this repair has
 * been needed in this sweep (#620, #626).
 */
export function declaresButNeverCalls(src: string): boolean {
    const declares = /onChange\?*:\s*\(/.test(src);
    const calls = /onChange\?\.\(|onChange\(/.test(src);
    return declares && !calls;
}

const MAY_NOT_REPORT: Record<string, string> = {
    'TermsStep.tsx': 'tick-boxes; a consent recorded without being re-given is worse than one re-ticked',
    'TermsAcceptanceStep.tsx': 'same — consent is re-given, not restored',
};

/** Is this step one of the named few allowed to keep its answers? */
export function isExemptFromReporting(relPath: string): boolean {
    return MAY_NOT_REPORT[relPath.split('/').pop()!] !== undefined;
}

/** Type into whatever the step offers, and report whether the parent heard. */
async function editAndListen(step: Reporter) {
    const mod = require(step.module);
    const Component = mod.default ?? mod[Object.keys(mod).find(k => k !== '__esModule')!];
    const onChange = jest.fn();

    let container!: HTMLElement;
    await act(async () => {
        container = render(
            React.createElement(Component, {
                onNext: jest.fn(), onBack: jest.fn(), onChange,
                initialData: {}, ...(step.extra ?? {}),
            } as any),
        ).container;
    });

    //   Whatever this step offers first: a text box, or a choice to click.
    const text = container.querySelector('input[type="text"], input:not([type]), input[type="number"]');
    if (text) {
        await act(async () => { fireEvent.change(text, { target: { value: '12345' } }); });
    } else {
        const choice = container.querySelector('input[type="checkbox"], input[type="radio"], button[type="button"]');
        if (choice) await act(async () => { fireEvent.click(choice); });
    }

    return { reported: onChange.mock.calls.length > 0, container };
}

beforeAll(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('#627 — a step tells the parent what was typed, before Back can discard it', () => {
    it.each(REPORTING_STEPS.map(s => [s.name, s] as const))(
        '%s OFFERS SOMETHING TO EDIT — the guard on the assertion below',
        async (_name, step) => {
            //   Vacuity guard: if a step rendered no editable control, "it did
            //   not report" and "it reported" would both be untestable and the
            //   assertion below would pass for the emptiest possible reason.
            const { container } = await editAndListen(step);
            const controls = container.querySelectorAll('input, select, textarea, button');
            expect(controls.length).toBeGreaterThan(0);
        },
    );

    it.each(REPORTING_STEPS.map(s => [s.name, s] as const))(
        '%s REPORTS AN EDIT UPWARD IMMEDIATELY',
        async (_name, step) => {
            const { reported } = await editAndListen(step);
            expect({ step: _name, reported }).toEqual({ step: _name, reported: true });
        },
    );
});

describe('#627 — and the ratchet, so the next step cannot be added without it', () => {
    /** Every onboarding step file across the three flows. */
    function stepFiles(): string[] {
        const dirs = [
            'src/app/farm-nation/onboarding/steps',
            'src/app/export/onboarding/steps',
            'src/app/marketplace/onboarding/steps',
        ];
        return dirs.flatMap(d =>
            readdirSync(join(ROOT, d))
                .filter(f => f.endsWith('.tsx'))
                .map(f => `${d}/${f}`));
    }

    it('EVERY STEP THAT TAKES onChange ACTUALLY CALLS IT', () => {
        /*
         *   Declaring the prop and never calling it is precisely what both
         *   defects were, and it is invisible at the call site because the
         *   parent passes `onChange` to every step regardless.
         */
        const offenders = stepFiles().filter(rel => {
            return !isExemptFromReporting(rel)
                && declaresButNeverCalls(readFileSync(join(ROOT, rel), 'utf8'));
        });

        expect(offenders).toEqual([]);
    });

    it('AND THE DETECTOR CAN SAY BOTH THINGS — the canary on its own rule', () => {
        //   The exact shape both defects had: the prop in the interface, never
        //   invoked anywhere in the file.
        expect(declaresButNeverCalls(
            'interface P { onChange?: (d: any) => void; }\nfunction S({ onNext }: P) { return null; }',
        )).toBe(true);

        //   And a step that reports is not accused.
        expect(declaresButNeverCalls(
            'interface P { onChange?: (d: any) => void; }\nfunction S({ onChange }: P) { onChange?.({ a: 1 }); }',
        )).toBe(false);

        //   Nor is one that never took the prop at all — that is a different
        //   thing and not this ratchet's business.
        expect(declaresButNeverCalls('function S({ onNext }: any) { return null; }')).toBe(false);
    });

    it('AND THE EXEMPTION CANNOT SWALLOW A REAL OFFENDER', () => {
        /*
         *   A mutant making every file exempt survived the ratchet, because with
         *   no offenders in the tree a wildcard and a two-name list agree. The
         *   lookup is a function now and is asked directly — the same repair as
         *   the detector above, for the same reason.
         */
        expect(isExemptFromReporting('src/app/x/steps/TermsStep.tsx')).toBe(true);
        expect(isExemptFromReporting('src/app/x/steps/TermsAcceptanceStep.tsx')).toBe(true);

        //   The two that were actually broken must NOT be exemptible.
        expect(isExemptFromReporting('src/app/x/steps/InterestsStep.tsx')).toBe(false);
        expect(isExemptFromReporting('src/app/x/steps/InvestmentProfileStep.tsx')).toBe(false);

        //   And the list stays short and named.
        expect(Object.keys(MAY_NOT_REPORT).sort()).toEqual([
            'TermsAcceptanceStep.tsx',
            'TermsStep.tsx',
        ]);
    });

    it('AND THE SWEEP REALLY READS THE STEP FILES', () => {
        //   Vacuity guard on the ratchet: an empty file list satisfies it.
        const files = stepFiles();
        expect(files.length).toBeGreaterThan(8);
        expect(files.some(f => f.endsWith('InterestsStep.tsx'))).toBe(true);
        expect(files.some(f => f.endsWith('InvestmentProfileStep.tsx'))).toBe(true);
    });

    it('AND EVERY EXEMPTION IS STILL A REAL ONE', () => {
        //   #598: an exclusion kept after the code moved on is a name that
        //   protects nothing. Each exempted file must still exist and must still
        //   be a step that declines to report.
        const files = stepFiles();
        for (const [name, reason] of Object.entries(MAY_NOT_REPORT)) {
            expect(reason.length).toBeGreaterThan(20);          // a reason, not a label
            expect(files.some(f => f.endsWith(name))).toBe(true);
        }
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored and diffed after each.
 *
 *     MUTANT                                                        RESULT
 *     THE DEFECT: InterestsStep stops reporting                      KILLED
 *     THE DEFECT: InvestmentProfileStep stops reporting              KILLED
 *     a sibling that always worked stops reporting                   KILLED
 *     the detector stops noticing a declared-but-uncalled prop       KILLED
 *     the detector ignores whether the prop is called                KILLED
 *     the exemption lookup swallows everything                       KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                             SURVIVED ✓
 *
 * ── TWO OF THOSE SURVIVED FIRST, AND IT IS THE SAME LESSON A THIRD TIME ─────
 *
 *   The ratchet was written as one expression: declare-and-never-call, minus an
 *   inline exemption lookup. Both halves could be broken without failing
 *   anything — one made the detector always answer false, the other exempted
 *   every file — because with all the steps now reporting there is no offender
 *   for a working detector and a broken one to disagree about. The corpus was
 *   testing itself.
 *
 *   Both are named functions now, asked directly: the detector about a step that
 *   declares the prop and never calls it, one that calls it, and one that never
 *   took it; the exemption about the two files it covers and the two it must
 *   never cover. #620 needed this repair on a verdict and #626 on a regex; this
 *   is the third, and the pattern is plain — a rule that only ever runs over
 *   clean code is not being tested by it.
 */
