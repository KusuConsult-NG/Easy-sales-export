/**
 * @jest-environment node
 */

/**
 * checkModuleAccess, EXECUTED — eleven fallback layers across five modules.
 *
 * WHAT THIS FUNCTION IS FOR
 * -------------------------
 * The JWT is minted at login and refreshed hourly. When an admin approves an
 * application, the role lands in the database and the member's token does not
 * carry it, so `hasAppAccess(session.user.roles, module)` says no and the module
 * layout bounces them back to onboarding — indefinitely, for up to an hour, on a
 * module they have just paid for.
 *
 * So there are ELEVEN layers, and they exist because eleven different ways of
 * being a legitimate member were each found in production:
 *
 *   1     the JWT says so
 *   2     serviceRegistrations[module].status is approved or active
 *   2.5   the user document's roles[] array says so, even though
 *         serviceRegistrations was never written (admin used "Update Roles")
 *   2.6   a cooperative_members row exists — bulk import, no user backfill
 *   2.7   an academy application is approved
 *   2.8   a WAVE application is approved
 *   2.9   an export application is approved
 *   2.10  a farm-nation application is approved
 *   2.11  a seller verification is approved
 *
 * Every layer is a database query, so at 3.8% coverage none of them had ever been
 * executed by a test. A recorder harness could not: `where()` was a no-op, so
 * "find the cooperative member for this user" returned whatever the test stubbed
 * regardless of what was seeded.
 *
 * THE LAYERS ALSO HEAL, AND THAT IS THE PART WORTH CHECKING
 * ---------------------------------------------------------
 * Several layers write on the way through — stamping a userId onto a membership
 * that lacked one, flipping a paid-but-inactive membership to active, backfilling
 * serviceRegistrations so the fast layer works next time. Those writes are the
 * whole reason the slow layers do not stay slow, and they go through
 * `snapshot.ref.update(...)`, which is why lib/testing/fake-db.ts gives snapshots
 * a live ref.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';
import type { UserRole } from '@/lib/types/roles';

let store: FakeDbHandle;

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
});

async function access(userId: string, roles: string[], app: string): Promise<boolean> {
    const { checkModuleAccess } = await import('@/lib/module-access-check');
    return checkModuleAccess(userId, roles as UserRole[], app as never);
}

const UID = 'user-1';

/** A user document with nothing that grants access. */
function bareUser(extra: Record<string, unknown> = {}): void {
    store.seed(COLLECTIONS.USERS, UID, { email: 'member@example.com', ...extra });
}

// ─── Layer 1 ─────────────────────────────────────────────────────────────────

describe('Layer 1 — the JWT', () => {
    it('grants access without touching the database at all', async () => {
        // No user document is seeded. If the JWT check did not short-circuit, the
        // absent document would deny.
        expect(await access(UID, ['wave_participant'], 'wave')).toBe(true);
        expect(store.size(COLLECTIONS.USERS)).toBe(0);
    });

    it('and an admin role reaches every module', async () => {
        for (const app of ['wave', 'academy', 'export', 'cooperatives', 'farm-nation', 'marketplace']) {
            expect(await access(UID, ['admin'], app)).toBe(true);
        }
    });
});

describe('with no JWT role and no user document', () => {
    it('access is denied rather than erroring', async () => {
        expect(await access(UID, [], 'wave')).toBe(false);
    });
});

// ─── Layer 2 ─────────────────────────────────────────────────────────────────

