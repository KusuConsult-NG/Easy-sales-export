/**
 * @jest-environment node
 */

/**
 * An account could be marked KYC-verified having submitted nothing.
 *
 * THE DEFECT
 * ----------
 * `updateOverallKYCStatus` computes:
 *
 *     const bvnOk         = !hasBvn || bvnVerified;
 *     const ninOk         = !hasNin || ninVerified;
 *     const votersCardOk  = !hasVotersCard || votersCardVerified;
 *     const kycComplete   = bvnOk && ninOk && votersCardOk;
 *
 * With nothing on file all three are **vacuously true**, so kycComplete came
 * out TRUE and the account was written `kyc.status: 'verified'` and
 * `kycVerified: true`. saveKYCProfileAction calls this, so saving a profile was
 * enough to trigger it.
 *
 * `_verifyBVNAction` made it worse and reachable directly: it had no check on
 * its input at all, and stores `hashData('00000000000')` when the BVN is falsy.
 * updateOverallKYCStatus explicitly treats that exact fallback as "no BVN
 * provided" — so submitting an empty string set `bvnVerified: true` against a
 * placeholder AND left the account counting as having supplied nothing.
 *
 * "All provided documents are verified" is only a meaningful statement about
 * somebody who provided one.
 *
 * WHY THIS IS NOT THE QoreID DECISION
 * -----------------------------------
 * #105 recorded that this platform verifies no identities: _verifyBVNAction
 * carries a comment promising QoreID confirms the name matches, above a body
 * that writes `kyc.bvnVerified: true` unconditionally and logs "BVN verified
 * forcefully (QoreID bypassed)". No QoreID call exists in the repository.
 *
 * That is a decision somebody took, it is unchanged here, and reversing it
 * needs credentials and a ruling on whether an unverifiable applicant may
 * transact. This is a different thing: that decision says "we trust what the
 * user types". The defect fixed here said "we mark verified when the user types
 * nothing", which nobody decided.
 *
 * The bypass is asserted below rather than left implicit, so the state of it is
 * visible in the suite instead of only in a PR comment.
 *
 * ALSO RECORDED, NOT CHANGED
 * --------------------------
 * The voter's-card path writes `votersCardOriginalQoreIdStatus:
 * 'pending_manual_review'` and `votersCardStatus: 'verified'` in the same
 * update, with the comment "we defer to manual review". **Nothing surfaces
 * those for review** — no admin screen queries that field. So the manual review
 * it defers to does not exist. Reported rather than invented.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const USER = 'user-1';

jest.mock('@/lib/cache-invalidation', () => ({
    invalidateUserCache: jest.fn(async () => ({})),
    invalidateAdminGlobalStats: jest.fn(async () => ({})),
}));
jest.mock('@/lib/firestore-utils', () => ({
    runQueryWithRetry: (fn: any) => fn(),
    safeCollection: jest.fn(),
}));

/**
 * atomicUpdateUser comes from @/lib/services/userService, not from
 * optimistic-locking where the name suggests. Mocking the wrong module left it
 * unmocked, the action failed silently, and the three refusals above passed
 * because nothing happened at all. The success case is what exposed it.
 */
const mockAtomicUpdate = jest.fn(async () => ({})) as jest.Mock<any>;
jest.mock('@/lib/services/userService', () => ({
    atomicUpdateUser: (...a: any[]) => mockAtomicUpdate(...a),
}));

function setSession(id: string | null) {
    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve(
        id === null
            ? { session: null, error: { error: 'Not authenticated' } }
            : { session: { user: { id, email: `${id}@e.com`, name: id, roles: [] } }, error: null }
    ));
}

/** The user document updateOverallKYCStatus reads back. */
function setUserKyc(kyc: Record<string, any>) {
    (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve({
        exists: true, empty: false, docs: [], data: () => ({ kyc }),
    }));
    (global as any).mockFirestoreTxGet.mockImplementation(() => Promise.resolve({
        exists: true, empty: false, docs: [], data: () => ({ kyc }),
    }));
}

/** The patch that carries the overall status, if one was written. */
function overallStatusPatch(): Record<string, any> | undefined {
    return mockAtomicUpdate.mock.calls
        .map((c: any[]) => c[1])
        .find((p: any) => p && 'kyc.status' in p);
}

async function verifyBvn(bvn: string) {
    const { verifyBVNAction } = await import('@/app/actions/kyc');
    return verifyBVNAction({ bvn, firstName: 'A', lastName: 'Person' } as any);
}

