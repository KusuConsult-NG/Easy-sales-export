/**
 * @jest-environment jsdom
 */

/**
 *   THE OWNER: "in marketplace, the buyer can be an individual so the form for
 *   onboarding has to change… when a buyer select a company, business status
 *   should show; if its an individual then it can continue with the flow, but
 *   if its business it should take business information."
 *
 *   STEP 2 ASKED EVERY APPLICANT FOR A BUSINESS. Its heading is "Business
 *   Profile", its first field is "Business/Farm Name *", and below it sits
 *   "Business Status *" — registered, in progress, or not registered. All of it
 *   was required, of everybody, by one shared rule
 *   (lib/marketplace-application) that the step, the submit guard and the
 *   server action all apply.
 *
 *   Most buyers on this platform are people buying food. They have no business
 *   name to give and no registration to declare, and the form would not
 *   continue without both — so the only way past it was to invent a business,
 *   which is a false answer stored on a real application and shown to the admin
 *   who reviews it.
 *
 *   A SELLER STILL ANSWERS BOTH, whatever they call themselves. The name is on
 *   every listing they publish and the status is what tells a reviewer whether
 *   to expect the CAC certificate the verification step marks Optional for
 *   everyone. So the question is not "is this person an individual" but "is
 *   there a business here to describe" — describesABusiness.
 *
 *   WHAT AN INDIVIDUAL STILL ANSWERS: business type (it is the switch), phone,
 *   state, LGA and address. A buyer has to be reachable and deliverable to.
 *
 *   AND THE APPLICATION IS STILL FILED UNDER A NAME. `businessName` is what
 *   every reader of an application shows — the admin queue lists it, the
 *   verification record carries it, the canonical profile stores it. An
 *   individual's application is filed under their OWN name, read from their
 *   user document rather than taken from the request, with
 *   `businessType: "individual"` beside it saying which it is.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
    describesABusiness,
    missingApplicationFields,
    missingForStep,
} from '@/lib/marketplace-application';

import BusinessProfileStep from '@/app/marketplace/onboarding/steps/BusinessProfileStep';

const fieldsMissingFrom = (application: unknown): string[] =>
    missingApplicationFields(application as never).map((m) => m.field);

/** A complete individual BUYER application — no business anywhere in it. */
const individualBuyer = () => ({
    accountType: 'buyer',
    businessType: 'individual',
    phone: '08012345678',
    location: { state: 'Plateau', lga: 'Jos North', address: '12 Market Road' },
    buyerInterests: ['Grains & Cereals'],
    termsAccepted: true,
});