describe('Layer 2 — serviceRegistrations', () => {
    it('approved or active grants access', async () => {
        for (const status of ['approved', 'active']) {
            store.seed(COLLECTIONS.USERS, UID, {
                email: 'm@example.com',
                serviceRegistrations: { wave: { status } },
            });
            expect(await access(UID, [], 'wave')).toBe(true);
        }
    });

    it('pending does not', async () => {
        bareUser({ serviceRegistrations: { wave: { status: 'pending' } } });
        expect(await access(UID, [], 'wave')).toBe(false);
    });

    it('and each module reads its OWN registration key', async () => {
        // The mapping is not the identity: farm-nation reads `farmNation`, and
        // cooperatives reads `cooperatives`. A module reading the wrong key admits
        // nobody, or admits everybody who joined a different module.
        bareUser({ serviceRegistrations: { wave: { status: 'approved' } } });
        expect(await access(UID, [], 'wave')).toBe(true);
        expect(await access(UID, [], 'academy')).toBe(false);
        expect(await access(UID, [], 'export')).toBe(false);
        expect(await access(UID, [], 'farm-nation')).toBe(false);
    });

    it('farm-nation reads farmNation, not farm-nation', async () => {
        bareUser({ serviceRegistrations: { farmNation: { status: 'approved' } } });
        expect(await access(UID, [], 'farm-nation')).toBe(true);
    });

    it('and farm-nation additionally accepts "verified", which is what land approval writes', async () => {
        // Module-specific, and deliberately so: the farm-nation admin approves a
        // land listing and the status becomes "verified". Treating that as no
        // access locks out exactly the people who completed the flow.
        bareUser({ serviceRegistrations: { farmNation: { status: 'verified' } } });
        expect(await access(UID, [], 'farm-nation')).toBe(true);

        // And "verified" is NOT accepted elsewhere.
        store.seed(COLLECTIONS.USERS, UID, {
            email: 'm@example.com',
            serviceRegistrations: { wave: { status: 'verified' } },
        });
        expect(await access(UID, [], 'wave')).toBe(false);
    });
});

describe('the legacy registration keys', () => {
    it('cooperatives falls back to the singular "cooperative"', async () => {
        bareUser({ serviceRegistrations: { cooperative: { status: 'approved' } } });
        expect(await access(UID, [], 'cooperatives')).toBe(true);
    });

    it('and when BOTH exist the further-progressed one wins', async () => {
        // Two keys for one membership is a migration artefact, and taking the
        // plural blindly would lock out a member whose progress is recorded under
        // the singular.
        bareUser({
            serviceRegistrations: {
                cooperatives: { status: 'not_started' },
                cooperative: { status: 'active' },
            },
        });
        expect(await access(UID, [], 'cooperatives')).toBe(true);
    });

    it('and not the other way round — a stale legacy key cannot demote a live one', async () => {
        bareUser({
            serviceRegistrations: {
                cooperatives: { status: 'active' },
                cooperative: { status: 'not_started' },
            },
        });
        expect(await access(UID, [], 'cooperatives')).toBe(true);
    });

    it('farmNation falls back to farm_nation the same way', async () => {
        bareUser({ serviceRegistrations: { farm_nation: { status: 'approved' } } });
        expect(await access(UID, [], 'farm-nation')).toBe(true);

        store.seed(COLLECTIONS.USERS, UID, {
            email: 'm@example.com',
            serviceRegistrations: {
                farmNation: { status: 'not_started' },
                farm_nation: { status: 'verified' },
            },
        });
        expect(await access(UID, [], 'farm-nation')).toBe(true);
    });

    it('and neither progressed enough still denies', async () => {
        bareUser({
            serviceRegistrations: {
                cooperatives: { status: 'pending' },
                cooperative: { status: 'not_started' },
            },
        });
        expect(await access(UID, [], 'cooperatives')).toBe(false);
    });
});

// ─── Layer 2.5 ───────────────────────────────────────────────────────────────

describe('Layer 2.5 — the roles array on the user document', () => {
    it('admits a user an admin role-assigned without writing serviceRegistrations', async () => {
        bareUser({ roles: ['wave_participant'] });
        expect(await access(UID, [], 'wave')).toBe(true);
    });

    it('with each module accepting only its own roles', async () => {
        bareUser({ roles: ['cooperative_member'] });
        expect(await access(UID, [], 'cooperatives')).toBe(true);
        expect(await access(UID, [], 'wave')).toBe(false);
    });

    it('and farm-nation accepting any of its three', async () => {
        for (const role of ['farmer', 'land_owner', 'investor']) {
            store.seed(COLLECTIONS.USERS, UID, { email: 'm@example.com', roles: [role] });
            expect(await access(UID, [], 'farm-nation')).toBe(true);
        }
    });

    it('and marketplace accepting buyer, seller or marketplace_buyer', async () => {
        for (const role of ['buyer', 'seller', 'marketplace_buyer']) {
            store.seed(COLLECTIONS.USERS, UID, { email: 'm@example.com', roles: [role] });
            expect(await access(UID, [], 'marketplace')).toBe(true);
        }
    });

    it('while an unrelated role grants nothing', async () => {
        bareUser({ roles: ['user'] });
        for (const app of ['wave', 'academy', 'export', 'cooperatives', 'farm-nation', 'marketplace']) {
            expect(await access(UID, [], app)).toBe(false);
        }
    });
});

