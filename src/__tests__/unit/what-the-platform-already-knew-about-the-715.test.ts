/**
 * @jest-environment node
 */

/**
 *   715 MEMBERS, ACTIVE AND PAID, WHOM THE COOPERATIVE COULD NOT NAME.
 *
 *   THE OWNER: "missing details for this user and others" — then "fix the
 *   715".
 *
 *   Measured on production before anything was written:
 *
 *       blank, active and paid        715
 *       with a savings balance          1
 *       with a loan balance             0
 *       approved by an admin          328
 *       carrying even an EMAIL         48
 *
 *   667 have no email on the membership row. Whatever the platform knows
 *   about these people is not there — it is on the USER document, or in a
 *   module registration hanging off it. #754 found the same thing from the
 *   other side ("when admin views members most times they see empty fields
 *   and missing informations") and taught extractCanonicalUser to walk
 *   `serviceRegistrations.<module>.profile`. That resolver is the harvest;
 *   this suite is about what may be WRITTEN from it.
 *
 * ── THE SAFETY PROPERTIES ARE THE TEST ──────────────────────────────────────
 *
 *   A repair that runs over 715 rows is judged on what it CANNOT do. Four
 *   things, each asserted below rather than argued:
 *
 *     it never overwrites          a member whose record is right is untouched
 *     it never sets onboardingCompleted    that flag is the precondition three
 *                                  heal sites read; setting it would grant
 *                                  exactly what those guards withhold
 *     it never changes status      no membershipStatus, no paymentStatus
 *     it is idempotent             a second run writes nothing
 *
 *   And it must actually recover something, or it is a no-op dressed as a
 *   repair — so the reported production shape is executed too.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';
import { identityPatchFor, rowNamesSomebody } from '@/lib/cooperative-identity-backfill';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null, setCache: async () => undefined,
    deleteCache: async () => undefined, deleteCachePattern: async () => undefined, redis: null,
}));

jest.mock('@/lib/require-admin', () =>
    require('@/lib/testing/require-admin-mock').requireAdminMock());

jest.mock('@/lib/audit-log', () => ({
    createAdminAuditLog: jest.fn(), recordAdminAction: jest.fn(),
}));

jest.mock('@/lib/cache-invalidation', () => ({
    invalidateUserCache: async () => undefined,
    invalidateServiceCache: async () => undefined,
    invalidateCooperativeCache: async () => undefined,
    invalidateAdminGlobalStats: async () => undefined,
    deleteCache: async () => undefined,
}));

let store: FakeDbHandle;

const BLANK = 'mem-blank';
const UID = 'uid-blank';

/** The production shape: the fee, and nothing else. */
const BLANK_ROW = {
    userId: UID,
    membershipStatus: 'active',
    paymentStatus: 'completed',
    membershipTier: 'Member',
};

/**
 * A user whose details live in a WAVE registration — the common case, and the
 * reason there is anything to recover.
 */
const USER_WITH_A_MODULE_PROFILE = {
    email: 'alzakkatintegratedltd@gmail.com',
    serviceRegistrations: {
        wave: {
            profile: {
                firstName: 'Musa', lastName: 'Abdullahi',
                phone: '+2348030001111',
                dateOfBirth: '1984-03-11',
                occupation: 'Trader',
                address: { state: 'Kogi', lga: 'Okene', street: '14 Market Road, Okene' },
            },
        },
    },
};

async function backfill(input: Record<string, unknown> = {}) {
    const { backfillMemberIdentitiesAction } =
        await import('@/app/actions/admin/_cooperative_memberships');
    return await (backfillMemberIdentitiesAction as any)(input);
}

const row = (id: string) => store.get(COLLECTIONS.COOPERATIVE_MEMBERS, id);

/**
 * Who is calling. require-admin-mock judges the SESSION's roles (see its own
 * note on why it does not read the document), so this is where the gate is
 * decided — stated here rather than inherited from a global default, or the
 * refusal test below would prove nothing.
 */
