/**
 * @jest-environment jsdom
 */

/**
 *   #920 A CONFIRMATION SCREEN THAT ASKED FOR MORE THAN IT SHOWED.
 *
 *   ReviewStep is step 4 of the academy application — the last thing an
 *   applicant sees before Submit — and it ends with a checkbox they must tick:
 *
 *       "I confirm that all the information provided is accurate and complete."
 *
 *   Its personalInfo prop declared six fields: fullName, email, phone,
 *   dateOfBirth, state, occupation. PersonalInfoStep collects TEN, nine of which
 *   the wizard marks required, and the two missing from the summary were GENDER
 *   and LGA.
 *
 *   Both are written onto the learner's own user row by the submit action
 *   (`gender`, `stateOfOrigin`, `lga`). LGA is the more consequential of the two:
 *   PersonalInfoStep clears it whenever the State changes —
 *
 *       ...(field === "state" ? { lga: "" } : {})
 *
 *   — so an applicant who revised their State late in the form and reselected an
 *   LGA had no way to check which one was carried forward. They confirmed
 *   "accurate and complete" over a summary that omitted it.
 *
 *   The parent already passed both: it spreads the whole personalInfo object into
 *   the prop. Only the interface left them out, so nothing had to be plumbed —
 *   which is why this went unnoticed. TypeScript does not complain about a prop
 *   type narrower than the object handed to it.
 *
 * ── AND THE NAME ON THE SCREEN WAS THE WRONG ONE ────────────────────────────
 *
 *   The same parent built the fullName it shows here as
 *   `${firstName} ${lastName}`.trim(), while the server writes the user row as
 *   [firstName, otherName, lastName]. So a learner with a middle name was shown
 *   "Ada Obi" to confirm, and the platform stored "Ada Chidinma Obi" against
 *   them. That half is fixed in the parent and asserted in
 *   one-door-parsed-and-the-other-did-not; what this file pins is that the screen
 *   renders whatever name it is given, unaltered.
 */

import { describe, it, expect } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import ReviewStep from '@/app/academy/application/ReviewStep';
import { joinFullName, namePartsOf } from '@/lib/person-name';

const PERSON = {
    firstName: 'Ada',
    otherName: 'Chidinma',
    lastName: 'Obi',
};

const PERSONAL_INFO = {
    ...PERSON,
    fullName: joinFullName(namePartsOf(PERSON)),
    email: 'ada@example.com',
    phone: '08012345678',
    dateOfBirth: '1994-05-10',
    gender: 'Female',
    state: 'Plateau',
    lga: 'Jos North',
    occupation: 'Trader',
};

const EDUCATION = {
    educationLevel: "Bachelor's Degree (BSc/BA/BTech)",
    fieldOfStudy: 'Agricultural Science',
    yearsExperience: 3,
    currentRole: 'Farmer',
};

const INTERESTS = {
    learningPaths: ['export', 'agribusiness'],
    topics: 'Cassava processing',
    goals: 'Export to Ghana',
};

function draw(overrides: Record<string, unknown> = {}) {
    return render(
        <ReviewStep
            personalInfo={PERSONAL_INFO}
            education={EDUCATION}
            interests={INTERESTS}
            acceptTerms={false}
            onAcceptTermsChange={() => undefined}
            errors={{}}
            {...overrides}
        />,
    );
}