// ─── Layer 2.6, and the healing ──────────────────────────────────────────────

describe('Layer 2.6 — a cooperative membership record found by query', () => {
    it('admits an active member whose user document knows nothing', async () => {
        // The bulk-import case: the membership exists, the user document was never
        // backfilled.
        bareUser();
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, 'mem-1',
            { userId: UID, membershipStatus: 'active' });

        expect(await access(UID, [], 'cooperatives')).toBe(true);
    });

    it('or found by document id, when the membership is keyed on the user', async () => {
        bareUser();
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, UID, { membershipStatus: 'approved' });
        expect(await access(UID, [], 'cooperatives')).toBe(true);
    });

    it('or found by email, lowercased', async () => {
        // The last resort, and the one that matters for records imported from a
        // spreadsheet with no ids at all. The stored email is compared in lower
        // case, so a mixed-case address in the user document still matches.
        store.seed(COLLECTIONS.USERS, UID, { email: 'Member@Example.com' });
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, 'mem-x',
            { email: 'member@example.com', membershipStatus: 'active' });

        expect(await access(UID, [], 'cooperatives')).toBe(true);
    });

    it('and stamps the userId onto a membership that lacked one', async () => {
        // The heal. Without it the same member takes the slow path — three queries
        // — on every single page load, forever.
        store.seed(COLLECTIONS.USERS, UID, { email: 'member@example.com' });
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, 'mem-x',
            { email: 'member@example.com', membershipStatus: 'active' });

        expect(await access(UID, [], 'cooperatives')).toBe(true);
        expect(store.get(COLLECTIONS.COOPERATIVE_MEMBERS, 'mem-x')?.userId).toBe(UID);
    });

    it('a pending membership does not grant access', async () => {
        bareUser();
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, 'mem-1',
            { userId: UID, membershipStatus: 'pending' });
        expect(await access(UID, [], 'cooperatives')).toBe(false);
    });

    it('UNLESS it is paid and onboarded, which is a healable state', async () => {
        // A member who paid and finished onboarding but whose status never flipped.
        // Denying them is the outage; this is the repair.
        bareUser();
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, 'mem-1', {
            userId: UID,
            membershipStatus: 'pending',
            onboardingCompleted: true,
            paymentStatus: 'completed',
        });

        expect(await access(UID, [], 'cooperatives')).toBe(true);
    });

    it('and the heal writes through, so the next request takes the fast path', async () => {
        bareUser();
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, 'mem-1', {
            userId: UID,
            membershipStatus: 'pending',
            onboardingCompleted: true,
            paymentStatus: 'completed',
        });

        await access(UID, [], 'cooperatives');

        expect(store.get(COLLECTIONS.COOPERATIVE_MEMBERS, 'mem-1')?.membershipStatus).toBe('active');
        const user = store.get(COLLECTIONS.USERS, UID);
        expect(user?.serviceRegistrations?.cooperatives?.status).toBe('active');
        expect(user?.roles).toContain('cooperative_member');
        expect(user?.isVerified).toBe(true);
    });

    it('but paid WITHOUT onboarding is not healable', async () => {
        // Both conditions, not either. Healing on payment alone would activate a
        // membership whose onboarding was never completed.
        bareUser();
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, 'mem-1',
            { userId: UID, membershipStatus: 'pending', paymentStatus: 'completed' });
        expect(await access(UID, [], 'cooperatives')).toBe(false);
    });

    it('nor is onboarded without payment', async () => {
        bareUser();
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, 'mem-1',
            { userId: UID, membershipStatus: 'pending', onboardingCompleted: true });
        expect(await access(UID, [], 'cooperatives')).toBe(false);
    });

    it('and another member’s record does not admit this user', async () => {
        // THE query test, and the one a recorder harness could never run: the
        // membership exists, it just belongs to somebody else.
        bareUser();
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, 'mem-other',
            { userId: 'somebody-else', membershipStatus: 'active' });
        expect(await access(UID, [], 'cooperatives')).toBe(false);
    });
});

// ─── Layers 2.7 to 2.11 ──────────────────────────────────────────────────────

