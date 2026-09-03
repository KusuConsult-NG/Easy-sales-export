/**
 * @jest-environment node
 */

/**
 * A MODULE ROLE WAS GRANTED OFF SOMEBODY ELSE'S APPROVED APPLICATION.
 *
 * module-access-check.ts has FOUR fallback layers — Academy, WAVE, Export and
 * Farm Nation — that look for an application by EMAIL when none carries the
 * caller's userId. Each was written as:
 *
 *     if (!emailQuery.empty) {
 *         const latestAppByEmail = latestApplication(emailQuery.docs);
 *         appDocData = latestAppByEmail?.data();
 *         appRef = latestAppByEmail?.ref;
 *     }
 *     ...
 *     if (appDocData) {
 *         if (status === "approved" || status === "active") {
 *             if (!appDocData.userId) { updates.userId = userId; }   // ← guards the WRITE only
 *             ...
 *             await db.collection(USERS).doc(userId).set({
 *                 roles: FieldValue.arrayUnion("wave_participant"),
 *                 serviceRegistrations: { wave: { status: "approved", ... } },
 *             }, { merge: true });
 *             return true;
 *
 * The `!appDocData.userId` test guards only the healing write. The document
 * became `appDocData` whether or not it already belonged to somebody, and the
 * block below then grants the module role and PERSISTS
 * serviceRegistrations[module].status = "approved" onto the caller's user
 * document — on a page load.
 *
 * THE RULE EXISTED IN THREE OTHER PLACES.
 * #36 closed this on the WAVE status action; export/_ex_onboarding.ts and
 * farm-nation/_fn_onboarding.ts closed it on theirs, each with
 * `docs.find(d => !d.data()?.userId)` and a warning when every match is owned.
 * All three of those actions funnel into THIS module, and the export copy's own
 * note says the danger is that an approved status is written "to their user
 * record, WHICH MODULE-ACCESS-CHECK READS". The fix reached the readers and not
 * the thing they were describing.
 *
 * EXECUTED, before the change: two accounts sharing an email — a shape lib/auth.ts
 * says exists, "Duplicate and legacy rows exist; broadcast.ts dedupes its
 * recipient list by email for that reason" — and checkModuleAccess granted the
 * SECOND account `wave_participant` and wrote
 * serviceRegistrations.wave = { status: "approved", applicationId: "A1" } to its
 * user document, off an application whose userId was the first account.
 *
 * WHAT IS DELIBERATELY NOT CHANGED
 * --------------------------------
 * The three actions also dropped the fallback to `email` / `profile.email`,
 * on the grounds that only `userEmail` is written from session.user.email at
 * submission. Removing it here fails two existing tests that pin the fallback
 * with a stated reason — "WAVE records the address under two different names
 * depending on which form wrote it" — and locking a legacy applicant out of
 * their own module is a real cost against a risk the ownership filter already
 * bounds: whatever is adopted must be an application nobody owns. The
 * disagreement is named in the module and left to the owner rather than settled
 * by this pass. The tests below cover both fields, so the behaviour is pinned
 * either way.
 *
 * THE FOURTH COPY WAS FOUND BY A TEST, NOT BY READING. Three layers share one
 * shape — a primary query with a fallback query — and a sweep for that shape
 * fixed those three. Layer 2.7 (Academy) issues a SINGLE query and was missed.
 * The structural assertion at the bottom of this file, counting call sites
 * against the definition, is what caught it. That is the whole argument for
 * writing that kind of assertion: the three copies you can see are never
 * reliably all of them.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

jest.mock('@/lib/redis', () => ({
    redis: null,
    getCached: async () => null,
    setCache: async () => undefined,
    deleteCache: async () => undefined,
}));

let store: FakeDbHandle;

const OWNER = 'legacy-owner';
const NEWCOMER = 'newcomer';
const SHARED = 'shared@example.com';

async function access(userId: string, app: string): Promise<boolean> {
    const { checkModuleAccess } = await import('@/lib/module-access-check');
    return checkModuleAccess(userId, [], app as any);
}

function twoAccountsOneEmail() {
    store.seed(COLLECTIONS.USERS, OWNER, { email: SHARED, roles: ['wave_participant'] });
    store.seed(COLLECTIONS.USERS, NEWCOMER, { email: SHARED, roles: ['general_user'], serviceRegistrations: {} });
}

function newcomer() {
    return store.get(COLLECTIONS.USERS, NEWCOMER) ?? {};
}

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
});

describe('an approved application that already belongs to another account', () => {
    it.each([
        ['WAVE', COLLECTIONS.WAVE_APPLICATIONS, 'wave', 'wave_participant'],
        ['Export', COLLECTIONS.EXPORT_APPLICATIONS, 'export', 'export_participant'],
        ['Academy', COLLECTIONS.ACADEMY_APPLICATIONS, 'academy', 'academy_participant'],
    ])('%s: GRANTS NOTHING — this granted the role and persisted it', async (
        _label, collection, app, role,
    ) => {
        twoAccountsOneEmail();
        store.seed(collection, 'A1', {
            userId: OWNER, userEmail: SHARED, status: 'approved',
            submittedAt: '2025-06-01T00:00:00.000Z',
        });

        const granted = await access(NEWCOMER, app);

        expect(granted).toBe(false);
        expect(newcomer().roles).not.toContain(role);
        expect(newcomer().serviceRegistrations?.[app]?.status).not.toBe('approved');
    });

    it('and the owner keeps their own access', async () => {
        // The other direction: the filter must not lock out the person the
        // application actually belongs to. They are found by userId, not email.
        twoAccountsOneEmail();
        store.seed(COLLECTIONS.WAVE_APPLICATIONS, 'A1', {
            userId: OWNER, userEmail: SHARED, status: 'approved',
        });

        expect(await access(OWNER, 'wave')).toBe(true);
    });

    it('and the application is not re-pointed at the wrong account', async () => {
        // The healing write must not fire either: it would hand the record over.
        twoAccountsOneEmail();
        store.seed(COLLECTIONS.WAVE_APPLICATIONS, 'A1', {
            userId: OWNER, userEmail: SHARED, status: 'approved',
        });

        await access(NEWCOMER, 'wave');

        expect(store.get(COLLECTIONS.WAVE_APPLICATIONS, 'A1')?.userId).toBe(OWNER);
    });

    it('and the newest owned application does not win over an older unowned one', async () => {
        // The filter runs BEFORE latestApplication chooses. Picking the newest
        // first and then testing ownership would have adopted nothing here —
        // and this is the case that distinguishes the two orderings.
        twoAccountsOneEmail();
        store.seed(COLLECTIONS.WAVE_APPLICATIONS, 'OLD-UNOWNED', {
            userEmail: SHARED, status: 'approved', submittedAt: '2024-01-01T00:00:00.000Z',
        });
        store.seed(COLLECTIONS.WAVE_APPLICATIONS, 'NEW-OWNED', {
            userId: OWNER, userEmail: SHARED, status: 'approved',
            submittedAt: '2026-01-01T00:00:00.000Z',
        });

        expect(await access(NEWCOMER, 'wave')).toBe(true);
        expect(store.get(COLLECTIONS.WAVE_APPLICATIONS, 'OLD-UNOWNED')?.userId).toBe(NEWCOMER);
        expect(store.get(COLLECTIONS.WAVE_APPLICATIONS, 'NEW-OWNED')?.userId).toBe(OWNER);
    });
});

describe('an unclaimed application is still claimable', () => {
    it.each([
        ['WAVE by userEmail', COLLECTIONS.WAVE_APPLICATIONS, 'wave', { userEmail: SHARED }],
        ['WAVE by email', COLLECTIONS.WAVE_APPLICATIONS, 'wave', { email: SHARED }],
        ['Export by userEmail', COLLECTIONS.EXPORT_APPLICATIONS, 'export', { userEmail: SHARED }],
        ['Export by profile.email', COLLECTIONS.EXPORT_APPLICATIONS, 'export',
            { profile: { email: SHARED } }],
        ['Farm Nation by userEmail', COLLECTIONS.FARM_NATION_APPLICATIONS, 'farm-nation',
            { userEmail: SHARED }],
        ['Academy by personalInfo.email', COLLECTIONS.ACADEMY_APPLICATIONS, 'academy',
            { personalInfo: { email: SHARED } }],
    ])('%s', async (_label, collection, app, addressing) => {
        // The legitimate case this fallback exists for: a legacy application
        // nobody owns, matched to the account that signed in with that address.
        store.seed(COLLECTIONS.USERS, NEWCOMER, { email: SHARED, roles: [] });
        store.seed(collection, 'A1', { status: 'approved', role: 'buyer', ...addressing });

        expect(await access(NEWCOMER, app)).toBe(true);
        expect(store.get(collection, 'A1')?.userId).toBe(NEWCOMER);
    });
});

describe('the rule is one function, not four copies', () => {
    it('every email fallback goes through it', () => {
        const code = require('fs')
            .readFileSync(require('path').join(process.cwd(), 'src/lib/module-access-check.ts'), 'utf-8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/^\s*\/\/.*$/gm, '');

        // FOUR call sites plus the definition. Three were found by reading the
        // file; the fourth — Layer 2.7, Academy — was found by THIS assertion,
        // because it issues a single query rather than a primary-with-fallback
        // pair and so did not match the shape the first sweep looked for.
        expect(code.match(/unclaimedApplicationForEmail\(/g)?.length).toBe(5);

        // And the shape that was the defect is gone.
        expect(code).not.toContain('const latestAppByEmail = latestApplication(emailQuery.docs)');
    });
});
