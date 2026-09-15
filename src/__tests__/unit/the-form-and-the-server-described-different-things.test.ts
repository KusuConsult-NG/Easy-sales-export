/**
 * @jest-environment node
 */

/**
 *   #773 THE EXPORT ONBOARDING FORM AND THE SERVER VALIDATED TWO DIFFERENT
 *        SHAPES, SO THE SUBMISSION WAS REFUSED — AND WHEN IT PARSED, NINE
 *        FIELDS THE MEMBER HAD TO FILL WERE THROWN AWAY.
 *
 *   Reported by the owner: "details added to the form and some are missing in
 *   the process of submission, why?"
 *
 * ── MEASURED, WITH EXACTLY WHAT THE CLIENT SENDS ────────────────────────────
 *
 *   submitExportOnboardingAction, given the payload ExportOnboardingClient
 *   builds after its own Zod guard passes:
 *
 *       { success: false,
 *         error: "Invalid input: expected string, received undefined" }
 *       0 application rows written
 *       the user record untouched
 *
 *   Eight required fields arrive undefined, because the two schemas disagree
 *   about what each bag holds:
 *
 *       profile.firstName, lastName, phone, state, lga, address
 *       terms.termsAccepted, privacyAccepted
 *
 *   The client's `profile` is the INVESTMENT step — minInvestment,
 *   maxInvestment, investmentGoals, riskTolerance. The server's `profile` is
 *   the IDENTITY. The identity the member typed sits in `kycData`, on which
 *   the server declares none of those keys.
 *
 *   SO EXPORT ONBOARDING COULD NOT BE COMPLETED AT ALL, and the message named
 *   no field. Resubmission had the same break plus one more level of it: it
 *   passes `fields.kyc`, which is `{ kycData, documents }`, where the schema
 *   expects the kycData itself — so every KYC key parsed as undefined, passed
 *   because they are optional, and stored nothing.
 *
 * ── AND NINE FIELDS WERE DROPPED WHEN IT DID PARSE ──────────────────────────
 *
 *       sent     firstName, lastName, otherNames, dateOfBirth, phoneNumber,
 *                address, city, state, idType, nin, bvn, ninVerified, bvnVerified
 *       kept     nin, bvn, ninVerified, bvnVerified
 *       dropped  the other nine
 *
 *   Every one is REQUIRED by KYCVerificationStep before it lets the member
 *   past. #349 recorded this exact mechanism on this exact object — "Zod strips
 *   unknown keys, so the number and its verification were dropped between the
 *   step and the record — collected, validated, and never stored" — and fixed
 *   it for the voter's card alone.
 *
 *   The investment step was worse: all four of its answers went into `profile`,
 *   which does not declare them, so the FIRST STEP OF THE WIZARD was recorded
 *   nowhere at all.
 *
 * ── A CORRECTION I OWE ──────────────────────────────────────────────────────
 *
 *   #763 reported "EXPORT: submit → approve → access ✓" and called the export
 *   journey sound end to end. That was true of the SERVER given a
 *   server-shaped payload — which I built myself. It never proved the CLIENT
 *   sends that shape, and it does not. Testing an action with my own fixture
 *   instead of the real caller's payload is the instrument-first failure this
 *   audit exists to catch, committed by me; the suite below feeds the mapper's
 *   output to the server's own schema so the two cannot agree only in my head.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';
import { exportOnboardingSchema } from '@/lib/types/export-actions';
import {
    toExportOnboardingPayload,
    termsAccepted,
    privacyAccepted,
} from '@/lib/export-onboarding-payload';

jest.mock('@/lib/redis', () => ({ getCached: async () => null, setCache: async () => undefined, deleteCache: async () => undefined, redis: null }));
jest.mock('@/lib/auth', () => ({ auth: async () => null, signIn: async () => undefined, signOut: async () => undefined, handlers: {} }));
jest.mock('@/lib/bank-account-resolve', () => ({
    resolveBankAccount: async () => ({ ok: true, accountName: 'ADA OBI', accountNumber: '0123456789', bankId: 1 }),
    isPlausibleAccountNumber: () => true,
}));
jest.mock('@/lib/storage-admin', () => ({ uploadFileToStorage: async () => 'https://cdn.example/doc.pdf' }));

let store: FakeDbHandle;
const USER = 'applicant-1';

/**
 * EXACTLY what the wizard holds when the last step is reached.
 *
 * Every field here is one KYCVerificationStep or InvestmentProfileStep refuses
 * to advance without — so this is not a generous fixture, it is the minimum a
 * real member must type.
 */
