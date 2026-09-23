/**
 *   THE MODULE GATE GRANTED ACCESS ON A FIELD THE APPLICANT TYPES.
 *
 *   Layers 2.7 to 2.10 of checkModuleAccess look an application up by the
 *   caller's email when none is filed under their user id. Three status actions
 *   ask the same question and were narrowed against two defects; the gate kept
 *   both, and the gate is the worse place to keep them — a status action
 *   promotes a STATUS, the gate grants the module ROLE and writes
 *   `serviceRegistrations.<app>.status: "approved"`, which the layers above it
 *   then grant on for ever without reaching this code again.
 *
 *   DEFECT 1 — the second query matched an address nobody authenticated as:
 *   `email` on a WAVE application is the OPTIONAL field on the form,
 *   `profile.email` and `personalInfo.email` come from imports and admin edits.
 *   `userEmail` is written from session.user.email at submission and is the
 *   only one of the four that means anything.
 *
 *   DEFECT 2 — the `!userId` test guarded the backfill WRITE, not the grant. An
 *   application belonging to somebody else was still read and its approval
 *   still handed to the caller.
 *
 *   ACADEMY IS DELIBERATELY DIFFERENT and the asymmetry is asserted here rather
 *   than left to be discovered: nothing under src/app/actions/academy writes
 *   `userEmail`, so `personalInfo.email` is the ONLY address on the row.
 *   Removing that query would delete the legacy route rather than narrow it. So
 *   academy closes defect 2 and cannot close defect 1 — which is enough,
 *   because every application submitted through this platform carries a
 *   `userId`, so a typed address on a real application is no longer readable by
 *   the person whose address was typed.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

jest.mock('@/lib/rate-limiter', () => ({
    rateLimit: () => ({ check: jest.fn(async () => ({ success: true, limit: 100, remaining: 99, reset: 0 })) }),
    getClientIp: jest.fn(() => '127.0.0.1'),
    createRateLimitResponse: jest.fn(),
}));

const CALLER = 'caller-1';
const CALLER_EMAIL = 'caller@example.test';
const SOMEBODY_ELSE = 'other-1';
const ROLES = ['general_user'];

const WHEN = { createdAt: '2026-01-01T00:00:00.000Z', submittedAt: '2026-01-01T00:00:00.000Z' };

let store: FakeDbHandle;

const gate = () => import('@/lib/module-access-check');

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    store.seed(COLLECTIONS.USERS, CALLER, {
        uid: CALLER,
        email: CALLER_EMAIL,
        roles: ROLES,
        isVerified: true,
        profileComplete: true,
        serviceRegistrations: {},
    });
});

/** The roles actually written to the caller's row — a grant, not just a `true`. */
function grantedRoles(): string[] {
    const row = store.get(COLLECTIONS.USERS, CALLER) as any;
    return Array.isArray(row?.roles) ? row.roles : [];
}

describe('WAVE — the optional `email` field on the application form', () => {
    it('DOES NOT OPEN THE MODULE, and does not write the role', async () => {
        //   An approved application carrying the caller's address in the field
        //   the APPLICANT types, and nowhere else.
        store.seed(COLLECTIONS.WAVE_APPLICATIONS, 'typed-only', {
            email: CALLER_EMAIL, status: 'approved', ...WHEN,
        });

        const { checkModuleAccess } = await gate();

        await expect(checkModuleAccess(CALLER, ROLES as never, 'wave')).resolves.toBe(false);
        expect(grantedRoles()).not.toContain('wave_participant');
    });

    it('but `userEmail` on an UNCLAIMED application still does', async () => {
        //   The legitimate case this fallback exists for: an application filed
        //   before the account existed, carrying the address it was submitted
        //   under. Unchanged, and asserted so the fix above is a narrowing
        //   rather than a deletion.
        store.seed(COLLECTIONS.WAVE_APPLICATIONS, 'unclaimed', {
            userEmail: CALLER_EMAIL, status: 'approved', ...WHEN,
        });

        const { checkModuleAccess } = await gate();

        await expect(checkModuleAccess(CALLER, ROLES as never, 'wave')).resolves.toBe(true);
        expect(grantedRoles()).toContain('wave_participant');
    });

    it('AND NOT WHEN THAT APPLICATION BELONGS TO SOMEBODY ELSE', async () => {
        store.seed(COLLECTIONS.WAVE_APPLICATIONS, 'already-owned', {
            userId: SOMEBODY_ELSE, userEmail: CALLER_EMAIL, status: 'approved', ...WHEN,
        });

        const { checkModuleAccess } = await gate();

        await expect(checkModuleAccess(CALLER, ROLES as never, 'wave')).resolves.toBe(false);
        expect(grantedRoles()).not.toContain('wave_participant');
    });

    it('and asks the collection ONCE on that path, not twice', async () => {
        const { checkModuleAccess } = await gate();
        store.reads.length = 0;

        await checkModuleAccess(CALLER, ROLES as never, 'wave');

        const appReads = store.reads.filter((r) => r.collection === COLLECTIONS.WAVE_APPLICATIONS);
        //   The owner-scoped query and the userEmail query. The typed-field
        //   query that used to follow is gone; one fewer round trip is a side
        //   effect of the fix, not its purpose.
        expect(appReads.length).toBe(2);
    });
});

