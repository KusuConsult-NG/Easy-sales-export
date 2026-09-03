/**
 * @jest-environment node
 */

/**
 * ONE CHARACTER WAS AN IDENTITY DOCUMENT.
 *
 * actions/kyc.ts verifies three documents, and two of them check what they were
 * given:
 *
 *     BVN   if (!/^\d{11}$/.test(...)) return 'A BVN must be 11 digits'
 *     NIN   if (!/^\d{11}$/.test(...)) return 'A NIN must be 11 digits'
 *     VIN   if (!votersCardNumber)     return "Voter's Card number is required"
 *
 * The third refused only the empty string. The voter's-card path then
 * force-marks itself verified — a deliberate relaxation, PVC lookups being
 * unreliable — and updateOverallKYCStatus counts any stored card as a document
 * on file. So the three lines add up:
 *
 *     verifyVotersCardAction({ votersCardNumber: 'x', ... })
 *       -> { success: true }
 *       -> users/u1 = { kycVerified: true, kyc: { status: 'verified',
 *                                                votersCard: 'x' } }
 *
 * That is the executed result, not a reading of the code.
 *
 * THE FIX THAT REACHED TWO OF THREE SIBLINGS
 * ------------------------------------------
 * The comment sitting on the BVN check names this exact consequence — "that
 * marked an account KYC-verified having submitted no identity document
 * whatsoever" — and was written when the empty-BVN and empty-NIN cases were
 * closed. The voter's card is the third path and went on doing it. Same file,
 * same paragraph of reasoning, one sibling missed: the shape this audit keeps
 * finding.
 *
 * WHAT THIS DOES NOT CLAIM
 * ------------------------
 * It does not make KYC trustworthy, and the tests below say so out loud: a
 * well-formed but fabricated number still completes KYC, because all three
 * paths are self-asserted while QoreID is out. That is the owner's documented
 * decision and is deliberately untouched. What changes is that a character
 * typed into a box is no longer an identity document.
 *
 * WHAT kycVerified ACTUALLY REACHES, stated precisely rather than inflated:
 * it is displayed in the admin user list, written into the admin CSV export of
 * users, and selects the "fully verified sellers" broadcast audience in
 * lib/broadcast-logic.ts. No money-movement path was found gating on it. So the
 * damage is to the platform's record of who has been identity-checked — which
 * is the record admins act on — not to a balance.
 *
 * THE STORED VALUE IS NOT HASHED, AND THAT IS DELIBERATE
 * ------------------------------------------------------
 * BVN and NIN are stored as hashData() digests in the same object. The voter's
 * card is not, because this path's entire stated purpose is to defer to MANUAL
 * REVIEW and an admin cannot review a digest. It is normalised instead, so the
 * value an admin reads is the value any other submission of the same card would
 * produce.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';
import {
    isPlausibleVotersCardNumber,
    normaliseVotersCardNumber,
    VOTERS_CARD_MIN_LENGTH,
    VOTERS_CARD_MAX_LENGTH,
} from '@/lib/kyc-validators';

jest.mock('@/lib/redis', () => ({
    redis: null,
    getCached: async () => null,
    setCache: async () => undefined,
    deleteCache: async () => undefined,
}));
jest.mock('@/lib/cache-invalidation', () => ({
    invalidateUserCache: jest.fn(async () => undefined),
    invalidateAdminGlobalStats: jest.fn(async () => undefined),
}));
jest.mock('next/cache', () => ({
    revalidateTag: jest.fn(), updateTag: jest.fn(), revalidatePath: jest.fn(),
    unstable_cache: (fn: unknown) => fn,
}));

declare const global: any;

let store: FakeDbHandle;

/** A well-formed VIN: 19 alphanumeric characters, as INEC issues them. */
const REAL_SHAPED_VIN = '90F5B7A2C41D8E60395';

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    store.seed(COLLECTIONS.USERS, 'u1', { email: 'u@example.com', roles: ['general_user'] });
    global.mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id: 'u1', roles: ['general_user'], email: 'u@example.com' } },
        error: null,
    }));
});

function account(): Record<string, any> {
    return store.get(COLLECTIONS.USERS, 'u1') ?? {};
}

async function submitCard(votersCardNumber: string) {
    const { verifyVotersCardAction } = await import('@/app/actions/kyc');
    return (await verifyVotersCardAction({
        votersCardNumber, firstName: 'Ada', lastName: 'Obi',
    })) as any;
}

describe('a single character is not an identity document', () => {
    it('IS REFUSED — this returned success and marked the account verified', async () => {
        const res = await submitCard('x');

        expect(res.success).toBe(false);
        expect(account().kycVerified).not.toBe(true);
        expect(account().kyc?.status).not.toBe('verified');
    });

    it('and nothing is written to the account at all', async () => {
        await submitCard('x');

        // The refusal must come before the write, not alongside it: a stored
        // card is what updateOverallKYCStatus counts as a document on file.
        expect(account().kyc?.votersCard).toBeUndefined();
        expect(account().kyc?.votersCardVerified).toBeUndefined();
    });

    it.each([
        ['a single character', 'x'],
        ['whitespace only', '   '],
        ['a short number', '1234'],
        ['punctuation', '!!!!!!!!!!'],
        ['an injected fragment', '<script>alert(1)</script>'],
        ['something far too long', 'A'.repeat(200)],
    ])('refuses %s', async (_label, value) => {
        const res = await submitCard(value);

        expect(res.success).toBe(false);
        expect(account().kycVerified).not.toBe(true);
    });
});

