/**
 * @jest-environment node
 */

/**
 * A buyer the platform kept making a seller.
 *
 *   THE OWNER: "on marketplace buyers are still having add product button and
 *   that is not supposed to be so."
 *
 *   They had the seller ROLE. `MarketplaceProductsClient` tests it and offers
 *   "List a Product"; the screen was reading the account correctly.
 *
 *   It came from Layer 2.11 of checkModuleAccess, which backfilled the users
 *   document from an approved SELLER_VERIFICATIONS row:
 *
 *       roles: FieldValue.arrayUnion("seller"),
 *
 *   unconditionally, without once reading `accountType`. That collection holds
 *   EVERY marketplace application whatever the applicant asked to be — which is
 *   why _mp_onboarding:211 reads `vData?.accountType` off the very same row —
 *   so approving a buyer turned them into a seller.
 *
 *   AND IT WAS A HEAL ON THE ACCESS PATH, so it ran again the next time the
 *   buyer opened the module. An admin stripping the role by hand could not make
 *   it stick; the platform put it back.
 *
 *   #844 established the rule, _mp_onboarding's own heal applies it, and #255
 *   gave the two admin approval doors one shared implementation of it. This
 *   door was missed by all three and asked no question at all — the same "one
 *   more door onto the same decision" this audit keeps finding.
 *
 * WHY THIS RUNS THE GATE RATHER THAN READING IT.
 *
 *   The defect was a write, and what matters is what the users document holds
 *   afterwards. So this seeds a real approved application, runs the real access
 *   check, and reads the roles back.
 *
 *   Verified by mutation: restoring `arrayUnion("seller")` puts `seller` on the
 *   buyer and fails the first test.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';
import type { UserRole } from '@/lib/types/roles';

let store: FakeDbHandle;
const UID = 'user-1';

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
});

async function access(roles: string[] = []): Promise<boolean> {
    const { checkModuleAccess } = await import('@/lib/module-access-check');
    return checkModuleAccess(UID, roles as UserRole[], 'marketplace' as never);
}

/** An applicant with nothing on the user record, and one approved application. */
function applied(accountType: string | undefined): void {
    store.seed(COLLECTIONS.USERS, UID, { email: 'ada@example.com' });
    store.seed(COLLECTIONS.SELLER_VERIFICATIONS, 'ver-1', {
        userId: UID,
        status: 'approved',
        ...(accountType === undefined ? {} : { accountType }),
    });
}

const rolesNow = (): string[] =>
    ((store.get(COLLECTIONS.USERS, UID) as any)?.roles ?? []) as string[];

const registration = (): Record<string, any> =>
    (store.get(COLLECTIONS.USERS, UID) as any)?.serviceRegistrations?.marketplace ?? {};

describe('a buyer the platform kept making a seller', () => {
    it('AN APPROVED BUYER IS NOT GIVEN THE SELLER ROLE', async () => {
        applied('buyer');

        await expect(access()).resolves.toBe(true);

        expect(rolesNow()).not.toContain('seller');
        expect(rolesNow()).toContain('marketplace_buyer');
    });

    it('AND THE HEAL DOES NOT PUT IT BACK ON THE NEXT VISIT', async () => {
        applied('buyer');

        //   The defect that made this worth its own test: the grant lived on the
        //   ACCESS path, so it re-ran every time the buyer opened the module.
        await access();
        await access();
        await access();

        expect(rolesNow()).not.toContain('seller');
    });

    it('AN APPROVED SELLER STILL GETS IT — the gate was not simply closed', async () => {
        applied('seller');

        await expect(access()).resolves.toBe(true);
        expect(rolesNow()).toContain('seller');
    });

    it('"BOTH" GETS BOTH, which is the whole of #844', async () => {
        applied('both');

        await access();

        expect(rolesNow()).toContain('seller');
        expect(rolesNow()).toContain('marketplace_buyer');
    });

    it('A LEGACY ROW WITH NO accountType KEEPS TODAY\'S SELLER DEFAULT', async () => {
        //   Rows predate the field. Demoting them on a heal would take selling
        //   rights off accounts that have them, which is a worse failure than
        //   the one being fixed.
        applied(undefined);

        await access();
        expect(rolesNow()).toContain('seller');
    });

    it('THE accountType IS RECORDED, so the next reader does not have to guess', async () => {
        applied('buyer');

        await access();

        //   _mp_onboarding:211 reads this field and falls back to 'seller' when
        //   it is absent — a heal that leaves it unwritten hands that reader the
        //   same wrong answer this test is about.
        expect(registration().accountType).toBe('buyer');
        expect(registration().status).toBe('approved');
    });
});
