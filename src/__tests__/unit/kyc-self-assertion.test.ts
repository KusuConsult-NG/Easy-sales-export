/**
 * @jest-environment node
 */

/**
 * Nobody ever verified an identity, and five endpoints said they had.
 *
 * THE DEFECT
 * ----------
 * Seller verification, export onboarding and WAVE application all replicated the
 * applicant's KYC details onto her user record like this:
 *
 *     ...(data.nin ? { nin: data.nin, ninVerified: true } : {}),
 *     ...(data.bvn ? { bvn: data.bvn, bvnVerified: true } : {}),
 *     ...(cac    ? { cacNumber: cac,  cacVerified: true } : {}),
 *
 * The flag was set from the PRESENCE OF THE FIELD. Type eleven digits, be
 * verified. `admin/users/page.tsx` renders each flag as a green "Verified" badge
 * beside the user, so the admin deciding whether to approve that very
 * application was told the identity had already been checked — by the applicant.
 *
 * WAVE wrote its pair into the `kyc.*` namespace instead, which is worse in two
 * ways. `updateOverallKYCStatus` in kyc.ts reads exactly `kyc.bvnVerified` and
 * `kyc.ninVerified` to decide the account's overall KYC state. And it wrote
 * `applicantBvn ? true : false` — so resubmitting an application WITHOUT a BVN
 * set the flag to false and wiped a verification already on record. Filling in
 * less of the form downgraded you.
 *
 * THE SECOND DEFECT, IN THE SAME LINES
 * ------------------------------------
 * Marketplace and export stored the BVN and NIN in the clear on the user
 * document. kyc.ts and wave/_actions.ts both write `hashData(bvn)`; these two
 * were the only places a readable BVN sat in the users table. That is the table
 * whose export spent 52 days in a public repository.
 *
 * The replica is now hashed. The reviewable copy is untouched in the
 * SELLER_VERIFICATIONS record, so an admin reviewing an application still sees
 * the real number — the fix removes a duplicate, not the review.
 *
 * WHAT IS REPORTED AND NOT CHANGED
 * --------------------------------
 * `kyc.ts` does not verify anything either. `_verifyBVNAction` carries the
 * comment "Verify a single BVN against QoreID... Returns isMatch:true only if
 * QoreID confirms the name matches" directly above a body that writes
 * `'kyc.bvnVerified': true` unconditionally and logs
 * "BVN verified forcefully (QoreID bypassed)". No QoreID call exists in the
 * repository, and no other identity verifier does either.
 *
 * That is deliberate — the log line names it — and reversing it needs QoreID
 * credentials and a decision about whether an unverifiable applicant may
 * transact. It would also block every signup the moment the key is missing. So
 * it is reported, not flipped. These tests close the paths that assert
 * verification WITHOUT anyone having decided to; they cannot make the one that
 * was decided on tell the truth.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { hashData } from '@/lib/security';

const SELLER = 'seller-1';
const ADMIN = 'admin-1';
const OTHER = 'other-1';

const NIN = '12345678901';
const BVN = '22222222222';

jest.mock('@/lib/audit-log', () => ({
    createAdminAuditLog: jest.fn(async () => ({})),
    logAdminAction: jest.fn(async () => ({})),
    logAdminFinancialAction: jest.fn(async () => ({})),
}));
jest.mock('@/app/actions/notifications', () => ({
    createNotificationAction: jest.fn(async () => ({})),
    createBulkNotificationsAction: jest.fn(async () => ({})),
}));
jest.mock('@/lib/cache-invalidation', () => ({
    invalidateUserCache: jest.fn(async () => ({})),
    invalidateAdminGlobalStats: jest.fn(async () => ({})),
    invalidateAllCaches: jest.fn(async () => ({})),
    invalidateProductCache: jest.fn(async () => ({})),
}));

function setSession(id: string, roles: string[] = []) {
    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id, email: `${id}@e.com`, name: id, roles } },
        error: null,
    }));
}

function setDoc(data: Record<string, any>) {
    (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve({
        exists: true, empty: false,
        docs: [{ id: 'ver-1', ref: { id: 'ver-1' }, data: () => data }],
        ref: { id: 'ver-1' },
        data: () => data,
    }));
}

/**
 * Every patch written to any document.
 *
 * All four write stubs, and that matters: these actions write inside
 * `db.runTransaction`, which the harness records as mockFirestoreTxUpdate /
 * mockFirestoreTxSet — a different pair from the plain docRef ones. Reading
 * only the plain pair made the first version of the "does not mark verified"
 * test pass against an empty array, which is the vacuum this suite exists to
 * catch. The sibling test that expected a successful write is what exposed it.
 */