function actAs(roles: string[]): void {
    (globalThis as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id: 'admin-1', roles, email: 'admin@ese.ng' } },
        error: null,
    }));
}

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    actAs(['super_admin']);
    store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, BLANK, BLANK_ROW);
    store.seed(COLLECTIONS.USERS, UID, USER_WITH_A_MODULE_PROFILE);
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the harvest rule', () => {
    it('THE REPORTED CASE: recovers a name from a module registration', async () => {
        const patch = identityPatchFor(BLANK_ROW, USER_WITH_A_MODULE_PROFILE);

        expect(patch.fields.fullName).toBe('Musa Abdullahi');
        expect(patch.fields.phone).toBe('+2348030001111');
        expect(patch.fields.occupation).toBe('Trader');
        expect(patch.fields.stateOfOrigin).toBe('Kogi');
        expect(patch.fields.lga).toBe('Okene');
        expect(patch.fields.residentialAddress).toBe('14 Market Road, Okene');
    });

    it('NEVER OVERWRITES a field the row already has', async () => {
        const patch = identityPatchFor(
            { ...BLANK_ROW, phone: '+2348099999999', fullName: 'Declared Name' },
            USER_WITH_A_MODULE_PROFILE,
        );

        expect(patch.filled).not.toContain('phone');
        expect(patch.filled).not.toContain('fullName');
    });

    it('NEVER PROPOSES onboardingCompleted, or any status', async () => {
        //   Copying a name off a WAVE form is not the member filling in the
        //   cooperative's. That flag is what module-access-check's Layer 2.6,
        //   _coop_membership and the ID-card heal all read before granting.
        const patch = identityPatchFor(BLANK_ROW, USER_WITH_A_MODULE_PROFILE);

        expect(Object.keys(patch.fields)).not.toContain('onboardingCompleted');
        expect(Object.keys(patch.fields)).not.toContain('membershipStatus');
        expect(Object.keys(patch.fields)).not.toContain('paymentStatus');
    });

    it('DOES NOT SPLIT A NAME into invented parts', async () => {
        //   Guessing which word is the surname is how a member with three
        //   names loses one.
        const patch = identityPatchFor(BLANK_ROW, USER_WITH_A_MODULE_PROFILE);

        expect(Object.keys(patch.fields)).not.toContain('firstName');
        expect(Object.keys(patch.fields)).not.toContain('lastName');
    });

    it('proposes nothing when the platform knows nothing', async () => {
        const patch = identityPatchFor(BLANK_ROW, { email: '' });

        expect(patch.filled).toEqual([]);
    });

    it('and a placeholder is not a name', async () => {
        //   "User" is what the ghost-account auto-repair wrote before April
        //   2026. extractCanonicalUser already rejects it; this pins that the
        //   backfill does not reintroduce it.
        const patch = identityPatchFor(BLANK_ROW, { fullName: 'User' });

        expect(patch.fields.fullName).toBeUndefined();
    });

    it('rowNamesSomebody is what the 715 were counted by', () => {
        expect(rowNamesSomebody(BLANK_ROW)).toBe(false);
        expect(rowNamesSomebody({ fullName: 'Ngozi Eledumare' })).toBe(true);
        expect(rowNamesSomebody({ firstName: 'Ada' })).toBe(true);
        expect(rowNamesSomebody({ fullName: '   ' })).toBe(false);
    });
});

describe('the backfill action', () => {
    it('DRY RUNS BY DEFAULT — 715 rows is not a thing to write on a function name', async () => {
        const res = await backfill();

        expect(res.success).toBe(true);
        expect(res.data.dryRun).toBe(true);
        expect(res.data.written).toBe(0);
        expect(row(BLANK)!.fullName).toBeUndefined();
    });

    it('and the dry run reports what it WOULD do, per field', async () => {
        const res = await backfill();

        expect(res.data).toMatchObject({ scanned: 1, unnamed: 1, fillable: 1, namesRecovered: 1 });
        expect(res.data.byField.fullName).toBe(1);
        expect(res.data.byField.phone).toBe(1);
    });

    it('writes only when told to, and records that the value was derived', async () => {
        await backfill({ dryRun: false });

        const after = row(BLANK)!;
        expect(after.fullName).toBe('Musa Abdullahi');
        expect(after._identityBackfilledFields).toContain('fullName');
    });

    it('THE SAFETY PROPERTY: it does not activate anybody', async () => {
        await backfill({ dryRun: false });

        const after = row(BLANK)!;
        expect(after.onboardingCompleted).toBeUndefined();
        expect(after.membershipStatus).toBe('active');
        expect(after.paymentStatus).toBe('completed');
    });

    it('IS IDEMPOTENT — a second run finds nothing to do', async () => {
        await backfill({ dryRun: false });
        const second = await backfill({ dryRun: false });

        expect(second.data.fillable).toBe(0);
        expect(second.data.written).toBe(0);
    });

    it('LEAVES AN ONBOARDED MEMBER ALONE, blank field or not', async () => {
        //   They answered the form. A blank there is an answer, not a gap.
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, 'mem-onboarded', {
            ...BLANK_ROW, onboardingCompleted: true,
        });

        const res = await backfill({ dryRun: false });

        expect(row('mem-onboarded')!.fullName).toBeUndefined();
        expect(res.data.scanned).toBe(1);
    });

    it('and leaves a PENDING member alone — this is about who was admitted', async () => {
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, 'mem-pending', {
            ...BLANK_ROW, membershipStatus: 'pending',
        });

        await backfill({ dryRun: false });

        expect(row('mem-pending')!.fullName).toBeUndefined();
    });

    it('refuses a caller without cooperatives:approve_members, and writes nothing', async () => {
        //   Unconditional. The first version of this test was wrapped in an
        //   `if (res.success === false)`, which passes whether or not the gate
        //   exists — a refusal test that cannot fail.
        actAs(['support']);

        const res = await backfill({ dryRun: false });

        expect(res.success).toBe(false);
        expect(String(res.error)).toMatch(/cooperatives:approve_members/);
        expect(row(BLANK)!.fullName).toBeUndefined();
    });

    it('AND A SUPER ADMIN IS ADMITTED — so the refusal is not vacuous', async () => {
        actAs(['super_admin']);

        const res = await backfill({ dryRun: false });

        expect(res.success).toBe(true);
        expect(row(BLANK)!.fullName).toBe('Musa Abdullahi');
    });
});
