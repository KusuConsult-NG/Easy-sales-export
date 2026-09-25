/**
 * @jest-environment node
 */

/**
 *   #905 SEVEN SECTIONS, AND THEN "Too small: expected number to be >=18".
 *
 *   Found auditing the files no test had named — the three WAVE application
 *   steps were on that list. Both doors that accept an application end a failed
 *   parse the same way:
 *
 *       return { success: false, error: validation.error.issues[0]?.message
 *                                       || "Validation failed", data: null };
 *
 *   `issues[0].path` holds the field's name and is thrown away. Fourteen of the
 *   schema's required fields carry no message of their own, so for those the
 *   applicant is handed Zod's type error and nothing else — MEASURED against
 *   this exact schema, not supposed:
 *
 *       age                     "Too small: expected number to be >=18"
 *       involvedInAgriculture   "Invalid input: expected boolean, received
 *                                undefined"
 *       maritalStatus           "Invalid option: expected one of
 *                                "single"|"married"|"widowed"|"divorced"|"""
 *       valueChainAreas         "Invalid input: expected array, received
 *                                undefined"
 *       declarationAccepted     "Invalid input: expected boolean, received
 *                                undefined"
 *
 *   She has filled seven sections by then, on the largest programme this
 *   platform runs — 20,247 applications, by _wv_applications' own count — and is
 *   told a type error with no field, no section and nowhere to go. #855's rule,
 *   in its own words: "a submit that fails late looks like the platform breaking
 *   rather than a form telling her something."
 *
 * ── AND THE FORM'S GUARD COVERED ELEVEN OF THIRTY ───────────────────────────
 *
 *   WaveApplicationClient had a hand-written pre-submission check, and the idea
 *   was right: a draft restored from localStorage can be half-empty, and
 *   catching that in the form sends her back to the step instead of into the
 *   refusal above. It checked surname, firstName, phone, dateOfBirth, the two
 *   states, maritalStatus, the two next-of-kin fields, bankName and
 *   accountNumber — and could not check the rest, because the schema lived in a
 *   "use server" module the form cannot import.
 *
 *   So the schema moved to lib/wave-application-fields, unchanged, and the form
 *   parses the very object the action will parse. One list.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from '@/lib/testing/strip-comments';
import {
    waveApplicationSchema, waveFieldRefusal, waveFieldStep,
    WAVE_FIELD_PLACES, WAVE_STEPS,
} from '@/lib/wave-application-fields';

const code = (rel: string) => stripComments(readFileSync(join(process.cwd(), rel), 'utf8'), { label: rel });

/** A complete application, which is the control every assertion below needs. */
const COMPLETE = {
    surname: 'Adeyemi',
    firstName: 'Ngozi',
    otherNames: '',
    dateOfBirth: '1992-04-11',
    age: 33,
    phone: '08031234567',
    alternativePhone: '',
    email: '',
    residentialAddress: '14 Rayfield Road, Jos',
    stateOfOrigin: 'Plateau',
    lgaOfOrigin: 'Jos South',
    stateOfResidence: 'Plateau',
    lgaOfResidence: 'Jos South',
    maritalStatus: 'married' as const,
    nextOfKinName: 'Chidi Adeyemi',
    nextOfKinPhone: '08039876543',
    nextOfKinRelationship: 'Husband',
    //   Not sequential and not a repeated digit: isObviouslyFakeId refuses
    //   both, and my first fixture used 23456789012, which the control below
    //   caught before any assertion could be built on it.
    nin: '28401739265',
    votersCardNumber: '',
    pollingUnit: '',
    ward: '',
    yearOfVoterRegistration: '',
    votedInLastElection: true,
    highestEducation: 'secondary' as const,
    currentOccupation: 'Farmer',
    averageMonthlyIncome: '50k_100k' as const,
    involvedInAgriculture: true,
    agricultureTypes: ['farming' as const],
    valueChainAreas: ['crop_production' as const],
    preferredCommodities: ['maize' as const],
    preferredCommodityOther: '',
    hasAccessToFarmland: true,
    farmlandHectares: 2,
    needsFarmlandAccess: false,
    hasBankAccount: true,
    bankName: 'Access Bank',
    accountNumber: '0123456789',
    bvn: '31948027516',
    isMemberOfCooperative: false,
    cooperativeName: '',
    willingToJoinCooperative: true,
    supportNeeded: ['training' as const],
    willingToUndergoTraining: true,
    willingToComplyWithStandards: true,
    willingToParticipateInME: true,
    declarationAccepted: true,
    consentGiven: true,
};