describe('the rule — who has a business to describe', () => {
    it('AN INDIVIDUAL BUYER IS COMPLETE WITH NO BUSINESS NAME AND NO STATUS', () => {
        expect(missingApplicationFields(individualBuyer() as never)).toEqual([]);
    });

    it('and a company buyer is asked for both', () => {
        const company = { ...individualBuyer(), businessType: 'company' };

        expect(fieldsMissingFrom(company)).toEqual(['businessName', 'businessStatus']);
    });

    it('a cooperative buyer too — "business" is not only a company', () => {
        const coop = { ...individualBuyer(), businessType: 'cooperative' };

        expect(fieldsMissingFrom(coop)).toEqual(['businessName', 'businessStatus']);
    });

    it('A SELLER IS ASKED FOR BOTH EVEN AS AN INDIVIDUAL', () => {
        //   The name is on every listing they publish; the status is what tells
        //   a reviewer whether to expect a certificate.
        const seller = {
            ...individualBuyer(),
            accountType: 'seller',
            sellerCategory: 'wholesale',
            sellerCategories: ['grains'],
            productStatus: 'available',
            bankAccount: { bankName: 'Zenith', accountNumber: '0123456789', accountName: 'Ada Obi' },
        };

        expect(fieldsMissingFrom(seller)).toEqual(['businessName', 'businessStatus']);
    });

    it('and so is "both", which is a seller with a buyer attached', () => {
        const both = {
            ...individualBuyer(),
            accountType: 'both',
            sellerCategory: 'retail',
            sellerCategories: ['grains'],
            productStatus: 'available',
            bankAccount: { bankName: 'Zenith', accountNumber: '0123456789', accountName: 'Ada Obi' },
        };

        expect(fieldsMissingFrom(both)).toEqual(['businessName', 'businessStatus']);
    });

    it('THE CONTACT HALF IS STILL ASKED OF EVERYBODY', () => {
        //   A buyer who cannot be reached or delivered to is not an easier
        //   form, it is an unusable order.
        const bare = { accountType: 'buyer', businessType: 'individual', termsAccepted: true, buyerInterests: ['Grains & Cereals'] };

        expect(fieldsMissingFrom(bare)).toEqual(['phone', 'state', 'lga', 'address']);
    });

    it('and the address is described as what it is for', () => {
        const buyer = { ...individualBuyer(), location: { state: 'Plateau', lga: 'Jos North', address: '' } };
        const company = { ...buyer, businessType: 'company', businessName: 'Obi Ltd', businessStatus: 'registered' };

        expect(missingForStep(2, buyer as never).address).toMatch(/delivery address/i);
        expect(missingForStep(2, company as never).address).toMatch(/business address/i);
    });

    it('the business TYPE is still required — this did not make it optional', () => {
        const noType = { ...individualBuyer() } as Record<string, unknown>;
        delete noType.businessType;

        //   And an applicant who never chose one is treated as having a
        //   business, so they are asked rather than skipped.
        expect(describesABusiness(noType as never)).toBe(true);
        expect(fieldsMissingFrom(noType)).toEqual(['businessName', 'businessType', 'businessStatus']);
    });
});

