/**
 * @jest-environment node
 */

/**
 * #179 ONE PROGRESS RULE, SEVEN COPIES, TWO OF THEM DIFFERENT.
 *
 *      Six files each declared their own `getProgressScore`, and they disagreed:
 *
 *                                         'verified'  'under_review'
 *        cooperative/_coop_membership.ts       0            0
 *        cooperative/_coop_registration.ts     0            0
 *        lib/schema-normalizer.ts   (coop)     0            0
 *        lib/schema-normalizer.ts   (farm)     4            0
 *        lib/module-access-check.ts (coop)     0            0
 *        lib/module-access-check.ts (farm)     4            0
 *        lib/user-migration.ts                 4            3
 *
 *      The score decides which of two registrations survives a merge, and in
 *      module-access-check it decides whether somebody gets into the module at
 *      all. A status scoring 0 loses to everything — including 'not_started',
 *      which scores 1. So a member whose COOPERATIVE registration said
 *      `verified` was refused, while a member whose FARM NATION registration
 *      said `verified` was admitted, by two copies of the same function twenty
 *      lines apart in one file.
 *
 * #180 THE RECOVERY TOOL DOWNGRADED LIVE REGISTRATIONS.
 *
 *      Each of the six module blocks overwrote whenever the two merely DIFFERED:
 *      `if (!registrations.wave || registrations.wave.status !== waveData.status)`.
 *      The registration is the live record and the application is the historical
 *      one, so "different" routinely means the registration is ahead. An
 *      approved member whose application row still read `pending` was put back
 *      to pending — a repair utility revoking paid-for memberships across six
 *      modules, for every user, from one button.
 *
 * #181 AND WROTE undefined OVER REAL VALUES.
 *      The header of data-recovery.ts explains at length why an undefined write
 *      corrupts the field it repairs — and that guard was applied to
 *      `submittedAt` alone. `plan`, `tier` and `role` beside it kept the bug,
 *      and `accountType` was worse: it defaulted to "seller", so a buyer-only
 *      account was rewritten as a seller.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';
import { registrationProgressScore, isFurtherAlong } from '@/lib/registration-progress';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null, setCache: async () => undefined,
    deleteCache: async () => undefined, redis: null,
}));
jest.mock('@/lib/auth', () => ({
    auth: async () => null, signIn: async () => undefined,
    signOut: async () => undefined, handlers: {},
}));

let store: FakeDbHandle;
const USER = 'user-1';
const USERS = COLLECTIONS.USERS;

function actAs(id: string | null, roles: string[] = ['general_user']): void {
    (globalThis as {
        mockRequireSession: { mockImplementation: (f: () => unknown) => void };
    }).mockRequireSession.mockImplementation(() => Promise.resolve(
        id === null
            ? { session: null, error: { error: 'Authentication required' } }
            : { session: { user: { id, roles, email: `${id}@e.com` } }, error: null },
    ));
}

const recover = async () =>
    (await (await import('@/app/actions/data-recovery'))
        .runServiceRegistrationRecoveryAction()) as any;

const seedUser = (registrations: Record<string, unknown>, over: Record<string, unknown> = {}) =>
    store.seed(USERS, USER, {
        email: 'ada@example.com', firstName: 'Ada', lastName: 'Obi',
        serviceRegistrations: registrations, ...over,
    });

const regs = () => (store.get(USERS, USER) as any).serviceRegistrations ?? {};

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    actAs('admin-1', ['super_admin']);
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#179 — one progress rule', () => {
    it.each([
        ['active', 4], ['approved', 4], ['verified', 4],
        ['pending', 3], ['pending_review', 3], ['under_review', 3], ['revision_required', 3],
        ['pending_repair', 2], ['legacy_pending_onboarding', 2],
        ['not_started', 1],
    ])('%s scores %i', (status, score) => {
        expect(registrationProgressScore(status)).toBe(score);
    });

    it('SCORES verified ABOVE not_started — four of the seven copies did not', () => {
        // This is the divergence, stated as the thing it caused: a verified
        // cooperative member losing to a stale not_started record.
        expect(registrationProgressScore('verified'))
            .toBeGreaterThan(registrationProgressScore('not_started'));
    });

    it('SCORES under_review IN THE PENDING FAMILY — six of the seven scored it 0', () => {
        expect(registrationProgressScore('under_review'))
            .toBe(registrationProgressScore('pending'));
        expect(registrationProgressScore('under_review'))
            .toBeGreaterThan(registrationProgressScore('not_started'));
    });

    it('gives an unrecognised status 0, so it loses every comparison', () => {
        expect(registrationProgressScore('something_new')).toBe(0);
        expect(registrationProgressScore('')).toBe(0);
        expect(registrationProgressScore(undefined)).toBe(0);
        expect(registrationProgressScore(null)).toBe(0);
    });

    it('is case-insensitive, because the writers are not consistent', () => {
        expect(registrationProgressScore('APPROVED')).toBe(4);
        expect(registrationProgressScore('Pending')).toBe(3);
    });

    it('isFurtherAlong is strict, so a tie does not churn the record', () => {
        expect(isFurtherAlong('approved', 'pending')).toBe(true);
        expect(isFurtherAlong('pending', 'approved')).toBe(false);
        expect(isFurtherAlong('approved', 'approved')).toBe(false);
        expect(isFurtherAlong('approved', undefined)).toBe(true);
    });

    it('no source file declares its own copy any more', () => {
        // Scoped to src/lib and src/app, not all of src: this file's own grep
        // string is otherwise the one remaining match, and a guard that counts
        // itself would go green the moment somebody deleted it.
        const { execSync } = require('child_process');
        const hits = execSync(
            "grep -rl 'const getProgressScore' src/lib src/app --include=*.ts | wc -l",
            { cwd: process.cwd(), encoding: 'utf8' },
        ).trim();
        expect(hits).toBe('0');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#180 — the recovery does not move anyone backwards', () => {
    it('refuses a caller without users:update', async () => {
        actAs('someone', ['support']);
        expect(await recover()).toMatchObject({ success: false });
    });

    it('DOES NOT DOWNGRADE AN APPROVED MEMBER TO THE APPLICATION\'S pending', async () => {
        seedUser({ wave: { status: 'approved', submittedAt: '2026-01-01T00:00:00.000Z' } });
        store.seed(COLLECTIONS.WAVE_APPLICATIONS, 'app-1', {
            userId: USER, status: 'pending', createdAt: '2026-05-01T00:00:00.000Z',
        });

        const res = await recover();

        expect(res.success).toBe(true);
        expect(regs().wave.status).toBe('approved');
        expect(res.stats.fixedCount).toBe(0);
    });

    it.each([
        ['active', 'pending'],
        ['approved', 'under_review'],
        ['verified', 'not_started'],
        ['pending', 'pending_repair'],
    ])('keeps a %s registration against a %s application', async (live, application) => {
        seedUser({ academy: { status: live } });
        store.seed(COLLECTIONS.ACADEMY_APPLICATIONS, 'app-1', {
            userId: USER, status: application, createdAt: '2026-05-01T00:00:00.000Z',
        });

        await recover();
        expect(regs().academy.status).toBe(live);
    });

    it('DOES recover when the registration is missing entirely', async () => {
        // The case the tool exists for.
        seedUser({});
        store.seed(COLLECTIONS.WAVE_APPLICATIONS, 'app-1', {
            userId: USER, status: 'approved', createdAt: '2026-05-01T00:00:00.000Z',
        });

        const res = await recover();

        expect(regs().wave.status).toBe('approved');
        expect(res.stats.fixedCount).toBe(1);
    });

    it('and when the application is genuinely further along', async () => {
        seedUser({ wave: { status: 'pending' } });
        store.seed(COLLECTIONS.WAVE_APPLICATIONS, 'app-1', {
            userId: USER, status: 'approved', createdAt: '2026-05-01T00:00:00.000Z',
        });

        await recover();
        expect(regs().wave.status).toBe('approved');
    });

    it('leaves a user with nothing to fix untouched', async () => {
        seedUser({ wave: { status: 'approved' } });
        store.seed(COLLECTIONS.WAVE_APPLICATIONS, 'app-1', {
            userId: USER, status: 'approved', createdAt: '2026-05-01T00:00:00.000Z',
        });

        const res = await recover();
        expect(res.stats.fixedCount).toBe(0);
        expect((store.get(USERS, USER) as any)._dataIntegrityRemediated).toBeUndefined();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#181 — it does not write undefined over a real value', () => {
    it('KEEPS THE LEARNER\'S PLAN when the application has none', async () => {
        seedUser({ academy: { status: 'pending', plan: 'elite' } });
        store.seed(COLLECTIONS.ACADEMY_APPLICATIONS, 'app-1', {
            userId: USER, status: 'approved', createdAt: '2026-05-01T00:00:00.000Z',
            // no plan
        });

        await recover();

        expect(regs().academy.status).toBe('approved');   // the status did recover
        expect(regs().academy.plan).toBe('elite');        // the plan survived
    });

    it('DOES NOT REWRITE A BUYER AS A SELLER', async () => {
        // The accountType write defaulted to "seller" when the verification row
        // carried none, so a buyer-only account changed hands.
        seedUser({ marketplace: { status: 'pending', accountType: 'buyer' } });
        store.seed(COLLECTIONS.SELLER_VERIFICATIONS, 'v-1', {
            userId: USER, status: 'approved', createdAt: '2026-05-01T00:00:00.000Z',
        });

        await recover();

        expect(regs().marketplace.status).toBe('approved');
        expect(regs().marketplace.accountType).toBe('buyer');
    });

    it('keeps the cooperative tier and the farm-nation role', async () => {
        seedUser({
            cooperatives: { status: 'pending', tier: 'gold' },
            farmNation: { status: 'pending', role: 'landowner' },
        });
        store.seed(COLLECTIONS.COOPERATIVE_ONBOARDING, 'c-1', {
            userId: USER, status: 'approved', createdAt: '2026-05-01T00:00:00.000Z',
        });
        store.seed(COLLECTIONS.FARM_NATION_APPLICATIONS, 'f-1', {
            userId: USER, status: 'approved', createdAt: '2026-05-01T00:00:00.000Z',
        });

        await recover();

        expect(regs().cooperatives).toMatchObject({ status: 'approved', tier: 'gold' });
        expect(regs().farmNation).toMatchObject({ status: 'approved', role: 'landowner' });
    });

    it('still writes those fields when the application HAS them', async () => {
        seedUser({});
        store.seed(COLLECTIONS.ACADEMY_APPLICATIONS, 'app-1', {
            userId: USER, status: 'approved', plan: 'standard',
            createdAt: '2026-05-01T00:00:00.000Z',
        });

        await recover();
        expect(regs().academy).toMatchObject({ status: 'approved', plan: 'standard' });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('what else the recovery does', () => {
    it('syncs the two verification flags in both directions', async () => {
        seedUser({}, { verified: true, isVerified: false });
        await recover();
        expect(store.get(USERS, USER)).toMatchObject({ isVerified: true });

        store.clear();
        seedUser({}, { isVerified: true, verified: false });
        await recover();
        expect(store.get(USERS, USER)).toMatchObject({ verified: true });
    });

    it('backfills a name from whichever application actually carries one', async () => {
        // The wave record exists but has no name; the academy one does. An `||`
        // chain over objects stopped at the first and never looked further.
        seedUser({}, { firstName: undefined, lastName: undefined });
        store.seed(COLLECTIONS.WAVE_APPLICATIONS, 'w-1', {
            userId: USER, status: 'pending', createdAt: '2026-05-01T00:00:00.000Z',
        });
        store.seed(COLLECTIONS.ACADEMY_APPLICATIONS, 'a-1', {
            userId: USER, status: 'pending', firstName: 'Ada', lastName: 'Obi',
            createdAt: '2026-05-02T00:00:00.000Z',
        });

        await recover();

        expect(store.get(USERS, USER)).toMatchObject({ firstName: 'Ada', lastName: 'Obi' });
    });

    it('records the run in the audit log', async () => {
        seedUser({});
        await recover();

        expect((globalThis as any).mockRecordAdminAction).toHaveBeenCalledWith(
            expect.objectContaining({ action: 'data_recovery_run', userId: 'admin-1' }),
        );
    });

    it('reports a per-user failure without abandoning the sweep', async () => {
        seedUser({});
        store.seed(USERS, 'user-2', { email: 'b@e.com', serviceRegistrations: {} });
        store.seed(COLLECTIONS.WAVE_APPLICATIONS, 'w-1', {
            userId: USER, status: 'approved', createdAt: '2026-05-01T00:00:00.000Z',
        });
        store.seed(COLLECTIONS.WAVE_APPLICATIONS, 'w-2', {
            userId: 'user-2', status: 'approved', createdAt: '2026-05-01T00:00:00.000Z',
        });

        const res = await recover();
        expect(res.success).toBe(true);
        expect(res.stats.totalUsersProcessed).toBe(2);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
/**
 * #182 A PLATFORM-WIDE DESTRUCTIVE REPAIR WITH NO PREVIEW AND NO PAGINATION.
 *
 * The sweep was `.all().get()` over the whole users table — with the note "For
 * very large databases, this should be paginated" sitting above it — and each
 * user then costs six more queries, so the run is 6N+1 round trips. At any real
 * membership it times out PART-WAY THROUGH, having written some users and not
 * others, and reports nothing about where it stopped.
 *
 * And there was no dry run. #180 is exactly the kind of thing a preview exists
 * to catch before it reaches anybody's account.
 */