describe('Layer 2.7 — an approved academy application', () => {
    it('grants access and backfills the user document', async () => {
        bareUser();
        store.seed(COLLECTIONS.ACADEMY_APPLICATIONS, 'app-1', { userId: UID, status: 'approved' });

        expect(await access(UID, [], 'academy')).toBe(true);

        const user = store.get(COLLECTIONS.USERS, UID);
        expect(user?.roles).toContain('academy_participant');
        expect(user?.serviceRegistrations?.academy?.status).toBe('approved');
        expect(user?.serviceRegistrations?.academy?.applicationId).toBe('app-1');
    });

    it('found by the nested personalInfo email when there is no userId', async () => {
        store.seed(COLLECTIONS.USERS, UID, { email: 'Learner@Example.com' });
        store.seed(COLLECTIONS.ACADEMY_APPLICATIONS, 'app-2',
            { status: 'approved', personalInfo: { email: 'learner@example.com' } });

        expect(await access(UID, [], 'academy')).toBe(true);
        // And healed with the userId, so the query finds it directly next time.
        expect(store.get(COLLECTIONS.ACADEMY_APPLICATIONS, 'app-2')?.userId).toBe(UID);
    });

    it('and a pending application does not', async () => {
        bareUser();
        store.seed(COLLECTIONS.ACADEMY_APPLICATIONS, 'app-1', { userId: UID, status: 'pending' });
        expect(await access(UID, [], 'academy')).toBe(false);
    });
});

describe('Layer 2.8 — an approved WAVE application', () => {
    it('grants access and backfills', async () => {
        bareUser();
        store.seed(COLLECTIONS.WAVE_APPLICATIONS, 'w-1', { userId: UID, status: 'approved' });

        expect(await access(UID, [], 'wave')).toBe(true);
        const user = store.get(COLLECTIONS.USERS, UID);
        expect(user?.roles).toContain('wave_participant');
        expect(user?.serviceRegistrations?.wave?.status).toBe('approved');
    });

    it('found by userEmail, and failing that by email', async () => {
        // WAVE records the address under two different names depending on which
        // form wrote it. Both are tried, in order.
        store.seed(COLLECTIONS.USERS, UID, { email: 'wave@example.com' });
        store.seed(COLLECTIONS.WAVE_APPLICATIONS, 'w-1',
            { status: 'approved', userEmail: 'wave@example.com' });
        expect(await access(UID, [], 'wave')).toBe(true);

        store = installFakeDb();
        store.seed(COLLECTIONS.USERS, UID, { email: 'wave@example.com' });
        store.seed(COLLECTIONS.WAVE_APPLICATIONS, 'w-2',
            { status: 'approved', email: 'wave@example.com' });
        expect(await access(UID, [], 'wave')).toBe(true);
    });

    it('and a rejected application does not', async () => {
        bareUser();
        store.seed(COLLECTIONS.WAVE_APPLICATIONS, 'w-1', { userId: UID, status: 'rejected' });
        expect(await access(UID, [], 'wave')).toBe(false);
    });
});

describe('Layer 2.9 — an approved export application', () => {
    it('grants access', async () => {
        bareUser();
        store.seed(COLLECTIONS.EXPORT_APPLICATIONS, 'e-1', { userId: UID, status: 'approved' });
        expect(await access(UID, [], 'export')).toBe(true);
    });

    it('found by the nested profile email', async () => {
        store.seed(COLLECTIONS.USERS, UID, { email: 'exporter@example.com' });
        store.seed(COLLECTIONS.EXPORT_APPLICATIONS, 'e-2',
            { status: 'approved', profile: { email: 'exporter@example.com' } });
        expect(await access(UID, [], 'export')).toBe(true);
    });
});

describe('Layer 2.10 — an approved farm-nation application', () => {
    it('grants access', async () => {
        bareUser();
        store.seed(COLLECTIONS.FARM_NATION_APPLICATIONS, 'f-1', { userId: UID, status: 'approved' });
        expect(await access(UID, [], 'farm-nation')).toBe(true);
    });
});

describe('Layer 2.11 — an approved seller verification', () => {
    it('grants marketplace access and backfills the seller role', async () => {
        bareUser();
        store.seed(COLLECTIONS.SELLER_VERIFICATIONS, 'sv-1', { userId: UID, status: 'approved' });

        expect(await access(UID, [], 'marketplace')).toBe(true);
        const user = store.get(COLLECTIONS.USERS, UID);
        expect(user?.roles).toContain('seller');
        expect(user?.serviceRegistrations?.marketplace?.status).toBe('approved');
    });

    it('and a pending verification does not', async () => {
        bareUser();
        store.seed(COLLECTIONS.SELLER_VERIFICATIONS, 'sv-1', { userId: UID, status: 'pending' });
        expect(await access(UID, [], 'marketplace')).toBe(false);
    });
});

