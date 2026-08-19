/**
 * @jest-environment node
 */

/**
 * A migration that rewrites five collections, with no tests and two ways to
 * leave the database half-done.
 *
 * WHAT IT DOES RIGHT, FIRST
 * -------------------------
 * It only fills in fields that are ABSENT — every check is `if (!data.x)` or
 * `typeof data.x === 'undefined'` — so it cannot overwrite a value somebody
 * set. `dryRun` defaults to TRUE, so calling it by accident reports rather than
 * writes. It declines to guess an email, with a comment saying why:
 * "Dangerous to guess". That is a carefully written script.
 *
 * DEFECT 1: UNBOUNDED CONCURRENT WRITES
 * -------------------------------------
 *     if (!dryRun) await Promise.all(userUpdates);
 *
 * over one array covering the whole users collection, read with `.all()` so no
 * row cap applies. The file's own comment assumes "< 10k users ... otherwise
 * paginate"; the production export counted 41,105. That is up to 41,105 HTTP
 * updates fired simultaneously.
 *
 * DEFECT 2: THE RUN ABORTS AND TAKES THE REPORT WITH IT
 * ----------------------------------------------------
 * Promise.all rejects on the FIRST failure. One bad write threw out of the loop
 * into the catch, which returns `{ error: "Action failed", reports: [] }` —
 * discarding every report, including the collections that had already
 * succeeded. A half-applied migration with no record of where it stopped is the
 * worst outcome available to a tool like this. The catch block's own comment
 * says so: "Should probably return partial reports".
 *
 * DEFECT 3: THE COUNT WAS A PREDICTION
 * ------------------------------------
 * `usersReport.updated++` ran when the update was QUEUED, before any write was
 * attempted — and it ran on a dry run too. So `updated` counted documents that
 * needed changing, under a name that says the changes were made.
 *
 * The three are now separate and honestly named: `needingUpdate` is what the
 * scan found, `updated` is what landed, `failed` is what did not. Writes go out
 * in bounded chunks through allSettled, so a failure is counted rather than
 * thrown.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const ADMIN = 'admin-1';
const MEMBER = 'member-1';

// The action records an audit row now. Mocked here rather than left to the
// real module, which reaches for the database this suite does not stand up.
jest.mock('@/lib/audit-log', () => ({
    createAuditLog: jest.fn(async () => ({})),
    createAdminAuditLog: jest.fn(async () => ({})),
    recordAdminAction: jest.fn(async () => undefined),
}));
jest.mock('@/lib/firebase-admin', () => ({
    adminAuth: { listUsers: jest.fn(async () => ({ users: [] })) },
}));

function setSession(id: string, roles: string[]) {
    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id, email: `${id}@e.com`, name: id, roles } },
        error: null,
    }));
}

/**
 * `docs` are returned for the users collection only; every other collection
 * comes back empty so the assertions are about one report.
 *
 * Each doc carries its own `ref.update`, because the action calls
 * `doc.ref.update(...)` rather than going through the harness's docRef.
 */
function setUsers(users: Array<{ id: string; data: Record<string, any>; failWrite?: boolean }>) {
    const writes: Array<{ id: string; patch: any }> = [];
    (global as any).__writes = writes;

    const docs = users.map((u) => ({
        id: u.id,
        data: () => u.data,
        ref: {
            id: u.id,
            update: (patch: any) => {
                if (u.failWrite) return Promise.reject(new Error('write failed'));
                writes.push({ id: u.id, patch });
                return Promise.resolve();
            },
        },
    }));

    (global as any).mockFirestoreGet.mockImplementation((collection: string) =>
        Promise.resolve(
            collection === 'users'
                ? { exists: false, empty: false, size: docs.length, docs, data: () => ({}) }
                : { exists: false, empty: true, size: 0, docs: [], data: () => ({}) }
        )
    );
    (global as any).mockFirestoreTxGet.mockImplementation(() => Promise.resolve({
        exists: false, empty: true, docs: [], data: () => ({}),
    }));
    return writes;
}

async function run(dryRun: boolean) {
    const { runSchemaStandardizationAction } = await import('@/app/actions/schema-standardization');
    return runSchemaStandardizationAction(dryRun);
}

function usersReport(result: any) {
    return (result?.reports ?? []).find((r: any) => r.collection === 'users');
}

