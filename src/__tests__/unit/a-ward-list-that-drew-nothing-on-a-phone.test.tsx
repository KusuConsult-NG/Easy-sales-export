/**
 * @jest-environment jsdom
 */

/**
 *   #823 THE WARD LIST SHOWED NOTHING ON MOBILE, AND NOTHING ON THE WAY BACK.
 *
 *   The owner: "The issue with ward is that it is not populating when users are
 *   filling the form and go back to make corrections in what was filled
 *   previously. also on mobile the dropdown doesnt show. The implementation has
 *   to be mobile responsive."
 *
 *   Two symptoms, ONE CAUSE. The ward and polling-unit fields on the WAVE form,
 *   and the ward on the cooperative form, were `<input list="…">` with a
 *   `<datalist>`.
 *
 *   NOTHING ON MOBILE. `<datalist>` is the worst-supported form control in the
 *   platform: iOS Safari renders no suggestion UI for it at all. Not a styling
 *   problem — there is no element to style, because the browser never draws
 *   one. On the device most WAVE applicants use, the ward field was a plain
 *   text box and the 8,778-ward register might as well not have existed.
 *
 *   NOTHING ON THE WAY BACK. A datalist FILTERS ITS OPTIONS BY THE INPUT'S
 *   CURRENT VALUE. An applicant returning to correct an answer arrives with her
 *   previous ward already in the box, so the only option still matching is the
 *   one already chosen, and browsers show no popup for that. To see the list
 *   again she had to know to clear the field first — and nothing said so, so it
 *   looked broken exactly when she was trying to fix something.
 *
 * ── WHY THIS IS A RENDER TEST ───────────────────────────────────────────────
 *
 *   Because the defect was INVISIBILITY, and a source-reading assertion cannot
 *   tell a list that draws from one that does not. These mount the control and
 *   ask what is on the screen.
 *
 *   jsdom cannot prove anything about iOS Safari — no test here can. What it
 *   CAN prove is the property that makes the control work everywhere: the
 *   options are real DOM rendered by this application rather than handed to the
 *   browser to draw as it sees fit. That is the whole of the mobile fix.
 *
 * ── MUTATION LOG ────────────────────────────────────────────────────────────
 *
 *     the list filtered by `value` on open (the go-back defect)        KILLED
 *     the typed answer discarded when it matches no option             KILLED
 *     prefix matching instead of substring                             KILLED
 *     the chevron's onClick removed                                    KILLED
 *     BOTH disabled guards removed                                     KILLED
 *     reword this header                                   SURVIVED, intended
 *
 *     openList's `if (disabled) return`  alone               SURVIVED
 *     the render's `!disabled`           alone               SURVIVED
 *
 *   THE TWO SURVIVORS ARE EQUIVALENT MUTANTS, and the pair is why. The control
 *   refuses to open when disabled in two places — the handler and the render —
 *   so removing EITHER changes no observable behaviour and removing BOTH is
 *   caught. That is redundancy in the component, not a hole in the suite, and
 *   it is recorded rather than chased: a test cannot distinguish two guards
 *   from one when either suffices.
 *
 *   Checked rather than assumed — the both-guards mutant was run, and it dies.
 */

//   The GLOBAL describe/it/expect/jest, not the ones from '@jest/globals'.
//   jest-dom augments the global matcher types, so importing expect from the
//   package leaves toBeInTheDocument untyped — and the same import is what stops
//   jest.mock being hoisted, which has cost this audit a whole suite that never
//   ran. Every render suite here uses the globals.
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import ComboBox from '@/components/ui/ComboBox';

const WARDS = ['Badarawa/Malali', 'Kabala Costain', 'Unguwan Rimi', 'Hayin Banki'];