const WIZARD = {
    profile: {
        minInvestment: 100000, maxInvestment: 500000,
        investmentGoals: ['growth'], riskTolerance: 'medium',
    },
    kyc: {
        kycData: {
            firstName: 'Ada', lastName: 'Obi', otherNames: 'Ngozi',
            dateOfBirth: '1995-03-02', phoneNumber: '08012345678',
            address: '12 Broad Street, Ikeja', city: 'Ikeja', state: 'Lagos',
            idType: 'nin', nin: '74920385617', bvn: '50831726495',
            ninVerified: true, bvnVerified: true,
        },
        documents: {},
    },
    bank: { bankName: 'GTBank', accountNumber: '0123456789', accountName: 'Ada Obi', verified: true },
    terms: { acceptedInvestment: true, acceptedRisk: true, acceptedEscrow: true, acceptedPrivacy: true },
};

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    (globalThis as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id: USER, roles: ['general_user'], email: 'ada@e.com', name: 'Ada' } }, error: null,
    }));
    store.seed(COLLECTIONS.USERS, USER, { email: 'ada@e.com', roles: ['general_user'] });
});

function formFrom(payload: ReturnType<typeof toExportOnboardingPayload>): FormData {
    const fd = new FormData();
    fd.append('profile', JSON.stringify(payload.profile));
    fd.append('kycData', JSON.stringify(payload.kycData));
    fd.append('investment', JSON.stringify(payload.investment));
    fd.append('bank', JSON.stringify(payload.bank));
    fd.append('terms', JSON.stringify(payload.terms));
    fd.append('idDocument', 'https://cdn.example/id.pdf');
    fd.append('proofOfAddress', 'https://cdn.example/poa.pdf');
    return fd;
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#773 — the premise: the raw wizard shape is refused', () => {
    it('THE SERVER SCHEMA REJECTS WHAT THE FORM USED TO SEND', () => {
        /*
         *   The defect, as one assertion. This is the object the client built
         *   and posted, after its own Zod guard passed.
         */
        const raw = exportOnboardingSchema.safeParse({
            profile: WIZARD.profile,
            kycData: WIZARD.kyc.kycData,
            bank: WIZARD.bank,
            terms: WIZARD.terms,
        });

        expect(raw.success).toBe(false);
        const paths = raw.success ? [] : raw.error.issues.map((i) => i.path.join('.'));
        for (const missing of [
            'profile.firstName', 'profile.lastName', 'profile.phone',
            'profile.state', 'profile.lga', 'profile.address',
            'terms.termsAccepted', 'terms.privacyAccepted',
        ]) {
            expect({ missing, refused: paths.includes(missing) }).toEqual({ missing, refused: true });
        }
    });

    it('AND THE MESSAGE NAMED NO FIELD, which is what the member saw', () => {
        //   "Invalid input: expected string, received undefined" — the action
        //   returns `issues[0].message`, and it identifies nothing.
        const raw = exportOnboardingSchema.safeParse({
            profile: WIZARD.profile, kycData: WIZARD.kyc.kycData,
            bank: WIZARD.bank, terms: WIZARD.terms,
        });

        const first = raw.success ? '' : raw.error.issues[0].message;
        expect(first).toContain('received undefined');
        expect(first).not.toContain('firstName');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#773 — the mapper produces what the server stores', () => {
    it('ITS OUTPUT PARSES AGAINST THE SERVER\'S OWN SCHEMA', () => {
        /*
         *   THE test, and the one that stops the two drifting again: the
         *   mapper's result is fed to the schema the action uses, so "the
         *   client and the server agree" is executed rather than believed.
         */
        const parsed = exportOnboardingSchema.safeParse(
            toExportOnboardingPayload(WIZARD, 'ada@e.com'),
        );

        expect(parsed.success).toBe(true);
    });

    it('AND NOTHING THE MAPPER SENDS IS SILENTLY DISCARDED', () => {
        /*
         *   THE general assertion, and the one this finding is actually about.
         *   Zod strips what it does not declare and says nothing, so a key put
         *   in the wrong bag disappears with no error anywhere — which is how
         *   nine required fields went missing for as long as they did.
         *
         *   ADDED BECAUSE A MUTANT SURVIVED. The sweep moved an investment
         *   figure back into `profile`, where the schema drops it, and every
         *   test still passed: each one checked that the fields it cared about
         *   were PRESENT, and none could see a field vanish. Asserting the key
         *   sets match makes the silent path loud.
         */
        const payload = toExportOnboardingPayload(WIZARD, 'ada@e.com');
        const parsed = exportOnboardingSchema.safeParse(payload);
        expect(parsed.success).toBe(true);
        if (!parsed.success) return;

        for (const bag of ['profile', 'kycData', 'bank', 'terms', 'investment'] as const) {
            const sent = Object.keys((payload as unknown as Record<string, Record<string, unknown>>)[bag]).sort();
            const kept = Object.keys((parsed.data as unknown as Record<string, Record<string, unknown>>)[bag] ?? {}).sort();
            const dropped = sent.filter((k) => !kept.includes(k));

            expect({ bag, dropped }).toEqual({ bag, dropped: [] });
        }
    });

    it('AND THE IDENTITY REACHES profile, WHERE THE ADMIN LIST READS IT', () => {
        const { profile } = toExportOnboardingPayload(WIZARD, 'ada@e.com');

        expect(profile).toMatchObject({
            firstName: 'Ada', lastName: 'Obi', otherName: 'Ngozi',
            phone: '08012345678', state: 'Lagos', address: '12 Broad Street, Ikeja',
        });
        //   The step asks for a city and never an LGA — see the mapper.
        expect(profile.lga).toBe('Ikeja');
    });

    it('AND NOT ONE OF THE NINE DROPPED FIELDS IS LOST', () => {
        /*
         *   Measured before the fix: kycData kept four keys of thirteen. Each
         *   of the nine is required by KYCVerificationStep, so each is
         *   something the member was made to type.
         */
        const payload = toExportOnboardingPayload(WIZARD, 'ada@e.com');
        const parsed = exportOnboardingSchema.safeParse(payload);
        expect(parsed.success).toBe(true);
        if (!parsed.success) return;

        const kept = { ...parsed.data.profile, ...parsed.data.kycData } as Record<string, unknown>;

        expect(kept.firstName).toBe('Ada');
        expect(kept.lastName).toBe('Obi');
        expect(kept.otherNames).toBe('Ngozi');
        expect(kept.dateOfBirth).toBe('1995-03-02');
        expect(kept.phone).toBe('08012345678');
        expect(kept.address).toBe('12 Broad Street, Ikeja');
        expect(kept.city).toBe('Ikeja');
        expect(kept.state).toBe('Lagos');
        expect(kept.idType).toBe('nin');
    });

    it('AND THE INVESTMENT STEP IS RECORDED, which it never was', () => {
        //   All four answers went into `profile`, which does not declare them,
        //   so the first step of the wizard was stored nowhere.
        const parsed = exportOnboardingSchema.safeParse(
            toExportOnboardingPayload(WIZARD, 'ada@e.com'),
        );
        expect(parsed.success).toBe(true);
        if (!parsed.success) return;

        expect(parsed.data.investment).toMatchObject({
            minInvestment: 100000, maxInvestment: 500000,
            investmentGoals: ['growth'], riskTolerance: 'medium',
        });
    });

    it('AND THE TERMS ARE TRANSLATED, not dropped for using the other wording', () => {
        //   The step writes four booleans; the server asks two questions. All
        //   three spellings the client's own schema accepts mean the same
        //   thing, so they are resolved in one place.
        expect(termsAccepted(WIZARD.terms)).toBe(true);
        expect(privacyAccepted(WIZARD.terms)).toBe(true);
        //   The legacy single checkbox, which a saved draft may still carry.
        expect(termsAccepted({ agreedToTerms: true })).toBe(true);
        expect(termsAccepted({ accepted: true })).toBe(true);
    });

    it('CONTROL — an unaccepted form is still refused', () => {
        /*
         *   A mapper that answered "yes" regardless would make every assertion
         *   above pass and record a consent nobody gave. Three of the four
         *   boxes is not acceptance.
         */
        expect(termsAccepted({ acceptedInvestment: true, acceptedRisk: true, acceptedEscrow: true })).toBe(false);
        expect(termsAccepted({})).toBe(false);
        expect(privacyAccepted({})).toBe(false);

        const parsed = exportOnboardingSchema.safeParse(
            toExportOnboardingPayload({ ...WIZARD, terms: {} }, 'ada@e.com'),
        );
        expect(parsed.success).toBe(true);
        if (parsed.success) expect(parsed.data.terms.termsAccepted).toBe(false);
    });

    it('and a half-filled wizard does not throw', () => {
        //   It runs on every submit attempt, including from a restored draft.
        expect(() => toExportOnboardingPayload({}, null)).not.toThrow();
        expect(() => toExportOnboardingPayload({ kyc: null, bank: null }, undefined)).not.toThrow();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#773 — end to end, against the real action', () => {
    it('THE SUBMISSION LANDS, AND THE RECORD CARRIES WHAT WAS TYPED', async () => {
        const m = await import('@/app/actions/export/_ex_onboarding');

        const res: any = await m.submitExportOnboardingAction(
            null, formFrom(toExportOnboardingPayload(WIZARD, 'ada@e.com')),
        );

        expect(res.success).toBe(true);

        const rows = store.all(COLLECTIONS.EXPORT_APPLICATIONS);
        expect(rows).toHaveLength(1);

        const app = (rows[0] as any)[1];
        expect(app.profile).toMatchObject({ firstName: 'Ada', lastName: 'Obi', phone: '08012345678' });
        expect(app.kyc).toMatchObject({ dateOfBirth: '1995-03-02', city: 'Ikeja', idType: 'nin' });
        expect(app.investment).toMatchObject({ minInvestment: 100000, riskTolerance: 'medium' });
    });

    it('AND THE USER RECORD GETS THE NAME AND PHONE THE ADMIN LIST READS', async () => {
        /*
         *   The owner's older report — "when admin views members most times
         *   they see empty fields and missing informations". The action mirrors
         *   these to the user document, and it never had them to mirror.
         */
        const m = await import('@/app/actions/export/_ex_onboarding');
        await m.submitExportOnboardingAction(
            null, formFrom(toExportOnboardingPayload(WIZARD, 'ada@e.com')),
        );

        const u = store.get(COLLECTIONS.USERS, USER)!;
        expect(u.firstName).toBe('Ada');
        expect(u.lastName).toBe('Obi');
        expect(u.fullName).toBe('Ada Ngozi Obi');
        expect(u.phone).toBe('08012345678');
    });

    it('AND THE RESUBMIT PATH UNWRAPS kyc THE SAME WAY', () => {
        /*
         *   It read `fields.kyc`, which is `{ kycData, documents }`, and handed
         *   the wrapper to a schema expecting the inner object — every KYC key
         *   undefined, optional, so it passed and stored nothing.
         *
         *   Both spellings are accepted so a request in flight during a deploy
         *   is not refused.
         */
        const { readFileSync } = require('fs') as typeof import('fs');
        const src = readFileSync('src/app/actions/export/_ex_onboarding.ts', 'utf-8');

        expect(src).toContain('fields.kycData || fields.kyc?.kycData || fields.kyc');
    });

    it('and the client sends the mapper\'s output on BOTH paths', () => {
        //   One mapper, both doors. A fix that reached the submit and not the
        //   resubmit is the shape this audit has recorded more than any other.
        const { readFileSync } = require('fs') as typeof import('fs');
        const client = readFileSync('src/app/export/onboarding/ExportOnboardingClient.tsx', 'utf-8');

        expect([...client.matchAll(/toExportOnboardingPayload\(/g)].length).toBeGreaterThanOrEqual(2);
        //   And the raw bags are no longer posted.
        expect(client).not.toContain('fd.append("profile", JSON.stringify(finalData.profile))');
        expect(client).not.toContain('JSON.stringify(finalData.kyc.kycData)');
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored from a snapshot copy
 *   keyed by FULL PATH.
 *
 *     MUTANT                                                        RESULT
 *     the mapper puts the investment bag back in `profile`       SURVIVED †
 *     the mapper stops carrying dateOfBirth / city / idType           KILLED
 *     termsAccepted returns true unconditionally                      KILLED
 *     termsAccepted needs only one of the four boxes                  KILLED
 *     lga is left empty instead of taking the city                    KILLED
 *     the schema drops the nine re-added kycData keys                 KILLED
 *     the schema drops the investment block                           KILLED
 *     the client posts the raw bags again                             KILLED
 *     the resubmit path reads `fields.kyc` alone                      KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                             SURVIVED
 *
 *   † SURVIVED FIRST TIME, and the gap it exposed is the finding itself. Moving
 *     an investment figure into `profile` — where the schema does not declare
 *     it, so Zod drops it — broke nothing any test could see: every assertion
 *     checked that the fields it cared about were PRESENT, and none could
 *     notice a field VANISH. That is exactly how nine required fields went
 *     missing in the first place, and a suite about silent dropping could not
 *     detect silent dropping.
 *
 *     "AND NOTHING THE MAPPER SENDS IS SILENTLY DISCARDED" compares the key set
 *     of every bag before and after parsing, so a key in the wrong place is a
 *     failure rather than a disappearance. The mutant is KILLED.
 */
