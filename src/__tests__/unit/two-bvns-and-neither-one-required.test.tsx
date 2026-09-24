/**
 * @jest-environment jsdom
 */

/**
 *   THE OWNER: "remove voter's card on export window onboarding and mandate
 *   NIN and BVN" — then, on walking the flow: "BVN is required 2 times
 *   instead of once."
 *
 * ── NEITHER NUMBER WAS REQUIRED, AND ONE OF THEM WAS ASKED TWICE ────────────
 *
 *   Three doors onto one application, all three saying "only if you typed
 *   one":
 *
 *     KYCVerificationStep   "Require NIN verification only if NIN is entered"
 *     the submit guard      "Identity / BVN verification is required if
 *                            details are entered"
 *     the server schema     nationalIdField(), `.optional()` with a format
 *                           check that applies only when a value is present
 *
 *   An export application could be filed and approved with no NIN, no BVN and
 *   no verification of either. Export pays people — the settlement account is
 *   re-resolved server-side (#346) for exactly that reason — and the identity
 *   behind it was optional.
 *
 *   MEANWHILE THE BVN WAS COLLECTED TWICE: once on the identity step, marked
 *   "(Optional)", and again on the bank step behind a red asterisk. The
 *   asterisked one was the weaker of the two despite looking stronger:
 *
 *     ·  it did not block — BankAccountStep's guard reads `!bankData.verified`,
 *        which is the ACCOUNT's flag;
 *     ·  nothing checked it — #522 records the route answering
 *        `checked: false` because #485 parked the provider;
 *     ·  and the record never got it — `exportOnboardingSchema.bank` declares
 *        four keys, and Zod strips the rest.
 *
 *   So: asked once, on the identity step, where it is stored; required there,
 *   by a rule all three doors share.
 *
 * ── AND THE VOTER'S CARD IS GONE FROM THE FORM, NOT FROM ANYONE'S RECORD ────
 *
 *   A third identity field whose Verify button wrote
 *   `votersCardVerificationMethod: 'self_declared'` — there is no live VIN
 *   database to ask. Stored values stay exactly where they are, and WAVE
 *   collects its own VIN on its own step, which this does not touch.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { readFileSync } from 'fs';
import { join } from 'path';
import { missingExportIdentity, hasExportIdentity } from '@/lib/export-identity';

const showToast = jest.fn();

jest.mock('@/app/actions/kyc', () => ({
    verifyBVNAction: jest.fn(),
    verifyNINAction: jest.fn(),
    saveKYCProfileAction: jest.fn(),
}));
jest.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast }) }));
jest.mock('@/app/actions/paystack', () => ({
    getBankList: jest.fn(async () => ({ success: true, data: [] })),
}));

import { KYCVerificationStep } from '@/app/export/onboarding/steps/KYCVerificationStep';
import { BankAccountStep } from '@/app/export/onboarding/steps/BankAccountStep';

const source = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf-8');
const code = (rel: string) =>
    source(rel)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .map((l) => l.replace(/\s\/\/.*$/, ''))
        .join('\n');

/** A complete, verified identity. */
const verified = () => ({
    nin: '22334455667',
    bvn: '33445566778',
    ninVerified: true,
    bvnVerified: true,
});

beforeEach(() => jest.clearAllMocks());

describe('the rule — both documents, verified', () => {
    it('A COMPLETE IDENTITY IS MISSING NOTHING — the control', () => {
        expect(missingExportIdentity(verified())).toEqual([]);
        expect(hasExportIdentity(verified())).toBe(true);
    });

    it('AN EMPTY ONE IS REFUSED, which is the whole change', () => {
        //   This is what walked straight through before: nothing entered, so
        //   nothing to check.
        expect(missingExportIdentity({}).map((m) => m.field)).toEqual(['nin', 'bvn']);
    });

    it('a number typed but not verified is not an identity', () => {
        const typed = { nin: '22334455667', bvn: '33445566778' };

        expect(missingExportIdentity(typed).map((m) => m.field)).toEqual(['ninVerified', 'bvnVerified']);
    });

    it('and each is required on its own', () => {
        expect(missingExportIdentity({ ...verified(), nin: '' }).map((m) => m.field)).toEqual(['nin']);
        expect(missingExportIdentity({ ...verified(), bvn: '' }).map((m) => m.field)).toEqual(['bvn']);
        expect(missingExportIdentity({ ...verified(), bvnVerified: false }).map((m) => m.field)).toEqual(['bvnVerified']);
    });

    it('eleven digits, not ten and not twelve', () => {
        expect(missingExportIdentity({ ...verified(), nin: '1234567890' })[0].message).toMatch(/exactly 11 digits/);
        expect(missingExportIdentity({ ...verified(), bvn: '123456789012' })[0].message).toMatch(/exactly 11 digits/);
    });

    it('AND JUNK IS REFUSED BY THE SHARED CHECK, not a second opinion', () => {
        //   isObviouslyFakeId, the same one actions/kyc.ts applies — so the
        //   client and the server cannot disagree about what junk is.
        for (const fake of ['11111111111', '12345678901', '00000000000']) {
            expect(missingExportIdentity({ ...verified(), nin: fake })[0].message).toMatch(/does not look real/);
        }
    });

    it('a verified flag that is not strictly true does not count', () => {
        for (const truthy of ['true', 1, 'yes', {}]) {
            expect(missingExportIdentity({ ...verified(), ninVerified: truthy as never }).map((m) => m.field))
                .toEqual(['ninVerified']);
        }
    });
});

