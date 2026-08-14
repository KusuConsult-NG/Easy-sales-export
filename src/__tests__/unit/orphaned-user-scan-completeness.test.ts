/**
 * @jest-environment node
 */

/**
 * The orphaned-user scan looked at the first 1,000 Auth accounts and reported
 * the answer as if it had looked at all of them.
 *
 * THE BUG
 * -------
 *     // Get all Auth users
 *     const listUsersResult = await adminAuth.listUsers(1000); // Max 1000 users
 *
 * 1000 is `listUsers`' per-call ceiling, not the size of the user base. The
 * method returns a `pageToken` for the next page, and this never read it — so
 * the comment described the intent and the code did something else. Against the
 * 41,105 accounts in the production export, the scan covered about 2.4%.
 *
 * Nothing said so at any layer. detectOrphanedUsers returned a plain array, the
 * route returned `{ count: orphanedUsers.length }`, and /admin/orphaned-users
 * rendered "No orphaned users detected" — a sentence about the whole platform,
 * produced by looking at a fortieth of it. repairAllOrphanedUsers, whose
 * docstring said "Repair ALL orphaned users in batch", repaired what that one
 * page held and reported a `total` that agreed with itself.
 *
 * THE SHAPE, AGAIN
 * ----------------
 * #190 fixed this on four admin queues and fb7e93e6 on the database sweeps: a
 * bounded read presented as a complete one. The rule those settled on is the
 * adapter's own — "reported, never silent". So the scan paginates, stops at a
 * page budget it can finish inside a request, and says which of the two ended
 * it: `scanned`, `complete`, `nextPageToken`.
 *
 * WHY A BUDGET AT ALL
 * -------------------
 * 41,105 accounts is 42 pages, each followed by 20 profile lookups, which is
 * not a request. MAX_AUTH_PAGES caps one call at 10,000 accounts. The bound is
 * not the fix — reporting it is. An admin who sees "partial" knows to continue;
 * an admin who saw "0" did not know there was anything to continue.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const listUsers = jest.fn<any>();
const getAll = jest.fn<any>();

jest.mock('@/lib/firebase-admin', () => ({
    adminAuth: { listUsers: (...args: any[]) => listUsers(...args) },
}));

jest.mock('@/lib/supabase-db', () => ({
    supabaseDb: {
        collection: () => ({ doc: (id: string) => ({ id }) }),
        getAll: (...refs: any[]) => getAll(...refs),
    },
}));

jest.mock('@/lib/firestore-compat', () => ({
    FieldValue: { serverTimestamp: () => 'ts' },
}));

/** An Auth account record, as listUsers returns it. */
function authUser(uid: string) {
    return { uid, email: `${uid}@example.com`, displayName: uid, metadata: { creationTime: 'then' } };
}

/** A page of `size` accounts, numbered from `from`. */
function page(from: number, size: number, pageToken?: string) {
    return {
        users: Array.from({ length: size }, (_, i) => authUser(`u${from + i}`)),
        pageToken,
    };
}

/** Every profile exists, so nothing is reported orphaned — the scan still ran. */
function allProfilesExist() {
    getAll.mockImplementation(async (...refs: any[]) => refs.map(() => ({ exists: true })));
}

beforeEach(() => {
    jest.resetModules();
    listUsers.mockReset();
    getAll.mockReset();
    allProfilesExist();
});

describe('the scan walks past the first page', () => {
    it('follows the pageToken until Auth runs out', async () => {
        // THE test. Three pages; the old code read the first and stopped.
        listUsers
            .mockResolvedValueOnce(page(0, 1000, 'tok-2'))
            .mockResolvedValueOnce(page(1000, 1000, 'tok-3'))
            .mockResolvedValueOnce(page(2000, 500, undefined));
        const { detectOrphanedUsers } = await import('@/lib/orphaned-user-repair');

        const scan = await detectOrphanedUsers();

        expect(listUsers).toHaveBeenCalledTimes(3);
        expect(scan.scanned).toBe(2500);
    });

    it('passes the token it was given to the next call', async () => {
        listUsers.mockResolvedValueOnce(page(0, 10, undefined));
        const { detectOrphanedUsers } = await import('@/lib/orphaned-user-repair');

        await detectOrphanedUsers();

        expect(listUsers).toHaveBeenCalledWith(1000, undefined);
        expect(listUsers).toHaveBeenLastCalledWith(1000, undefined);
    });

    it('asks for 1000 at a time, which is the API ceiling', async () => {
        listUsers.mockResolvedValueOnce(page(0, 5, 'tok-2')).mockResolvedValueOnce(page(5, 5, undefined));
        const { detectOrphanedUsers } = await import('@/lib/orphaned-user-repair');

        await detectOrphanedUsers();

        expect(listUsers.mock.calls[0][0]).toBe(1000);
        expect(listUsers.mock.calls[1]).toEqual([1000, 'tok-2']);
    });
});