function setup(overrides: Partial<React.ComponentProps<typeof ComboBox>> = {}) {
    const onChange = jest.fn();
    const utils = render(
        <ComboBox
            ariaLabel="Ward"
            value=""
            onChange={onChange as any}
            options={WARDS}
            placeholder="Choose or type your ward"
            {...overrides}
        />,
    );
    return { onChange, ...utils };
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#823 — the list is drawn by this application, not by the browser', () => {
    it('THE OPTIONS ARE REAL DOM, NOT A <datalist>', () => {
        /*
         *   THE mobile fix, stated as the property that delivers it. A datalist
         *   hands the drawing to the browser, and iOS Safari declines.
         */
        const { container } = setup();
        fireEvent.focus(screen.getByRole('combobox'));

        expect(container.querySelector('datalist')).toBeNull();
        expect(screen.getByRole('listbox')).toBeInTheDocument();
        expect(screen.getAllByRole('option')).toHaveLength(WARDS.length);
    });

    it('AND OPENING WITH A VALUE ALREADY SET SHOWS THE WHOLE LIST', () => {
        /*
         *   THE "go back to make corrections" case, which is what the owner
         *   reported. With "Badarawa/Malali" already chosen, a datalist offers
         *   only that one — so the applicant could not pick a different ward
         *   without knowing to clear the field first.
         */
        setup({ value: 'Badarawa/Malali' });
        fireEvent.focus(screen.getByRole('combobox'));

        expect(screen.getAllByRole('option')).toHaveLength(WARDS.length);
        expect(screen.getByRole('option', { name: /Kabala Costain/ })).toBeInTheDocument();
    });

    it('AND SHE CAN THEN CHOOSE A DIFFERENT ONE', () => {
        const { onChange } = setup({ value: 'Badarawa/Malali' });
        fireEvent.focus(screen.getByRole('combobox'));
        fireEvent.pointerDown(screen.getByRole('option', { name: /Unguwan Rimi/ }));

        expect(onChange).toHaveBeenCalledWith('Unguwan Rimi');
    });

    it('TYPING FILTERS, and by substring rather than prefix', () => {
        //   "malali" should find "Badarawa/Malali". A prefix match never would,
        //   and a ward name's distinctive half is often not its first word.
        setup();
        const input = screen.getByRole('combobox');
        fireEvent.focus(input);
        fireEvent.change(input, { target: { value: 'malali' } });

        const options = screen.getAllByRole('option');
        expect(options).toHaveLength(1);
        expect(options[0]).toHaveTextContent('Badarawa/Malali');
    });

    it('AND A WARD THAT IS NOT ON THE REGISTER IS STILL KEPT', () => {
        /*
         *   #789's rule: 8,778 wards is what INEC publishes, not a promise that
         *   nobody's ward is missing. A required field an applicant cannot
         *   satisfy is the defect that finding is named for.
         */
        const { onChange } = setup();
        const input = screen.getByRole('combobox');
        fireEvent.focus(input);
        fireEvent.change(input, { target: { value: 'A Ward Nobody Listed' } });

        expect(onChange).toHaveBeenCalledWith('A Ward Nobody Listed');
        //   and she is told the typed answer stands rather than left guessing
        expect(screen.getByText(/typed answer will be kept/i)).toBeInTheDocument();
    });

    it('THERE IS SOMETHING TO TAP, which a datalist never gave her', () => {
        //   On a phone the old control had no affordance at all: no chevron,
        //   nothing to indicate a list existed behind the box.
        const { container } = setup();
        const chevron = container.querySelector('button[type="button"]');

        expect(chevron).not.toBeNull();
        fireEvent.click(chevron!);
        expect(screen.getByRole('listbox')).toBeInTheDocument();
    });

    it('CONTROL: a disabled field opens nothing', () => {
        //   The ward is gated on the LGA. If this opened, it would offer wards
        //   for an LGA that had not been chosen.
        setup({ disabled: true, options: WARDS });
        fireEvent.focus(screen.getByRole('combobox'));

        expect(screen.queryByRole('listbox')).toBeNull();
    });

    it('CONTROL: with no options it still takes a typed answer', () => {
        //   The 93 wards with no published polling-unit list, and any LGA the
        //   register does not cover: the field must degrade to a text box
        //   rather than refuse.
        const { onChange } = setup({ options: [] });
        const input = screen.getByRole('combobox');
        fireEvent.focus(input);
        fireEvent.change(input, { target: { value: 'Typed PU' } });

        expect(onChange).toHaveBeenCalledWith('Typed PU');
        expect(screen.getByText(/No list available/i)).toBeInTheDocument();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#823 — and every field that had the old control uses this one', () => {
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const { stripComments } = require('@/lib/testing/strip-comments');
    //   STRIPPED, because the comments recording this finding quote the very
    //   element they replaced — the #741 trap, which this suite walked into on
    //   its first run.
    const read = (p: string) => stripComments(readFileSync(join(process.cwd(), p), 'utf8'));

    it.each([
        ['the WAVE civic step', 'src/app/wave/application/steps/CivicStatusStep.tsx'],
        ['the cooperative personal-info step', 'src/app/cooperatives/onboarding/steps/PersonalInfoStep.tsx'],
    ])('%s renders no <datalist>', (_name, file) => {
        /*
         *   Swept rather than fixed one at a time: the ward, the polling unit
         *   and the cooperative's ward were three instances of one control, and
         *   the cooperative form's own header records that the LAST fix to this
         *   field reached WAVE and not it.
         */
        const src = read(file);
        expect(src).not.toMatch(/<datalist/);
        expect(src).not.toMatch(/list="[a-z-]+-options"/);
        expect(src).toContain('<ComboBox');
    });
});