const refusalFor = (patch: Record<string, unknown>): string => {
    const parsed = waveApplicationSchema.safeParse({ ...COMPLETE, ...patch });
    if (parsed.success) throw new Error(`expected a refusal for ${JSON.stringify(patch)}`);
    return waveFieldRefusal(parsed.error.issues[0]);
};

describe('what a refused WAVE application tells the applicant', () => {
    it('A COMPLETE APPLICATION PASSES (control)', () => {
        /*
         *   THE control. Every assertion below is "this incomplete application
         *   is refused with a useful sentence", and a fixture the schema refuses
         *   for some OTHER reason would produce a sentence about the wrong
         *   field and pass anyway.
         */
        const parsed = waveApplicationSchema.safeParse(COMPLETE);
        expect(parsed.success ? null : parsed.error.issues).toBeNull();
    });

    it('THE FIVE MEASURED TYPE ERRORS NOW NAME THEIR FIELD AND SECTION', () => {
        //   THE test. These are the exact five in the header, the ones a
        //   real applicant met.
        expect(refusalFor({ age: 0 }))
            .toBe('Age: Too small: expected number to be >=18 (Section A — Personal Details)');

        expect(refusalFor({ involvedInAgriculture: undefined }))
            .toBe('Whether you are involved in agriculture: Invalid input: expected boolean, '
                + 'received undefined (Section C — Socio-Economic)');

        expect(refusalFor({ maritalStatus: 'partnered' }))
            .toContain('Marital status: Invalid option');
        expect(refusalFor({ maritalStatus: 'partnered' }))
            .toContain('(Section A — Personal Details)');

        expect(refusalFor({ valueChainAreas: undefined }))
            .toBe('Value chain areas of interest: Invalid input: expected array, '
                + 'received undefined (Section D — Agricultural Interest)');

        expect(refusalFor({ declarationAccepted: undefined }))
            .toBe('The declaration: Invalid input: expected boolean, '
                + 'received undefined (Section G — Review)');
    });

    it('AND A MESSAGE THAT ALREADY NAMES ITS FIELD IS NOT SAID TWICE', () => {
        /*
         *   About half the schema's entries carry a written message —
         *   "Residential address is required", "NIN must be exactly 11 digits" —
         *   and those read as sentences. Prefixing would give "Residential
         *   address: Residential address is required".
         */
        expect(refusalFor({ residentialAddress: '' }))
            .toBe('Residential address is required (Section A — Personal Details)');
        expect(refusalFor({ nin: '123' }))
            .toBe('NIN must be exactly 11 digits (Section B — Civic Status)');
        expect(refusalFor({ currentOccupation: '' }))
            .toBe('Current occupation is required (Section C — Socio-Economic)');
    });

    it('AND THE STEP IS THE ONE THAT HOLDS THE FIELD', () => {
        //   What the form uses to send her back. A wrong number here is worse
        //   than none: it puts her on a section where the field is not.
        const stepFor = (patch: Record<string, unknown>) => {
            const parsed = waveApplicationSchema.safeParse({ ...COMPLETE, ...patch });
            if (parsed.success) throw new Error('expected a refusal');
            return waveFieldStep(parsed.error.issues[0]);
        };

        expect(stepFor({ age: 0 })).toBe(0);
        expect(stepFor({ nin: '' })).toBe(1);
        expect(stepFor({ currentOccupation: '' })).toBe(2);
        expect(stepFor({ valueChainAreas: undefined })).toBe(3);
        expect(stepFor({ accountNumber: '' })).toBe(4);
        expect(stepFor({ supportNeeded: undefined })).toBe(5);
        expect(stepFor({ consentGiven: undefined })).toBe(6);
    });

    it('AND AN ISSUE WITH NO PATH IS NOT GIVEN AN INVENTED FIELD', () => {
        //   A schema-level refusal identifies no box. Guessing one would send
        //   her to a section where there is nothing to fix.
        expect(waveFieldRefusal({ path: [], message: 'Unrecognized keys' }))
            .toBe('Unrecognized keys');
        expect(waveFieldStep({ path: [], message: 'x' })).toBeNull();
        expect(waveFieldRefusal(null)).toBe('Validation failed');
        expect(waveFieldRefusal({ path: ['notAField'], message: 'odd' })).toBe('odd');
        expect(waveFieldStep({ path: ['notAField'], message: 'odd' })).toBeNull();
    });
});