describe('#182 — pagination and dry run', () => {
    const recoverWith = async (options: Record<string, unknown>) =>
        (await (await import('@/app/actions/data-recovery'))
            .runServiceRegistrationRecoveryAction(options as never)) as any;

    const seedMany = (n: number) => {
        for (let i = 0; i < n; i++) {
            store.seed(USERS, `u${i}`, {
                email: `u${i}@e.com`, serviceRegistrations: {},
                createdAt: `2026-01-${String((i % 28) + 1).padStart(2, '0')}T00:00:00.000Z`,
            });
            store.seed(COLLECTIONS.WAVE_APPLICATIONS, `w${i}`, {
                userId: `u${i}`, status: 'approved', createdAt: '2026-05-01T00:00:00.000Z',
            });
        }
    };

    it('walks every user across several pages', async () => {
        seedMany(25);

        const res = await recoverWith({ pageSize: 10 });

        expect(res.stats.totalUsersProcessed).toBe(25);
        expect(res.stats.fixedCount).toBe(25);
    });

    it('honours a ceiling, so an operator can try a slice first', async () => {
        seedMany(25);

        const res = await recoverWith({ pageSize: 10, maxUsers: 5 });

        expect(res.stats.totalUsersProcessed).toBe(5);
        expect(res.stats.fixedCount).toBe(5);
    });

    it('A DRY RUN WRITES NOTHING AND SAYS WHAT IT WOULD HAVE DONE', async () => {
        seedUser({});
        store.seed(COLLECTIONS.WAVE_APPLICATIONS, 'w-1', {
            userId: USER, status: 'approved', createdAt: '2026-05-01T00:00:00.000Z',
        });

        const res = await recoverWith({ dryRun: true });

        expect(res.stats.dryRun).toBe(true);
        expect(res.stats.corruptedFound).toBe(1);
        expect(res.stats.fixedCount).toBe(0);
        // The user is untouched.
        expect(regs().wave).toBeUndefined();
        expect((store.get(USERS, USER) as any)._dataIntegrityRemediated).toBeUndefined();
        // And the operator can see what it was about to write.
        expect(res.stats.plannedChanges).toHaveLength(1);
        expect(res.stats.plannedChanges[0]).toMatchObject({ userId: USER });
        // Bracket access, not toHaveProperty: these keys are literal dotted
        // strings (Firestore field paths) and toHaveProperty would read the dots
        // as a nested path and find nothing.
        expect(res.stats.plannedChanges[0].updates['serviceRegistrations.wave.status'])
            .toBe('approved');
    });

    it('a real run reports dryRun false and writes', async () => {
        seedUser({});
        store.seed(COLLECTIONS.WAVE_APPLICATIONS, 'w-1', {
            userId: USER, status: 'approved', createdAt: '2026-05-01T00:00:00.000Z',
        });

        const res = await recoverWith({});

        expect(res.stats.dryRun).toBe(false);
        expect(res.stats.fixedCount).toBe(1);
        expect(regs().wave.status).toBe('approved');
    });

    it('the audit row distinguishes a dry run from a real one', async () => {
        seedUser({});
        await recoverWith({ dryRun: true });

        const [[entry]] = (globalThis as any).mockRecordAdminAction.mock.calls;
        expect(entry.metadata.stats.dryRun).toBe(true);
    });
});