function allWrites(): Record<string, any>[] {
    const g = global as any;
    return [
        ...g.mockFirestoreUpdate.mock.calls,
        ...g.mockFirestoreSet.mock.calls,
        ...g.mockFirestoreTxUpdate.mock.calls,
        ...g.mockFirestoreTxSet.mock.calls,
    ].map((c: any[]) => c[c.length - 1]).filter(Boolean);
}

/**
 * The patch written to the USER document — the replica.
 *
 * Identified by `sellerVerificationStatus`, which only the user record carries.
 * Matching on 'bvn' instead finds the verification record first, which holds the
 * number in the clear on purpose; the first version of this helper did exactly
 * that and asserted the wrong document was hashed.
 */
function userReplica(): Record<string, any> | undefined {
    return allWrites().find((p) => p && 'sellerVerificationStatus' in p);
}

/** The patch written to the SELLER_VERIFICATIONS record — the reviewable copy. */
function verificationRecord(): Record<string, any> | undefined {
    return allWrites().find((p) => p && 'phoneNumber' in p);
}

const validPayload = {
    phoneNumber: '08030000000',
    nin: NIN,
    bvn: BVN,
    cac: 'RC123456',
    bankAccount: { accountNumber: '0123456789', bankName: 'A Bank', accountName: 'A Seller', bankCode: '058' },
    address: { street: '1 Road', city: 'Ikeja', state: 'Lagos', lga: 'Ikeja', country: 'Nigeria' },
};

describe('marketplace seller verification — resubmission', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession(SELLER);
        // A rejected verification is the only state resubmission accepts.
        setDoc({ userId: SELLER, status: 'rejected', verificationId: 'ver-1' });
    });

    async function resubmit(payload: any = validPayload) {
        const { resubmitSellerVerificationAction } = await import('@/app/actions/marketplace/_actions');
        return resubmitSellerVerificationAction(payload);
    }

    it('does not mark the applicant verified for having typed a number', async () => {
        // THE test. The admin who reviews this resubmission sees these flags as
        // a green "Verified" badge in the user list.
        await resubmit();

        for (const patch of allWrites()) {
            expect(patch).not.toHaveProperty('ninVerified', true);
            expect(patch).not.toHaveProperty('bvnVerified', true);
            expect(patch).not.toHaveProperty('cacVerified', true);
        }
    });

    it('stores the user replica hashed, not as a readable BVN', async () => {
        // The users table is the one whose export sat in a public repository.
        await resubmit();

        const patch = userReplica();
        expect(patch).toBeDefined();
        expect(patch!.bvn).toBe(hashData(BVN));
        expect(patch!.nin).toBe(hashData(NIN));
        expect(JSON.stringify(patch)).not.toContain(BVN);
        expect(JSON.stringify(patch)).not.toContain(NIN);
    });

    it('keeps the reviewable copy in the verification record, so admin review still works', async () => {
        // The point of hashing the user-document replica is that it is a
        // DUPLICATE. If this assertion ever fails, the fix has cost the admins
        // the ability to check an identity against an uploaded document.
        await resubmit();

        const verificationPatch = verificationRecord();
        expect(verificationPatch).toBeDefined();
        expect(verificationPatch!.bvn).toBe(BVN);
        expect(verificationPatch!.nin).toBe(NIN);
    });

    it('still refuses to resubmit anything that was not rejected', async () => {
        // Pre-existing guard, and the reason resubmission cannot be used to
        // reset an approved seller back to pending. Must survive the change.
        setDoc({ userId: SELLER, status: 'approved', verificationId: 'ver-1' });

        const r: any = await resubmit();

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/rejected/i);
    });

    it('still writes the resubmission through, so the refusals above mean something', async () => {
        // Vacuity guard: every assertion above is satisfied by an action that
        // writes nothing at all.
        const r: any = await resubmit();

        expect(r.success).toBe(true);
        expect(userReplica()).toBeDefined();
        expect(verificationRecord()).toBeDefined();
    });
});