describe('the table and the schema cannot drift apart', () => {
    it('EVERY FIELD THE SCHEMA CAN REFUSE HAS A PLACE', () => {
        /*
         *   THE guard that makes this finding stay fixed. A field added to the
         *   schema and not to the table falls back to the bare Zod message —
         *   which is the defect, reappearing on exactly one field and therefore
         *   invisible.
         */
        const schemaKeys = Object.keys((waveApplicationSchema as any).shape);

        expect(schemaKeys.length).toBeGreaterThan(40);
        expect(schemaKeys.filter((k) => !WAVE_FIELD_PLACES[k])).toEqual([]);
    });

    it('AND EVERY PLACE NAMES A FIELD THE SCHEMA HAS', () => {
        //   The other direction: a label for a field that no longer exists is a
        //   claim about a form that cannot be shown.
        const schemaKeys = new Set(Object.keys((waveApplicationSchema as any).shape));
        expect(Object.keys(WAVE_FIELD_PLACES).filter((k) => !schemaKeys.has(k))).toEqual([]);
    });

    it('AND EVERY STEP INDEX IS A REAL STEP', () => {
        for (const [field, place] of Object.entries(WAVE_FIELD_PLACES)) {
            expect({ field, valid: place.step >= 0 && place.step < WAVE_STEPS.length })
                .toEqual({ field, valid: true });
            expect({ field, labelled: place.label.trim().length > 1 })
                .toEqual({ field, labelled: true });
        }
    });

    it('AND THE WIZARD STILL HAS THE STEPS THE TABLE NAMES', () => {
        //   WAVE_STEPS is a copy of the client's own STEPS array, and a copy
        //   that drifts sends her to the wrong section. Pinned to the source.
        const client = code('src/app/wave/application/WaveApplicationClient.tsx');
        for (const step of WAVE_STEPS) {
            expect({ step, present: client.includes(`"${step}"`) })
                .toEqual({ step, present: true });
        }
    });
});

describe('both doors and the form read the one schema', () => {
    const ACTION = 'src/app/actions/wave/_wv_applications.ts';
    const CLIENT = 'src/app/wave/application/WaveApplicationClient.tsx';

    it('THE ACTION NO LONGER KEEPS ITS OWN SCHEMA', () => {
        const action = code(ACTION);
        expect(action).not.toContain('const waveApplicationSchema = z.object(');
        expect(action).toContain('waveApplicationSchema');
        expect(action).toContain('@/lib/wave-application-fields');
    });

    it('AND BOTH ITS DOORS RETURN THE SHARED SENTENCE', () => {
        const action = code(ACTION);

        //   Enrolment and resubmission. The two had the same line and #494 had
        //   already found them drifting on a different check in this same file.
        expect((action.match(/waveFieldRefusal\(validation\.error\.issues\[0\]\)/g) || []).length)
            .toBe(2);
        //   And neither still hands back the bare message.
        expect(action).not.toContain("validation.error.issues[0]?.message ||");
    });

    it('AND THE FORM PARSES THE SAME SCHEMA BEFORE IT SUBMITS', () => {
        const client = code(CLIENT);

        expect(client).toContain('waveApplicationSchema.safeParse(formData)');
        expect(client).toContain('waveFieldRefusal(issue)');
        expect(client).toContain('waveFieldStep(issue)');
    });

    it('AND THE ELEVEN-FIELD HAND-WRITTEN GUARD IS GONE', () => {
        /*
         *   Named individually because its absence is the finding. Each of these
         *   was a separate `!formData.x.trim()` on a list that stopped at
         *   eleven, and the point is that no such list exists any more.
         */
        const client = code(CLIENT);

        for (const gone of ['missingPersonal', 'missingNok', 'missingFinancial']) {
            expect({ gone, present: client.includes(gone) }).toEqual({ gone, present: false });
        }
        //   And the form still sends her back to a step rather than leaving her
        //   on Review with a toast — which is what the old guard got right.
        expect(client).toContain('goToStep(step)');
    });
});

