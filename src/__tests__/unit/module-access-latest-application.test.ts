/**
 * @jest-environment node
 */

/**
 *   #227 WHICH APPLICATION DECIDED ACCESS WAS ARBITRARY.
 *
 *        Every fallback layer in module-access-check.ts read
 *
 *            .where("userId", "==", userId).limit(1)
 *
 *        with NO orderBy, then trusted whatever came back. PostgREST returns
 *        rows in whatever order the plan produces, so for a member with more
 *        than one application two identical requests could be decided by
 *        different records. Sixteen such queries, across the cooperative,
 *        academy, WAVE, export and verification layers.
 *
 *   #228 AND AN OLD APPROVAL OVERRODE A NEW REJECTION.
 *
 *        The consequence, and it persists. Apply, be approved. Reapply, be
 *        rejected — #210 revokes the module role and marks the registration
 *        rejected. The member then opens any page in the module:
 *
 *            Layer 1  the JWT role — gone, so it fails
 *            Layer 2  serviceRegistrations.<key>.status — "rejected", fails
 *            Layer 2.7/2.8/2.9  finds the OLD approved application and writes
 *                     `status: "approved"` back over the rejection, with
 *                     arrayUnion of the role
 *
 *        A page load undid an admin's decision, in the database.
 *
 *        THIS IS THE THIRD PLACE THIS LOOP HAS BEEN FOUND. #207 was the login
 *        self-heal in schema-normalizer; #225 was course enrolment granting the
 *        role back; this is the access check itself. Each time the shape is the
 *        same: a repair rule reading evidence without asking whether it is the
 *        LATEST evidence. Fixing the three rejection paths (#210) achieves
 *        nothing while any of the three repair paths can undo them, which is
 *        why they are worth chasing individually.
 *
 *        _checkAcademyStatusAction already sorted applications by recency and
 *        took the newest. The rule existed in the codebase; the access check
 *        did not use it.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null, setCache: async () => undefined,
    deleteCache: async () => undefined, redis: null,
}));

let store: FakeDbHandle;
const USERS = COLLECTIONS.USERS;
const MEMBER = 'member-1';

const access = async () => await import('@/lib/module-access-check');

/** A member with no role and a rejected registration — the post-#210 state. */
const seedRejectedMember = (regKey: string) => {
    store.seed(USERS, MEMBER, {
        email: 'member@e.com',
        roles: ['general_user'],
        serviceRegistrations: { [regKey]: { status: 'rejected' } },
    });
};

/**
 * The ids are named ALPHABETICALLY AGAINST the chronology on purpose.
 *
 * An unordered query returns rows by id — that is what the adapter's
 * `.order('id')` fallback does, and what the fake reproduces. So `a-old-*`
 * sorts first and is exactly the row the defect trusted. My first version of
 * these fixtures used `old-*` / `new-*`, where "new" happens to sort before
 * "old", and the mutation-test therefore PASSED against the defect: the
 * arbitrary pick landed on the right row by luck. A fixture that makes the bug
 * invisible is worse than no fixture.
 */