describe('Export and Farm Nation — `profile.email`', () => {
    it.each([
        ['export', COLLECTIONS.EXPORT_APPLICATIONS, 'export_participant'] as const,
        ['farm-nation', COLLECTIONS.FARM_NATION_APPLICATIONS, 'farmer'] as const,
    ])('%s does not open on an address from an import', async (app, collection, role) => {
        store.seed(collection, 'typed-only', {
            profile: { email: CALLER_EMAIL }, status: 'approved', ...WHEN,
        });

        const { checkModuleAccess } = await gate();

        await expect(checkModuleAccess(CALLER, ROLES as never, app as never)).resolves.toBe(false);
        expect(grantedRoles()).not.toContain(role);
    });

    it.each([
        ['export', COLLECTIONS.EXPORT_APPLICATIONS] as const,
        ['farm-nation', COLLECTIONS.FARM_NATION_APPLICATIONS] as const,
    ])('%s still opens on an unclaimed userEmail match', async (app, collection) => {
        store.seed(collection, 'unclaimed', {
            userEmail: CALLER_EMAIL, status: 'approved', ...WHEN,
        });

        const { checkModuleAccess } = await gate();

        await expect(checkModuleAccess(CALLER, ROLES as never, app as never)).resolves.toBe(true);
    });

    it.each([
        ['export', COLLECTIONS.EXPORT_APPLICATIONS] as const,
        ['farm-nation', COLLECTIONS.FARM_NATION_APPLICATIONS] as const,
    ])('%s refuses one that already belongs to another account', async (app, collection) => {
        store.seed(collection, 'already-owned', {
            userId: SOMEBODY_ELSE, userEmail: CALLER_EMAIL, status: 'approved', ...WHEN,
        });

        const { checkModuleAccess } = await gate();

        await expect(checkModuleAccess(CALLER, ROLES as never, app as never)).resolves.toBe(false);
    });
});

describe('Academy — the asymmetry, asserted', () => {
    it('KEEPS the typed route, because the row carries no other address', async () => {
        //   Deliberately still granted. Removing this query would lock out
        //   every learner whose application predates their account, and there
        //   is no `userEmail` on an academy application to fall back to.
        store.seed(COLLECTIONS.ACADEMY_APPLICATIONS, 'unclaimed', {
            personalInfo: { email: CALLER_EMAIL },
            status: 'approved',
            paymentStatus: 'completed',
            ...WHEN,
        });

        const { checkModuleAccess } = await gate();

        await expect(checkModuleAccess(CALLER, ROLES as never, 'academy')).resolves.toBe(true);
    });

    it('but STOPS ADOPTING one that already belongs to another account', async () => {
        store.seed(COLLECTIONS.ACADEMY_APPLICATIONS, 'already-owned', {
            userId: SOMEBODY_ELSE,
            personalInfo: { email: CALLER_EMAIL },
            status: 'approved',
            paymentStatus: 'completed',
            ...WHEN,
        });

        const { checkModuleAccess } = await gate();

        await expect(checkModuleAccess(CALLER, ROLES as never, 'academy')).resolves.toBe(false);
        expect(grantedRoles()).not.toContain('academy_participant');
    });
});

describe('the rule itself', () => {
    const doc = (userId: unknown, submittedAt: string, id = submittedAt) => ({
        id,
        data: () => ({ userId, submittedAt, createdAt: submittedAt }),
    });

    it('picks the NEWEST unclaimed, not merely the first', async () => {
        //   Filtering by ownership must not quietly change which of the
        //   survivors these layers choose — they have always ranked by
        //   latestApplication, and a resubmission is a second row.
        const { claimableByEmail } = await import('@/lib/claimable-application');

        const out = claimableByEmail([
            doc(undefined, '2026-01-01T00:00:00.000Z'),
            doc('somebody', '2026-06-01T00:00:00.000Z'),
            doc(undefined, '2026-03-01T00:00:00.000Z'),
        ]);

        expect(out.claimable?.id).toBe('2026-03-01T00:00:00.000Z');
        expect(out.ownedByOthers).toBe(1);
    });

    it('treats a BLANK userId as unclaimed, not as an owner', async () => {
        //   An import writing `userId: ""` would otherwise be stricter here
        //   than in the three actions this copies, locking out the exact rows
        //   the fallback exists for.
        const { claimableByEmail } = await import('@/lib/claimable-application');

        const out = claimableByEmail([doc('   ', '2026-01-01T00:00:00.000Z')]);

        expect(out.claimable).not.toBeNull();
        expect(out.ownedByOthers).toBe(0);
    });

    it('reports nothing claimable when every match is owned', async () => {
        const { claimableByEmail } = await import('@/lib/claimable-application');

        const out = claimableByEmail([
            doc('a', '2026-01-01T00:00:00.000Z'),
            doc('b', '2026-02-01T00:00:00.000Z'),
        ]);

        expect(out).toEqual({ claimable: null, ownedByOthers: 2 });
    });
});