/*
 *   AND THE STEP THAT IS SUPPOSED TO COLLECT EACH FIELD.
 *
 *   The three WAVE step components are what put this finding on the list, so
 *   they are asserted rather than merely read. The defect class is the one this
 *   audit meets most: a form that does not collect a field its own server
 *   requires. On the land module the same check found /land/submit offering a
 *   Lease option and collecting no term (#901); here it is the reason a refusal
 *   could ever be produced by a completed form at all.
 */
describe('each step collects the fields its section requires', () => {
    /** The component that renders each index of WAVE_STEPS. */
    const STEP_FILES = [
        'src/app/wave/application/steps/PersonalDetailsStep.tsx',
        'src/app/wave/application/steps/CivicStatusStep.tsx',
        'src/app/wave/application/steps/SocioEconomicStep.tsx',
        'src/app/wave/application/steps/AgriInterestStep.tsx',
        'src/app/wave/application/steps/FinancialStep.tsx',
        'src/app/wave/application/steps/TrainingStep.tsx',
        'src/app/wave/application/ReviewStep.tsx',
    ];

    /**
     * The fields the schema will not accept as absent, by the step that owns
     * them — taken from the schema itself rather than listed here.
     */
    function requiredByStep(): Record<number, string[]> {
        const shape = (waveApplicationSchema as any).shape as Record<string, any>;
        const out: Record<number, string[]> = {};

        for (const [field, place] of Object.entries(WAVE_FIELD_PLACES)) {
            //   `undefined` refused = the schema requires it. Asked of the
            //   schema so an entry made optional later drops out on its own.
            if (shape[field]?.safeParse?.(undefined)?.success !== false) continue;
            (out[place.step] ||= []).push(field);
        }
        return out;
    }

    it('THE SCHEMA HAS REQUIRED FIELDS IN EVERY SECTION (control)', () => {
        //   THE control: the loop below is "every required field appears in its
        //   step", and an empty required-list would pass for every step.
        const required = requiredByStep();

        expect(STEP_FILES.length).toBe(WAVE_STEPS.length);
        for (let step = 0; step < WAVE_STEPS.length; step++) {
            expect({ step, count: (required[step] ?? []).length > 0 })
                .toEqual({ step, count: true });
        }
    });

    it('AND EVERY REQUIRED FIELD IS NAMED BY THE STEP THAT OWNS IT', () => {
        /*
         *   A field the schema demands and no step renders is an application
         *   nobody can complete — and the applicant would find out at the end,
         *   which is the whole of this finding.
         *
         *   `age` is the one exception and it is a real one: PersonalDetailsStep
         *   DERIVES it from the date of birth rather than asking, which is right
         *   — an age typed independently of a date of birth is two answers that
         *   can disagree. It still appears in that file, so no exception is
         *   needed here; this note exists so the next reader does not add one.
         */
        const required = requiredByStep();

        for (let step = 0; step < STEP_FILES.length; step++) {
            const src = code(STEP_FILES[step]);
            const missing = (required[step] ?? []).filter((field) => !src.includes(field));

            expect({ step: WAVE_STEPS[step], missing }).toEqual({ step: WAVE_STEPS[step], missing: [] });
        }
    });
});