const seedApp = (
    collection: string,
    id: string,
    status: string,
    submittedAt: string,
    extra: Record<string, unknown> = {},
) => {
    store.seed(collection, id, {
        userId: MEMBER, status, submittedAt, createdAt: submittedAt, ...extra,
    });
};

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#228 — the latest decision stands', () => {
    it.each([
        ['academy', COLLECTIONS.ACADEMY_APPLICATIONS, 'academy'],
        ['wave', COLLECTIONS.WAVE_APPLICATIONS, 'wave'],
        ['export', COLLECTIONS.EXPORT_APPLICATIONS, 'export'],
    ])('A NEW REJECTION IS NOT OVERRIDDEN BY AN OLD APPROVAL — %s', async (app, collection, regKey) => {
        seedRejectedMember(regKey);
        seedApp(collection, 'a-old-approved', 'approved', '2026-01-01T00:00:00.000Z');
        seedApp(collection, 'b-new-rejected', 'rejected', '2026-06-01T00:00:00.000Z');

        const granted = await (await access()).checkModuleAccess(MEMBER, ['general_user'], app as never);

        // Was: true, plus the rejection rewritten as "approved" in the database.
        expect(granted).toBe(false);
    });

    it.each([
        ['academy', COLLECTIONS.ACADEMY_APPLICATIONS, 'academy'],
        ['wave', COLLECTIONS.WAVE_APPLICATIONS, 'wave'],
        ['export', COLLECTIONS.EXPORT_APPLICATIONS, 'export'],
    ])('AND THE REJECTION IS NOT REWRITTEN IN THE DATABASE — %s', async (app, collection, regKey) => {
        seedRejectedMember(regKey);
        seedApp(collection, 'a-old-approved', 'approved', '2026-01-01T00:00:00.000Z');
        seedApp(collection, 'b-new-rejected', 'rejected', '2026-06-01T00:00:00.000Z');

        await (await access()).checkModuleAccess(MEMBER, ['general_user'], app as never);

        const user = store.get(USERS, MEMBER)!;
        expect(user.serviceRegistrations[regKey].status).toBe('rejected');
        expect(user.roles).toEqual(['general_user']);
    });

    // ── and the healing this exists for still happens ────────────────────────

    it.each([
        ['academy', COLLECTIONS.ACADEMY_APPLICATIONS, 'academy', 'academy_participant'],
        ['wave', COLLECTIONS.WAVE_APPLICATIONS, 'wave', 'wave_participant'],
        ['export', COLLECTIONS.EXPORT_APPLICATIONS, 'export', 'export_participant'],
    ])('still heals a genuinely approved member — %s', async (app, collection, regKey, role) => {
        store.seed(USERS, MEMBER, { email: 'member@e.com', roles: ['general_user'] });
        seedApp(collection, 'approved-1', 'approved', '2026-01-01T00:00:00.000Z');

        const granted = await (await access()).checkModuleAccess(MEMBER, ['general_user'], app as never);

        expect(granted).toBe(true);
        const user = store.get(USERS, MEMBER)!;
        expect(user.roles).toContain(role);
        expect(user.serviceRegistrations[regKey].status).toBe('approved');
    });

    it.each([
        ['academy', COLLECTIONS.ACADEMY_APPLICATIONS],
        ['wave', COLLECTIONS.WAVE_APPLICATIONS],
        ['export', COLLECTIONS.EXPORT_APPLICATIONS],
    ])('AND A NEW APPROVAL DOES OVERRIDE AN OLD REJECTION — %s', async (app, collection) => {
        // The rule is "latest wins", not "rejection wins". A member refused
        // once and approved on appeal must get in.
        store.seed(USERS, MEMBER, { email: 'member@e.com', roles: ['general_user'] });
        seedApp(collection, 'a-old-rejected', 'rejected', '2026-01-01T00:00:00.000Z');
        seedApp(collection, 'b-new-approved', 'approved', '2026-06-01T00:00:00.000Z');

        expect(await (await access()).checkModuleAccess(MEMBER, ['general_user'], app as never))
            .toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#227 — the choice is deterministic', () => {
    it('THE SAME REQUEST TWICE GIVES THE SAME ANSWER', async () => {
        seedRejectedMember('academy');
        // Seeded newest-first, so insertion order and recency disagree — which
        // is what an unordered `.limit(1)` would resolve arbitrarily.
        seedApp(COLLECTIONS.ACADEMY_APPLICATIONS, 'b-new-rejected', 'rejected', '2026-06-01T00:00:00.000Z');
        seedApp(COLLECTIONS.ACADEMY_APPLICATIONS, 'a-old-approved', 'approved', '2026-01-01T00:00:00.000Z');

        const { checkModuleAccess } = await access();
        const answers = [];
        for (let i = 0; i < 5; i++) {
            answers.push(await checkModuleAccess(MEMBER, ['general_user'], 'academy' as never));
        }

        expect(new Set(answers).size).toBe(1);
        expect(answers[0]).toBe(false);
    });

    it('reads more than one application before deciding', async () => {
        const src = require('fs').readFileSync(
            require('path').join(process.cwd(), 'src/lib/module-access-check.ts'), 'utf8');
        const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

        // Was `.limit(1)` at sixteen sites, each trusting whatever came back.
        expect(code).not.toContain('.limit(1)');
        expect(code).toContain('APPLICATION_SCAN_LIMIT');
    });

    it('sorts on submittedAt, falling back to createdAt', async () => {
        // Not every writer sets submittedAt — the WAVE admin list was ordered on
        // it for months and it is written by nothing on that collection (#49's
        // family). The tiebreak has to be a field that exists.
        store.seed(USERS, MEMBER, { email: 'member@e.com', roles: ['general_user'] });
        store.seed(COLLECTIONS.ACADEMY_APPLICATIONS, 'no-submitted', {
            userId: MEMBER, status: 'rejected', createdAt: '2026-06-01T00:00:00.000Z',
        });
        store.seed(COLLECTIONS.ACADEMY_APPLICATIONS, 'older', {
            userId: MEMBER, status: 'approved',
            submittedAt: '2026-01-01T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z',
        });

        expect(await (await access()).checkModuleAccess(MEMBER, ['general_user'], 'academy' as never))
            .toBe(false);
    });

    it('handles a single application exactly as before', async () => {
        store.seed(USERS, MEMBER, { email: 'member@e.com', roles: ['general_user'] });
        seedApp(COLLECTIONS.ACADEMY_APPLICATIONS, 'only', 'approved', '2026-01-01T00:00:00.000Z');

        expect(await (await access()).checkModuleAccess(MEMBER, ['general_user'], 'academy' as never))
            .toBe(true);
    });

    it('refuses a member with no application at all', async () => {
        store.seed(USERS, MEMBER, { email: 'member@e.com', roles: ['general_user'] });

        expect(await (await access()).checkModuleAccess(MEMBER, ['general_user'], 'academy' as never))
            .toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the layers above the fallback are untouched', () => {
    it('Layer 1 still grants on the JWT role alone', async () => {
        store.seed(USERS, MEMBER, { email: 'member@e.com', roles: ['academy_participant'] });

        expect(await (await access()).checkModuleAccess(MEMBER, ['academy_participant'] as never, 'academy' as never))
            .toBe(true);
    });

    it('Layer 2 still grants on an approved registration', async () => {
        store.seed(USERS, MEMBER, {
            email: 'member@e.com', roles: ['general_user'],
            serviceRegistrations: { academy: { status: 'approved' } },
        });

        expect(await (await access()).checkModuleAccess(MEMBER, ['general_user'], 'academy' as never))
            .toBe(true);
    });

    it('refuses a user document that does not exist', async () => {
        expect(await (await access()).checkModuleAccess('ghost', ['general_user'], 'academy' as never))
            .toBe(false);
    });
});