describe('WAVE application — the kyc.* namespace the KYC gate reads', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession(SELLER);
    });

    it('never asserts kyc.bvnVerified from the applicant\'s own submission', async () => {
        // updateOverallKYCStatus in kyc.ts reads exactly these two fields.
        const { readFileSync } = await import('fs');
        const { join } = await import('path');
        const src = readFileSync(join(process.cwd(), 'src/app/actions/wave/_actions.ts'), 'utf-8');

        expect(src).not.toContain('"kyc.bvnVerified": applicantBvn ? true : false');
        expect(src).not.toContain('"kyc.ninVerified": applicantNin ? true : false');
    });

    it('still stores the numbers, hashed', async () => {
        // Removing the flags must not remove the data — an admin still needs to
        // know a BVN was supplied, and hashData lets a supplied number be
        // matched without being readable.
        const { readFileSync } = await import('fs');
        const { join } = await import('path');
        const src = readFileSync(join(process.cwd(), 'src/app/actions/wave/_actions.ts'), 'utf-8');

        expect(src).toContain('"kyc.bvn": applicantBvn ? hashData(applicantBvn) : null');
        expect(src).toContain('"kyc.nin": applicantNin ? hashData(applicantNin) : null');
    });
});

describe('no endpoint anywhere claims a verification it did not perform', () => {
    it('has no self-asserted *Verified flag left in the action layer', async () => {
        // A ratchet. The three sites fixed here were found by grep, so the same
        // grep is the guard: any new endpoint that sets one of these flags from
        // user-supplied data fails this, and has to justify itself.
        //
        // kyc.ts is exempt and listed by name. It sets the flags unconditionally
        // with QoreID bypassed, which is a decision the operator took and is
        // recorded in this file's header — not something to smuggle a fix for
        // into a ratchet.
        // Comment lines are excluded. A comment that NAMES the pattern — like
        // the one in kyc.ts describing what an empty BVN used to do — is prose,
        // not a self-assertion, and failing on it makes the guard fire at
        // correct code. That happened, and it is fixed here rather than worked
        // around by rewording the comment: a ratchet that punishes describing a
        // defect discourages exactly the documentation this codebase runs on.
        const { execSync } = await import('child_process');

        const raw = execSync(
            `grep -rn "ninVerified: true\\|bvnVerified: true\\|cacVerified: true" src/app/actions || true`,
            { encoding: 'utf-8', cwd: process.cwd() }
        ).trim();

        const hits = raw
            .split('\n')
            .filter(Boolean)
            .filter((line) => {
                const code = line.slice(line.indexOf(':', line.indexOf(':') + 1) + 1).trim();
                return !code.startsWith('//') && !code.startsWith('*');
            })
            .join('\n');

        expect(hits).toBe('');
    });
});

describe('marketplace guards that were already correct', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession(SELLER, ['seller']);
    });

    it('grantSellerVerifiedBadgeAction refuses a non-admin', async () => {
        // A self-granted "verified seller" badge is what a buyer trusts before
        // paying into escrow.
        const { grantSellerVerifiedBadgeAction } = await import('@/app/actions/marketplace/_actions');

        const r: any = await grantSellerVerifiedBadgeAction(SELLER);

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/admin|unauthori[sz]ed/i);
    });

    it('revokeSellerVerifiedBadgeAction refuses a non-admin', async () => {
        const { revokeSellerVerifiedBadgeAction } = await import('@/app/actions/marketplace/_actions');

        const r: any = await revokeSellerVerifiedBadgeAction(SELLER);

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/admin|unauthori[sz]ed/i);
    });

    it('lets an admin grant the badge, so the two refusals above are not vacuous', async () => {
        setSession(ADMIN, ['admin']);
        setDoc({ id: SELLER, roles: ['seller'], sellerVerificationStatus: 'approved' });
        const { grantSellerVerifiedBadgeAction } = await import('@/app/actions/marketplace/_actions');

        const r: any = await grantSellerVerifiedBadgeAction(SELLER);

        expect(r.success).toBe(true);
    });

    it('deleteProductAction refuses somebody else\'s product', async () => {
        setDoc({ sellerId: OTHER, name: 'A Product', status: 'active' });
        const { deleteProductAction } = await import('@/app/actions/marketplace/_actions');

        const r: any = await deleteProductAction('prod-1');

        expect(r.success).toBe(false);
    });
});