/** The value rendered beside a label, in the label/value pairs this screen uses. */
function valueFor(label: string): string {
    const labelEl = screen.getByText(label);
    const value = labelEl.parentElement?.querySelector('p.font-semibold');
    return (value?.textContent ?? '').trim();
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#920 — the summary shows every required answer', () => {
    it('THE CONTROL: it renders the six fields it always rendered', () => {
        draw();

        expect(valueFor('Full Name')).toBe('Ada Chidinma Obi');
        expect(valueFor('Email')).toBe('ada@example.com');
        expect(valueFor('Phone')).toBe('08012345678');
        expect(valueFor('Date of Birth')).toBe('1994-05-10');
        expect(valueFor('State')).toBe('Plateau');
        expect(valueFor('Occupation')).toBe('Trader');
    });

    it('AND THE TWO IT DID NOT — gender and LGA', () => {
        draw();

        expect(valueFor('Gender')).toBe('Female');
        expect(valueFor('LGA')).toBe('Jos North');
    });

    it('so the confirmation covers all nine fields the form marks required', () => {
        //   firstName / lastName / otherName are shown as the joined Full Name
        //   rather than separately, which is why the count is nine labels for ten
        //   collected fields.
        draw();

        const shown = ['Full Name', 'Email', 'Phone', 'Date of Birth',
            'Gender', 'State', 'LGA', 'Occupation'];

        for (const label of shown) {
            expect(screen.getByText(label)).toBeTruthy();
        }
        expect(shown).toHaveLength(8);
    });

    it('and the checkbox it asks them to tick really does claim completeness', () => {
        //   Without this the file is arguing with nobody: the omission only
        //   matters because of what the applicant is asked to confirm.
        draw();
        const terms = screen.getByLabelText(/I confirm that all the information provided/);

        expect(terms).toBeTruthy();
        expect(document.body.textContent?.replace(/\s+/g, ' '))
            .toContain('accurate and complete');
    });

    it('POSITIVE CONTROL: a missing value renders empty rather than throwing', () => {
        //   The screen is reached with a partially filled draft, and every value
        //   is read through `?.` with an empty-string fallback. A crash here
        //   would strand the applicant on the last step.
        draw({ personalInfo: { ...PERSONAL_INFO, gender: '', lga: '' } });

        expect(valueFor('Gender')).toBe('');
        expect(valueFor('LGA')).toBe('');
        expect(screen.getByText('Full Name')).toBeTruthy();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#920 — the rest of the summary, pinned while it was being read', () => {
    it('names the learning paths rather than printing their ids', () => {
        //   InterestsStep stores ids (farming / export / agribusiness /
        //   technology). A summary that printed "export" would be asking somebody
        //   to confirm a value they never chose by that name.
        draw();

        expect(screen.getByText('Export Mastery')).toBeTruthy();
        expect(screen.getByText('Agribusiness')).toBeTruthy();
        expect(screen.queryByText('export')).toBeNull();
    });

    it('and falls back to the id for a path it does not have a name for', () => {
        //   A path added to InterestsStep and not to this map shows the id
        //   instead of vanishing from the summary. Pinned as the better of the
        //   two failures.
        draw({ interests: { ...INTERESTS, learningPaths: ['aquaculture'] } });

        expect(screen.getByText('aquaculture')).toBeTruthy();
    });

    it('shows zero years of experience as zero, not as absent', () => {
        //   EducationStep tells the applicant "Enter 0 if you're just starting
        //   out", so 0 is an answer. `|| ""` would have hidden it.
        draw({ education: { ...EDUCATION, yearsExperience: 0 } });

        expect(screen.getByText('0 years')).toBeTruthy();
    });

    it('marks an unanswered field of study as not specified, since it is optional', () => {
        draw({ education: { ...EDUCATION, fieldOfStudy: '' } });

        expect(valueFor('Field of Study')).toBe('Not specified');
    });

    it('hides the topics row when there is nothing in it', () => {
        //   Topics is the one interests field the wizard does not require.
        draw({ interests: { ...INTERESTS, topics: '' } });

        expect(screen.queryByText('Topics of Interest')).toBeNull();
        expect(screen.getByText('Learning Goals')).toBeTruthy();
    });

    it('and surfaces the terms error the parent sets', () => {
        draw({ errors: { acceptTerms: 'You must accept the terms and conditions to continue' } });

        expect(screen.getByText('You must accept the terms and conditions to continue')).toBeTruthy();
    });
});