// ─── the payment bypass, and the module boundary ─────────────────────────────

describe('the payment bypass account', () => {
    /**
     * A TEST address, supplied through PAYMENT_BYPASS_EMAILS.
     *
     * The production address is deliberately NOT written here.
     * payment-bypass.test.ts fails any file outside lib/payment-bypass.ts that
     * contains the literal — it was in seventeen places once, and one place is the
     * entire point. This exercises the mechanism instead of duplicating the value,
     * which is also the more useful test: it proves the env override works.
     */
    const TEST_BYPASS = 'bypass-under-test@example.invalid';
    const realBypassEnv = process.env.PAYMENT_BYPASS_EMAILS;

    beforeEach(() => {
        process.env.PAYMENT_BYPASS_EMAILS = TEST_BYPASS;
    });

    afterEach(() => {
        if (realBypassEnv === undefined) delete process.env.PAYMENT_BYPASS_EMAILS;
        else process.env.PAYMENT_BYPASS_EMAILS = realBypassEnv;
    });

    it('reaches cooperatives and academy with nothing else recorded', async () => {
        // An owner decision, kept deliberately — see lib/payment-bypass.ts. Pinned
        // here because it is a live authorisation exception, and an exception
        // nobody tests is an exception nobody notices widening.
        const { isPaymentBypassAccount } = await import('@/lib/payment-bypass');
        expect(isPaymentBypassAccount(TEST_BYPASS)).toBe(true);

        store.seed(COLLECTIONS.USERS, UID, { email: TEST_BYPASS });
        expect(await access(UID, [], 'cooperatives')).toBe(true);
        expect(await access(UID, [], 'academy')).toBe(true);
    });

    it('and NOT the other four modules', async () => {
        // The bypass is scoped. Widening it to every module would be a silent
        // change to who can reach export and marketplace.
        store.seed(COLLECTIONS.USERS, UID, { email: TEST_BYPASS });
        for (const app of ['wave', 'export', 'farm-nation', 'marketplace']) {
            expect(await access(UID, [], app)).toBe(false);
        }
    });

    it('while an ordinary address gets no bypass', async () => {
        bareUser();
        expect(await access(UID, [], 'cooperatives')).toBe(false);
    });
});

describe('a module’s fallback layers are its own', () => {
    it('an approved record in one module does not open another', async () => {
        // The cross-module property, checked once across all five. Each layer is
        // guarded by `if (app === ...)`, and one missing guard would make an
        // academy application open the export module.
        bareUser();
        store.seed(COLLECTIONS.ACADEMY_APPLICATIONS, 'a', { userId: UID, status: 'approved' });
        store.seed(COLLECTIONS.WAVE_APPLICATIONS, 'w', { userId: UID, status: 'rejected' });

        expect(await access(UID, [], 'academy')).toBe(true);
        expect(await access(UID, [], 'wave')).toBe(false);
        expect(await access(UID, [], 'export')).toBe(false);
        expect(await access(UID, [], 'farm-nation')).toBe(false);
        expect(await access(UID, [], 'marketplace')).toBe(false);
        expect(await access(UID, [], 'cooperatives')).toBe(false);
    });
});

describe('when the database itself fails', () => {
    it('access is DENIED, not granted', async () => {
        // Fail closed. A read error must not become an open door, and this is the
        // one branch a test can only reach by breaking the store deliberately.
        (globalThis as { mockFirestoreGet: { mockImplementation: (f: () => never) => void } })
            .mockFirestoreGet.mockImplementation(() => {
                throw new Error('connection reset');
            });

        expect(await access(UID, [], 'cooperatives')).toBe(false);
    });

    it('and a JWT that already grants access is unaffected, because it never reads', async () => {
        (globalThis as { mockFirestoreGet: { mockImplementation: (f: () => never) => void } })
            .mockFirestoreGet.mockImplementation(() => {
                throw new Error('connection reset');
            });

        expect(await access(UID, ['cooperative_member'], 'cooperatives')).toBe(true);
    });
});