describe('a real card still passes, exactly as before', () => {
    it("is accepted and still force-marked verified — the owner's decision, untouched", async () => {
        const res = await submitCard(REAL_SHAPED_VIN);

        expect(res.success).toBe(true);
        expect(account().kyc?.votersCardVerified).toBe(true);
        // The PVC lookup is not performed and the record says so.
        expect(account().kyc?.votersCardOriginalQoreIdStatus).toBe('pending_manual_review');
    });

    it('and it alone still completes KYC — said out loud rather than left implied', async () => {
        // This is NOT fixed here, and should not be read as fixed. Every path in
        // this module is self-asserted while QoreID is out. A fabricated but
        // well-formed number still gets an account to 'verified'.
        await submitCard(REAL_SHAPED_VIN);

        expect(account().kycVerified).toBe(true);
        expect(account().kyc?.status).toBe('verified');
    });

    it('and the number is stored normalised, so manual review sees one form', async () => {
        await submitCard('90f5 b7a2-c41d 8e60-395');

        expect(account().kyc?.votersCard).toBe(REAL_SHAPED_VIN);
    });

    it('and it is stored readable, not hashed like the BVN and NIN beside it', async () => {
        // Deliberate: this path defers to manual review, and an admin cannot
        // review a digest. Pinned so the asymmetry is a decision on the record.
        await submitCard(REAL_SHAPED_VIN);

        expect(account().kyc?.votersCard).toBe(REAL_SHAPED_VIN);
        expect(account().kyc?.votersCard).not.toMatch(/^[a-f0-9]{64}$/);
    });
});

describe('all three identity paths now agree', () => {
    it.each([
        ['BVN', 'verifyBVNAction', 'bvn'],
        ['NIN', 'verifyNINAction', 'nin'],
    ])('%s refuses junk and leaves the account unverified', async (_label, action, field) => {
        const mod: any = await import('@/app/actions/kyc');
        const res = await mod[action]({ [field]: 'x', firstName: 'Ada', lastName: 'Obi' });

        expect(res.success).toBe(false);
        expect(account().kycVerified).not.toBe(true);
    });

    it("and so does the voter's card, which is the one that did not", async () => {
        const res = await submitCard('x');

        expect(res.success).toBe(false);
        expect(account().kycVerified).not.toBe(true);
    });

    it('no identity path in the module writes before checking its input', () => {
        const code = readFileSync(join(process.cwd(), 'src/app/actions/kyc.ts'), 'utf-8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/^\s*\/\/.*$/gm, '');

        const pairs: Array<[string, string]> = [
            ['test(String(bvn', "'kyc.bvn'"],
            ['test(String(nin', "'kyc.nin'"],
            ['isPlausibleVotersCardNumber(votersCardNumber)', "'kyc.votersCard'"],
        ];
        for (const [guard, write] of pairs) {
            const guardAt = code.indexOf(guard);
            const writeAt = code.indexOf(write);
            expect(guardAt).toBeGreaterThan(-1);
            expect(writeAt).toBeGreaterThan(guardAt);
        }
    });
});

describe('the validator itself', () => {
    it('states its bounds rather than restating the regex', () => {
        // Tightening to the INEC spec is a two-constant change; these read the
        // constants so the tests do not have to be rewritten for it.
        expect(isPlausibleVotersCardNumber('A'.repeat(VOTERS_CARD_MIN_LENGTH))).toBe(true);
        expect(isPlausibleVotersCardNumber('A'.repeat(VOTERS_CARD_MIN_LENGTH - 1))).toBe(false);
        expect(isPlausibleVotersCardNumber('A'.repeat(VOTERS_CARD_MAX_LENGTH))).toBe(true);
        expect(isPlausibleVotersCardNumber('A'.repeat(VOTERS_CARD_MAX_LENGTH + 1))).toBe(false);
    });

    it('accepts the 19-character shape INEC actually issues', () => {
        expect(REAL_SHAPED_VIN).toHaveLength(19);
        expect(isPlausibleVotersCardNumber(REAL_SHAPED_VIN)).toBe(true);
    });

    it('tolerates the separators people write on a form', () => {
        expect(normaliseVotersCardNumber(' 90f5 b7a2-c41d 8e60-395 ')).toBe(REAL_SHAPED_VIN);
        expect(isPlausibleVotersCardNumber('90f5 b7a2-c41d 8e60-395')).toBe(true);
    });

    it('and refuses anything that is not letters and digits', () => {
        expect(isPlausibleVotersCardNumber('90F5B7A2C41D8E6039!')).toBe(false);
        expect(isPlausibleVotersCardNumber('90F5B7A2C41D8E60_39')).toBe(false);
    });

    it('and handles a caller that passes nothing at all', () => {
        expect(isPlausibleVotersCardNumber(undefined)).toBe(false);
        expect(isPlausibleVotersCardNumber(null)).toBe(false);
        expect(normaliseVotersCardNumber(undefined)).toBe('');
    });
});

describe('the completeness rule that turns one document into a verdict', () => {
    it('still refuses to call an account verified with nothing on file', async () => {
        // A regression pin on the earlier finding in the same function: every
        // bvnOk/ninOk/votersCardOk is `!hasX || xVerified`, so with nothing
        // supplied all three were vacuously true and kycComplete came out true.
        const { saveKYCProfileAction } = await import('@/app/actions/kyc');
        await saveKYCProfileAction({
            firstName: 'Ada', lastName: 'Obi', dateOfBirth: '1990-01-01',
            phoneNumber: '08011111111', address: '1 Road', city: 'Ikeja', state: 'Lagos',
        });

        expect(account().kycVerified).toBe(false);
        expect(account().kyc?.status).toBe('pending');
    });
});
