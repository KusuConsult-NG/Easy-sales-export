/**
 * @jest-environment node
 */

/**
 *   THE REMAINDER, BY FEATURE — INCLUDING A FOURTH DOUBLE-LENDING DOOR.
 *
 *   What was left after marketplace, academy and cooperative: the notification
 *   bell, the admin loan approval, farm nation's two verification doors and
 *   its lookup module, and the data-recovery tool.
 *
 *   THE ADMIN LOAN DOOR IS THE ONE THAT MATTERS. Tranche 9 found three places
 *   enforcing "one borrower, one open loan" and gave the status list one home
 *   in lib/loan-application-location.ts. This is a FOURTH, in
 *   src/app/actions/admin, and it kept its own copy of the literal and its own
 *   single id — so a borrower with two profiles answered "no open loan" twice
 *   and an admin approved the second.
 *
 *   TWO SITES ARE DELIBERATELY NOT WIDENED, and both say so in the file:
 *   the audit-log filter, because an investigator asking what an id did must
 *   not be silently answered about a different one; and scripts/mark-unpaid,
 *   which walks the users collection itself and would otherwise offer to mark
 *   one application twice.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

const OLD = 'a-superseded-profile';
const LIVE = 'b-live-profile';
const STRANGER = 'c-another-person';

let store: FakeDbHandle;

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    store.seed(COLLECTIONS.USERS, LIVE, { email: 'person@example.com' });
    store.seed(COLLECTIONS.USERS, OLD, { email: 'person@example.com', _migratedTo: LIVE });
    store.seed(COLLECTIONS.USERS, STRANGER, { email: 'other@example.com' });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the notification bell shows notices sent to either profile', () => {
    const notice = (id: string, userId: string, read = false) =>
        store.seed(COLLECTIONS.NOTIFICATIONS, id, {
            userId, read, title: 'Loan decision', body: 'x',
            createdAt: new Date('2026-01-01'),
        });

    it('THE test — a notice sent before the migration is still in the list', async () => {
        notice('n-old', OLD);

        const { getUserNotifications } = await import('@/infrastructure/notifications/service');
        const page = await getUserNotifications(LIVE);

        expect(page.notifications.map((n: any) => n.id)).toContain('n-old');
    });

    it("VACUITY CONTROL: and another person's notice never is", async () => {
        notice('n-x', STRANGER);

        const { getUserNotifications } = await import('@/infrastructure/notifications/service');

        expect((await getUserNotifications(LIVE)).notifications).toHaveLength(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the FOURTH double-lending door — the admin approval', () => {
    const ADMIN = { id: 'admin-1', roles: ['super_admin'], email: 'admin@example.com' };
    const APP = 'app-1';

    async function harness() {
        jest.resetModules();
        jest.doMock('@/lib/session-guard', () => ({
            requireSession: async () => ({ session: { user: ADMIN }, error: null }),
        }));
        jest.doMock('@/lib/require-admin', () => ({
            requireAdmin: async () => ({ userId: ADMIN.id, roles: ADMIN.roles }),
            liveAdminRoles: async () => ({ roles: ADMIN.roles }),
        }));
        jest.doMock('@/lib/loan-decision-notice', () => ({
            notifyLoanDecision: async () => undefined,
        }));
        jest.doMock('@/lib/audit-log', () => ({
            createAdminAuditLog: async () => undefined,
            recordAdminAction: async () => undefined,
        }));
        jest.doMock('@/lib/status-transition', () => ({
            claimStatusTransitionFromAny: async () => ({ claimed: true, status: null }),
            claimStatusTransition: async () => ({ claimed: true, status: null }),
        }));

        const { installFakeDb } = jest.requireActual<typeof import('@/lib/testing/fake-db')>(
            '@/lib/testing/fake-db');
        store = installFakeDb();
        const { COLLECTIONS: C } = jest.requireActual<typeof import('@/lib/types/firestore')>(
            '@/lib/types/firestore');
        store.seed(C.USERS, LIVE, { email: 'person@example.com' });
        store.seed(C.USERS, OLD, { email: 'person@example.com', _migratedTo: LIVE });
        store.seed(C.LOAN_APPLICATIONS, APP, {
            userId: LIVE, amount: 40_000, status: 'pending',
            contributionAmount: 200_000, durationMonths: 6,
        });
        return C as typeof COLLECTIONS;
    }

    const approve = async () => {
        //   Named exactly, not probed. Three guesses chained with `??` would
        //   fall through to a `throw` on a rename and look like a real
        //   refusal to the assertions below.
        const { approveLoanApplication } = await import('@/app/actions/admin/_loans');
        return await approveLoanApplication(APP) as any;
    };

    it('THE test — an open loan under the OLD profile refuses the approval', async () => {
        const C = await harness();
        store.seed(C.LOAN_APPLICATIONS, 'loan-old', {
            userId: OLD, status: 'disbursed', amount: 80_000,
        });

        const r = await approve();

        expect(r.success).toBe(false);
    });

    it('VACUITY CONTROL: with nothing under the old profile it proceeds', async () => {
        await harness();

        const r = await approve();

        expect(r.success).not.toBe(false);
    });

    it("VACUITY CONTROL: another borrower's open loan does not refuse it", async () => {
        const C = await harness();
        store.seed(C.USERS, STRANGER, { email: 'other@example.com' });
        store.seed(C.LOAN_APPLICATIONS, 'loan-x', {
            userId: STRANGER, status: 'disbursed', amount: 80_000,
        });

        const r = await approve();

        expect(r.success).not.toBe(false);
    });

    it('and it reads the shared status list rather than a fourth copy', () => {
        //   The literal was written out here a fourth time. Asserted as "no
        //   inline list", not as the list's spelling, so the rule may be
        //   respelled in its one home without breaking this.
        const { readFileSync } = require('fs');
        const { stripComments } = require('@/lib/testing/strip-comments');
        const src = stripComments(readFileSync('src/app/actions/admin/_loans.ts', 'utf-8'));

        expect(src).toContain('OPEN_LOAN_STATUSES');
        expect(src).not.toMatch(/"pending", ?"reviewing", ?"approved"/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("farm nation's lookup finds the applicant's own row before claiming one", () => {
    it('THE test — an application under the OLD profile is found by userId, not by address', async () => {
        //   Falling through to the address match is wrong twice over: it is
        //   their own row, and it should never have needed claiming.
        store.seed(COLLECTIONS.FARM_NATION_APPLICATIONS, 'fn-old', {
            userId: OLD, status: 'pending', userEmail: 'person@example.com',
        });

        const { findFarmNationApplications } =
            await import('@/lib/farm-nation-application-lookup');
        const { supabaseDb } = await import('@/lib/supabase-db');
        const found = await findFarmNationApplications(
            supabaseDb.collection(COLLECTIONS.FARM_NATION_APPLICATIONS),
            { userId: LIVE, email: 'person@example.com' } as any,
        );

        expect(found.map((m: any) => m.id)).toContain('fn-old');
        expect(found[0].via).toBe('userId');
    });

    it("VACUITY CONTROL: and another person's application is not returned", async () => {
        store.seed(COLLECTIONS.FARM_NATION_APPLICATIONS, 'fn-x', {
            userId: STRANGER, status: 'pending', userEmail: 'other@example.com',
        });

        const { findFarmNationApplications } =
            await import('@/lib/farm-nation-application-lookup');
        const { supabaseDb } = await import('@/lib/supabase-db');
        const found = await findFarmNationApplications(
            supabaseDb.collection(COLLECTIONS.FARM_NATION_APPLICATIONS),
            { userId: LIVE, email: 'person@example.com' } as any,
        );

        expect(found).toHaveLength(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('and the two that are deliberately left alone say so', () => {
    const src = (rel: string) => {
        const { readFileSync } = require('fs');
        return readFileSync(rel, 'utf-8');
    };

    it('the audit-log filter records why an admin search is not widened', () => {
        //   An investigator asking what an id did must not be silently
        //   answered about a different one — in the record that exists to be
        //   precise about exactly that.
        expect(src('src/app/actions/audit-log-actions.ts'))
            .toMatch(/NOT WIDENED ACROSS THE SUBJECT'S PROFILES, AND THAT IS A DECISION/);
    });

    it('and the maintenance script records why its candidate walk is not', () => {
        expect(src('src/scripts/mark-unpaid.ts')).toMatch(/NOT WIDENED/);
    });
});