describe('an empty submission is not a submission', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession(USER);
        setUserKyc({});
    });

    it('refuses an empty BVN, and writes nothing', async () => {
        // THE test. An empty BVN stored hashData('00000000000') and set
        // bvnVerified: true against it.
        const r: any = await verifyBvn('');

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/11 digits/i);
        expect(mockAtomicUpdate).not.toHaveBeenCalled();
    });

    it('refuses a BVN that is not eleven digits', async () => {
        for (const bad of ['123', '1234567890a', '123456789012']) {
            jest.clearAllMocks();
            const r: any = await verifyBvn(bad);
            expect(r.success).toBe(false);
        }
    });

    it('refuses an empty NIN', async () => {
        const { verifyNINAction } = await import('@/app/actions/kyc');

        const r: any = await verifyNINAction({ nin: '', firstName: 'A', lastName: 'Person' } as any);

        expect(r.success).toBe(false);
        expect(mockAtomicUpdate).not.toHaveBeenCalled();
    });

    it('still accepts a well-formed BVN', async () => {
        // Vacuity guard. Refusing everything would block the whole KYC flow.
        const r: any = await verifyBvn('12345678901');

        expect(r.success).toBe(true);
        expect(mockAtomicUpdate).toHaveBeenCalled();
    });
});

describe('completeness is not vacuous', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession(USER);
    });

    it('does not mark an account verified with no documents on file', async () => {
        // THE other test. All three "Ok" terms are `!hasX || xVerified`, so an
        // empty kyc object made every one true and kycComplete came out true.
        //
        // Driven through the BVN path with a valid number, but a user document
        // that still shows nothing recorded — the shape after a failed or
        // partial write, and exactly what saveKYCProfileAction would read.
        setUserKyc({});

        await verifyBvn('12345678901');

        expect(overallStatusPatch()?.['kyc.status']).toBe('pending');
        expect(overallStatusPatch()?.kycVerified).toBe(false);
    });

    it('marks an account verified once a real document is verified', async () => {
        // Vacuity guard for the assertion above: the rule must still pass
        // somebody who genuinely completed KYC.
        const { hashData } = await import('@/lib/security');
        setUserKyc({ bvn: hashData('12345678901'), bvnVerified: true });

        await verifyBvn('12345678901');

        expect(overallStatusPatch()?.['kyc.status']).toBe('verified');
        expect(overallStatusPatch()?.kycVerified).toBe(true);
    });

    it('treats the placeholder hash as no document, as it always did', async () => {
        // hashData('00000000000') is the fallback the write stores for a missing
        // number, and updateOverallKYCStatus deliberately discounts it. That
        // behaviour is kept — it is what makes the empty-input guard necessary
        // rather than optional.
        const { hashData } = await import('@/lib/security');
        setUserKyc({ bvn: hashData('00000000000'), bvnVerified: true });

        await verifyBvn('12345678901');

        expect(overallStatusPatch()?.kycVerified).toBe(false);
    });
});

describe('the QoreID bypass, recorded rather than changed', () => {
    it('performs no identity verification anywhere in the file', async () => {
        // #105 recorded this and it is unchanged: no QoreID call exists in the
        // repository, and the BVN path logs that it is bypassed. Asserted so
        // the state of the decision is visible in the suite rather than only in
        // a PR comment — and so that wiring a real verifier in later has to
        // come past this test deliberately.
        const { readFileSync } = await import('fs');
        const { join } = await import('path');
        const src = readFileSync(join(process.cwd(), 'src/app/actions/kyc.ts'), 'utf-8');

        expect(src).toContain('QoreID bypassed');
        expect(src).not.toMatch(/fetch\([^)]*qoreid/i);
    });

    it('has no queue for the manual review the voter\'s card defers to', async () => {
        // The path writes votersCardOriginalQoreIdStatus: 'pending_manual_review'
        // and votersCardStatus: 'verified' in the same update, commented "we
        // defer to manual review". Nothing reads that field, so the review it
        // defers to does not exist.
        const { execSync } = await import('child_process');

        const consumers = execSync(
            `grep -rl "votersCardOriginalQoreIdStatus" src/app --include="*.tsx" || true`,
            { encoding: 'utf-8', cwd: process.cwd() }
        ).trim();

        expect(consumers).toBe('');
    });
});

describe('ownership', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setUserKyc({});
    });

    it('refuses an unauthenticated caller', async () => {
        setSession(null);

        const r: any = await verifyBvn('12345678901');

        expect(r.success).toBe(false);
        expect(mockAtomicUpdate).not.toHaveBeenCalled();
    });

    it('writes only to the caller\'s own record', async () => {
        setSession(USER);

        await verifyBvn('12345678901');

        for (const call of mockAtomicUpdate.mock.calls) {
            expect(call[0]).toBe(USER);
        }
    });
});