describe('runSchemaStandardizationAction — the counts mean what they say', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession(ADMIN, ['admin']);
    });

    it('reports what needs changing on a dry run, and writes nothing', async () => {
        const writes = setUsers([
            { id: 'u1', data: {} },
            { id: 'u2', data: { roles: ['general_user'], isVerified: true, createdAt: 1, updatedAt: 1 } },
        ]);

        const report = usersReport(await run(true));

        expect(report.scanned).toBe(2);
        expect(report.needingUpdate).toBe(1);
        // The heart of it: a dry run cannot have updated anything.
        expect(report.updated).toBe(0);
        expect(writes).toEqual([]);
    });

    it('counts updates that actually landed on a live run', async () => {
        const writes = setUsers([{ id: 'u1', data: {} }]);

        const report = usersReport(await run(false));

        expect(report.needingUpdate).toBe(1);
        expect(report.updated).toBe(1);
        expect(report.failed).toBe(0);
        expect(writes).toHaveLength(1);
    });

    it('counts a failed write as failed, and still finishes the run', async () => {
        // Promise.all rejected on the first failure and threw the whole run
        // into the catch, which returns reports: [].
        setUsers([
            { id: 'u1', data: {}, failWrite: true },
            { id: 'u2', data: {} },
        ]);

        const result: any = await run(false);
        const report = usersReport(result);

        expect(result.success).toBe(true);
        expect(report).toBeDefined();
        expect(report.failed).toBe(1);
        expect(report.updated).toBe(1);
    });

    it('does not lose the report when a write fails', async () => {
        // The specific regression: one bad write used to discard every
        // collection's findings, including those already completed.
        setUsers([{ id: 'u1', data: {}, failWrite: true }]);

        const result: any = await run(false);

        expect(result.reports.length).toBeGreaterThan(1);
    });
});

describe('it fills gaps without overwriting anything', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession(ADMIN, ['admin']);
    });

    it('supplies the documented defaults for a bare user', async () => {
        const writes = setUsers([{ id: 'u1', data: {} }]);

        await run(false);

        expect(writes[0].patch.roles).toEqual(['general_user']);
        expect(writes[0].patch.isVerified).toBe(false);
        expect(writes[0].patch).toHaveProperty('createdAt');
    });

    it('leaves an existing value alone', async () => {
        // The property that makes this safe to run at all: it must never
        // demote an admin or flip a verified user back.
        const writes = setUsers([
            { id: 'u1', data: { roles: ['admin'], isVerified: true, createdAt: 1, updatedAt: 1 } },
        ]);

        await run(false);

        expect(writes).toEqual([]);
    });

    it('replaces roles only when they are not an array at all', async () => {
        // A malformed roles field becomes ["general_user"] — a demotion, but of
        // a record that is already broken. Asserted so the behaviour is a
        // decision on the record rather than a surprise.
        const writes = setUsers([{ id: 'u1', data: { roles: 'admin', isVerified: true, createdAt: 1, updatedAt: 1 } }]);

        await run(false);

        expect(writes[0].patch.roles).toEqual(['general_user']);
    });

    it('does not invent an email', async () => {
        // The script declines to guess, with a comment saying "Dangerous to
        // guess". Worth pinning: a fabricated email would break login and
        // notifications for a real person.
        const writes = setUsers([{ id: 'u1', data: {} }]);

        await run(false);

        expect(writes[0].patch).not.toHaveProperty('email');
    });
});

describe('who may run it', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setUsers([]);
    });

    it('refuses a caller without config:update', async () => {
        setSession(MEMBER, ['seller']);

        const r: any = await run(true);

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/config:update/i);
    });

    it('refuses a moderator, who has no config:update in the matrix', async () => {
        setSession('mod-1', ['moderator']);

        const r: any = await run(true);

        expect(r.success).toBe(false);
    });

    it('allows an admin', async () => {
        setSession(ADMIN, ['admin']);

        const r: any = await run(true);

        expect(r.success).toBe(true);
    });

    it('defaults to a dry run when called with no argument', async () => {
        // The difference between a report and a migration is one omitted
        // parameter.
        setSession(ADMIN, ['admin']);
        const writes = setUsers([{ id: 'u1', data: {} }]);
        const { runSchemaStandardizationAction } = await import('@/app/actions/schema-standardization');

        await runSchemaStandardizationAction();

        expect(writes).toEqual([]);
    });
});