describe('the step — what an individual buyer is shown', () => {
    const noop = () => {};
    const contact = { phone: '', location: { state: '', lga: '', address: '' } };

    function renderStep(accountType: 'buyer' | 'seller' | 'both', businessType: string) {
        return render(
            <BusinessProfileStep
                accountType={accountType}
                data={{ businessName: '', businessType, ...contact } as never}
                onChange={noop}
                onNext={noop}
                onBack={noop}
            />,
        );
    }

    it('NO BUSINESS NAME AND NO BUSINESS STATUS ON THE SCREEN', () => {
        renderStep('buyer', 'individual');

        expect(screen.queryByText(/Business\/Farm Name/i)).toBeNull();
        expect(screen.queryByLabelText(/Business Status/i)).toBeNull();
    });

    it('and the heading stops calling a shopper a business', () => {
        renderStep('buyer', 'individual');

        expect(screen.getByText('Your Details')).toBeTruthy();
        expect(screen.queryByText('Business Profile')).toBeNull();
    });

    it('THE TYPE IS STILL THERE — it is the switch', () => {
        renderStep('buyer', 'individual');

        expect(screen.getByText('Business Type *')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Company' })).toBeTruthy();
    });

    it('CHOOSING COMPANY BRINGS THE BUSINESS QUESTIONS BACK', async () => {
        //   Rendered at each value rather than clicked, because `data` is owned
        //   by the wizard above this step — which is also why the assertion is
        //   about what the step DRAWS for a value, not about its own state.
        renderStep('buyer', 'company');

        expect(screen.getByText(/Business\/Farm Name/i)).toBeTruthy();
        expect(screen.getByLabelText(/Business Status/i)).toBeTruthy();
    });

    it('a seller sees them even as an individual', () => {
        renderStep('seller', 'individual');

        expect(screen.getByText(/Business\/Farm Name/i)).toBeTruthy();
        expect(screen.getByLabelText(/Business Status/i)).toBeTruthy();
    });

    it('and the address says what it is for', () => {
        renderStep('buyer', 'individual');
        expect(screen.getByText(/Delivery Address/i)).toBeTruthy();

        renderStep('buyer', 'company');
        expect(screen.getByText(/Business Address/i)).toBeTruthy();
    });

    it('CONTINUE ACTUALLY CONTINUES for an individual buyer', async () => {
        //   The failure this whole change is about: a step whose own Continue
        //   button refuses on a field it is not showing leaves somebody on a
        //   screen with nothing to correct.
        const user = userEvent.setup();
        const onNext = jest.fn();

        render(
            <BusinessProfileStep
                accountType="buyer"
                data={{
                    businessName: '',
                    businessType: 'individual',
                    phone: '08012345678',
                    location: { state: 'Plateau', lga: 'Jos North', address: '12 Market Road' },
                } as never}
                onChange={noop}
                onNext={onNext}
                onBack={noop}
            />,
        );

        await user.click(screen.getByRole('button', { name: /continue/i }));

        expect(onNext).toHaveBeenCalled();
    });

    it('AND CONTINUE REFUSES AN INDIVIDUAL SELLER WITH NO BUSINESS NAME', async () => {
        //   The step's own validate() has to be given the account type, or it
        //   reads a seller as "no account type, individual, therefore no
        //   business" and waves through an application the submit guard and the
        //   server will both refuse — the step laxer than the rule, which is
        //   the divergence lib/marketplace-application exists to stop.
        const user = userEvent.setup();
        const onNext = jest.fn();

        render(
            <BusinessProfileStep
                accountType="seller"
                data={{
                    businessName: '',
                    businessType: 'individual',
                    phone: '08012345678',
                    location: { state: 'Plateau', lga: 'Jos North', address: '12 Market Road' },
                } as never}
                onChange={noop}
                onNext={onNext}
                onBack={noop}
            />,
        );

        await user.click(screen.getByRole('button', { name: /continue/i }));

        expect(onNext).not.toHaveBeenCalled();
        expect(screen.getByText(/Business\/Farm name is required/i)).toBeTruthy();
    });

    it('and it still refuses a company buyer with no business name (control)', async () => {
        const user = userEvent.setup();
        const onNext = jest.fn();

        render(
            <BusinessProfileStep
                accountType="buyer"
                data={{
                    businessName: '',
                    businessType: 'company',
                    phone: '08012345678',
                    location: { state: 'Plateau', lga: 'Jos North', address: '12 Market Road' },
                } as never}
                onChange={noop}
                onNext={onNext}
                onBack={noop}
            />,
        );

        await user.click(screen.getByRole('button', { name: /continue/i }));

        expect(onNext).not.toHaveBeenCalled();
        expect(screen.getByText(/Business\/Farm name is required/i)).toBeTruthy();
    });
});

describe('the wizard tells the step who is filling it in', () => {
    const WIZARD = 'src/app/marketplace/onboarding/MarketplaceOnboardingClient.tsx';

    it('BusinessProfileStep IS GIVEN THE ACCOUNT TYPE', () => {
        //   Without it the step reads every applicant as "no account type,
        //   therefore judge by business type alone", and an individual SELLER
        //   walks past a Continue button that the server will refuse. The step
        //   tests above pass the prop themselves, so only this sees the wiring.
        const src = readFileSync(join(process.cwd(), WIZARD), 'utf-8');
        const at = src.indexOf('<BusinessProfileStep');
        expect(at).toBeGreaterThan(-1);

        const props = src.slice(at, src.indexOf('/>', at));
        expect(props).toContain('accountType={formData.accountType}');
    });
});

describe('the application is still filed under a name', () => {
    const ACTION = 'src/app/actions/marketplace/_mp_onboarding.ts';
    const src = () => readFileSync(join(process.cwd(), ACTION), 'utf-8');

    it('THE SERVER FALLS BACK TO THE APPLICANT\'S OWN NAME, from their user row', () => {
        const code = src();

        expect(code).toContain('const applicantName = (() => {');
        //   From the user document, not from the request — a name shown to an
        //   admin reviewer must not be whatever the browser said it was.
        expect(code).toMatch(/const u = \(userDoc\.data\(\) \?\? \{\}\) as Record<string, unknown>;/);
        expect(code).not.toMatch(/name: formData\.get\("businessName"\) as string/);
    });

    it('and both records that show a name use it', () => {
        const code = src();

        //   The verification record an approver reads, and the canonical
        //   profile. A blank in either is a real person with no name on screen.
        expect(code).toContain('businessName: applicantName,');
        expect(code).toContain('name: applicantName,');
    });
});