describe('the identity step — what it asks for', () => {
    function renderStep() {
        return render(<KYCVerificationStep onNext={jest.fn()} onBack={jest.fn()} />);
    }

    it('THE VOTER\'S CARD IS GONE', () => {
        renderStep();

        expect(screen.queryByText(/Voter/i)).toBeNull();
        expect(document.querySelector('input[placeholder="e.g. 90F5B123456789012345"]')).toBeNull();
    });

    it('and it is gone from the identity-type menu too', () => {
        //   Half a removal — the field gone, the menu option left — would have
        //   let a member declare a document the form no longer collects.
        renderStep();

        const options = Array.from(document.querySelectorAll('option')).map((o) => o.textContent);
        expect(options.some((t) => /voter/i.test(t || ''))).toBe(false);
        expect(options.some((t) => /passport/i.test(t || ''))).toBe(true);
    });

    it('NIN AND BVN ARE BOTH ON SCREEN, and neither says "(Optional)"', () => {
        renderStep();

        const nin = document.querySelector('input[placeholder="11-digit NIN"]');
        const bvn = document.querySelector('input[placeholder="11-digit BVN"]');
        expect(nin).toBeTruthy();
        expect(bvn).toBeTruthy();

        const labels = Array.from(document.querySelectorAll('label')).map((l) => l.textContent || '');
        const ninLabel = labels.find((t) => /NIN \(National Identity Number\)/.test(t)) || '';
        const bvnLabel = labels.find((t) => /BVN \(Bank Verification Number\)/.test(t)) || '';
        expect(ninLabel).not.toMatch(/optional/i);
        expect(bvnLabel).not.toMatch(/optional/i);
    });

    it('EXACTLY ONE BVN FIELD IN THE WHOLE WIZARD', () => {
        //   The reported defect, counted rather than read.
        renderStep();
        const onIdentity = document.querySelectorAll('input[placeholder="11-digit BVN"]').length;

        render(<BankAccountStep onNext={jest.fn()} onBack={jest.fn()} />);
        const everywhere = document.querySelectorAll('input[placeholder="11-digit BVN"]').length;

        expect({ onIdentity, everywhere }).toEqual({ onIdentity: 1, everywhere: 1 });
    });

    it('and the bank step says nothing about a BVN at all', () => {
        render(<BankAccountStep onNext={jest.fn()} onBack={jest.fn()} />);

        expect(screen.queryByText(/Bank Verification Number/i)).toBeNull();
    });
});

/**
 * The step's button, EXECUTED.
 *
 * The three assertions below this one read source, and a source ratchet cannot
 * tell live code from dead code — #287's lesson, and the reason every other
 * suite in this audit mounts what it is about. This fills the personal half of
 * the form and presses Continue.
 */