describe('a partial scan says it is partial', () => {
    it('complete is true when Auth ran out first', async () => {
        listUsers.mockResolvedValueOnce(page(0, 42, undefined));
        const { detectOrphanedUsers } = await import('@/lib/orphaned-user-repair');

        const scan = await detectOrphanedUsers();

        expect(scan.complete).toBe(true);
        expect(scan.nextPageToken).toBeNull();
    });

    it('complete is false when the budget ran out first', async () => {
        // Always another page: the budget, not Auth, ends the loop.
        listUsers.mockImplementation(async () => page(0, 1000, 'always-more'));
        const { detectOrphanedUsers } = await import('@/lib/orphaned-user-repair');

        const scan = await detectOrphanedUsers();

        expect(scan.complete).toBe(false);
        expect(scan.nextPageToken).toBe('always-more');
    });

    it('the budget is bounded, so the call still returns', async () => {
        // Vacuity guard the other way: an unbounded loop over a live Auth
        // project is not a request, it is an outage.
        listUsers.mockImplementation(async () => page(0, 1000, 'always-more'));
        const { detectOrphanedUsers } = await import('@/lib/orphaned-user-repair');

        const scan = await detectOrphanedUsers();

        expect(listUsers).toHaveBeenCalledTimes(10);
        expect(scan.scanned).toBe(10_000);
    });

    it('a caller can continue where the last call stopped', async () => {
        listUsers.mockResolvedValueOnce(page(9000, 200, undefined));
        const { detectOrphanedUsers } = await import('@/lib/orphaned-user-repair');

        const scan = await detectOrphanedUsers('resume-here');

        expect(listUsers).toHaveBeenCalledWith(1000, 'resume-here');
        expect(scan.complete).toBe(true);
    });
});

describe('it still finds orphans', () => {
    it('a missing profile on any page is reported', async () => {
        // Vacuity guard: every assertion above passes against a scan that finds
        // nothing. u1 is on the SECOND page — the one the old code never read.
        listUsers
            .mockResolvedValueOnce(page(0, 1, 'tok-2'))
            .mockResolvedValueOnce({ users: [authUser('u1')], pageToken: undefined });
        getAll.mockImplementation(async (...refs: any[]) =>
            refs.map((r: any) => ({ exists: r.id !== 'u1' }))
        );
        const { detectOrphanedUsers } = await import('@/lib/orphaned-user-repair');

        const scan = await detectOrphanedUsers();

        expect(scan.orphaned.map((o: any) => o.uid)).toEqual(['u1']);
        expect(scan.scanned).toBe(2);
    });

    it('and carries what the repair screen shows', async () => {
        listUsers.mockResolvedValueOnce({
            users: [{ uid: 'u9', email: 'a@b.co', displayName: 'Ada', metadata: { creationTime: 'when' } }],
            pageToken: undefined,
        });
        getAll.mockImplementation(async (...refs: any[]) => refs.map(() => ({ exists: false })));
        const { detectOrphanedUsers } = await import('@/lib/orphaned-user-repair');

        const scan = await detectOrphanedUsers();

        expect(scan.orphaned[0]).toEqual({
            uid: 'u9',
            email: 'a@b.co',
            displayName: 'Ada',
            createdAt: 'when',
        });
    });
});

describe('"repair all" reports how much of Auth it saw', () => {
    it('carries the scan bound through to its result', async () => {
        // It was named ALL and repaired one page's worth. The name is no longer
        // the only thing describing the scope.
        listUsers.mockImplementation(async () => page(0, 1000, 'always-more'));
        const { repairAllOrphanedUsers } = await import('@/lib/orphaned-user-repair');

        const result = await repairAllOrphanedUsers();

        expect(result.complete).toBe(false);
        expect(result.scanned).toBe(10_000);
        expect(result.nextPageToken).toBe('always-more');
    });

    it('and reports complete when it really was', async () => {
        listUsers.mockResolvedValueOnce(page(0, 3, undefined));
        const { repairAllOrphanedUsers } = await import('@/lib/orphaned-user-repair');

        const result = await repairAllOrphanedUsers();

        expect(result.complete).toBe(true);
        expect(result.total).toBe(0);
    });
});

describe('the screen no longer speaks for the whole platform', () => {
    it('the empty state is qualified by what was scanned', () => {
        const { readFileSync } = require('fs');
        const { join } = require('path');
        const page = readFileSync(
            join(process.cwd(), 'src/app/admin/orphaned-users/page.tsx'),
            'utf-8'
        );

        // "No orphaned users detected" is only correct for a complete scan.
        expect(page).toContain('None among the');
        expect(page).toContain('This is a partial scan');
        expect(page).toContain('scan.complete');
    });

    it('and Repair All says when it covered only part', () => {
        const { readFileSync } = require('fs');
        const { join } = require('path');
        const page = readFileSync(
            join(process.cwd(), 'src/app/admin/orphaned-users/page.tsx'),
            'utf-8'
        );

        expect(page).toContain('results.complete === false');
    });
});