describe('the step actually refuses', () => {
    /** Everything the step checks BEFORE it looks at the identity. */
    function fillPersonalDetails() {
        const byPlaceholder = (ph: string) =>
            document.querySelector(`[placeholder="${ph}"]`) as HTMLInputElement | HTMLTextAreaElement;

        fireEvent.change(byPlaceholder('e.g. John'), { target: { value: 'Ada' } });
        fireEvent.change(byPlaceholder('e.g. Doe'), { target: { value: 'Obi' } });
        fireEvent.change(byPlaceholder('e.g., Lagos'), { target: { value: 'Enugu' } });

        const date = document.querySelector('input[type="date"]') as HTMLInputElement;
        fireEvent.change(date, { target: { value: '1990-01-01' } });

        const phone = document.querySelector('input[type="tel"]') as HTMLInputElement;
        fireEvent.change(phone, { target: { value: '08012345678' } });

        const address = document.querySelector('textarea') as HTMLTextAreaElement;
        fireEvent.change(address, { target: { value: '12 Ogui Road, Enugu' } });

        const state = Array.from(document.querySelectorAll('select')).find((el) =>
            Array.from(el.options).some((o) => o.value === 'Enugu'),
        ) as HTMLSelectElement;
        fireEvent.change(state, { target: { value: 'Enugu' } });
    }

    it('CONTINUE IS REFUSED WITH NO NIN, and says which one is missing', async () => {
        const onNext = jest.fn();
        render(<KYCVerificationStep onNext={onNext} onBack={jest.fn()} />);

        fillPersonalDetails();
        fireEvent.click(screen.getByRole('button', { name: /continue to bank account/i }));

        await waitFor(() => expect(showToast).toHaveBeenCalled());
        expect(showToast.mock.calls[0][0]).toMatch(/NIN is required/i);
        expect(onNext).not.toHaveBeenCalled();
        /*
         *   EXACTLY ONE, and this is the assertion that has teeth. The
         *   document-upload guard sits BELOW the identity check, so a version
         *   that reported the missing NIN and carried on would still never
         *   reach onNext — it would simply complain about the ID document
         *   next. Counting the toasts is what distinguishes a refusal from a
         *   remark. (A mutant dropping the `return` survived until this line.)
         */
        expect(showToast).toHaveBeenCalledTimes(1);
    });

    it('and a NIN typed but not verified is still refused', async () => {
        const onNext = jest.fn();
        render(<KYCVerificationStep onNext={onNext} onBack={jest.fn()} />);

        fillPersonalDetails();
        const nin = document.querySelector('input[placeholder="11-digit NIN"]') as HTMLInputElement;
        fireEvent.change(nin, { target: { value: '22334455667' } });

        fireEvent.click(screen.getByRole('button', { name: /continue to bank account/i }));

        await waitFor(() => expect(showToast).toHaveBeenCalled());
        expect(showToast.mock.calls[0][0]).toMatch(/verify your NIN/i);
        expect(onNext).not.toHaveBeenCalled();
        expect(showToast).toHaveBeenCalledTimes(1);
    });

    it('the personal-details guard still runs first (control)', async () => {
        //   Vacuity guard: if nothing at all were filled the identity message
        //   would be the wrong one to show, and this test would be proving the
        //   harness rather than the rule.
        const onNext = jest.fn();
        render(<KYCVerificationStep onNext={onNext} onBack={jest.fn()} />);

        fireEvent.click(screen.getByRole('button', { name: /continue to bank account/i }));

        await waitFor(() => expect(showToast).toHaveBeenCalled());
        expect(showToast.mock.calls[0][0]).toMatch(/fill in all required fields/i);
    });
});

describe('all three doors apply the same rule', () => {
    const STEP = 'src/app/export/onboarding/steps/KYCVerificationStep.tsx';
    const GUARD = 'src/app/export/onboarding/ExportOnboardingClient.tsx';
    const SCHEMA = 'src/lib/types/export-actions.ts';

    it.each([STEP, GUARD, SCHEMA])('%s calls missingExportIdentity', (rel: string) => {
        expect(code(rel)).toContain('missingExportIdentity(');
    });

    it('AND NONE OF THEM STILL SAYS "only if entered"', () => {
        //   The three sentences this change is about, each in its own file.
        expect(code(STEP)).not.toMatch(/only if NIN is entered|only if BVN is entered/);
        expect(code(GUARD)).not.toContain('required if details are entered');
        expect(code(STEP)).not.toMatch(/kycData\.nin\.trim\(\) !== ''/);
    });

    it('the server schema no longer carries the voter\'s card', () => {
        const src = code(SCHEMA);

        expect(src).not.toMatch(/votersCard:/);
        expect(src).not.toMatch(/votersCardVerified:/);
        //   Control: the keys #773 rescued are still declared, so this did not
        //   quietly narrow the schema.
        expect(src).toContain('dateOfBirth:');
        expect(src).toContain('idNumber:');
    });

    it('and the bank component no longer emits a BVN the schema would strip', () => {
        const src = code('src/components/onboarding/BankAccountVerification.tsx');

        expect(src).not.toMatch(/bvnVerified:\s*bvnVerified/);
        expect(src).not.toContain('/api/kyc/verify-bvn');
        //   Control: it still does the job it is for.
        expect(src).toContain('/api/kyc/verify-bank-account');
    });
});

describe('nothing was taken from anyone\'s record', () => {
    it('THE VOTER-CARD VERIFICATION AND ITS VALIDATORS STILL EXIST', () => {
        //   The owner's standing rule: fix the errors, keep the data. WAVE
        //   still collects a VIN on its own step and admin screens still read
        //   what is stored.
        expect(code('src/app/actions/kyc.ts')).toContain('verifyVotersCardAction');
        expect(code('src/lib/kyc-validators.ts')).toContain('optionalVotersCardField');
    });

    it('and WAVE still asks for one, which this did not touch', () => {
        expect(code('src/app/wave/application/steps/CivicStatusStep.tsx')).toContain('votersCardNumber');
    });
});
