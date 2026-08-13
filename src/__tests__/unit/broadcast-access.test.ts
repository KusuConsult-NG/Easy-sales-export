/**
 * @jest-environment node
 */

/**
 * An environment variable that turned off the guard, and a log of every
 * message the platform has sent, readable by anyone.
 *
 * THE SWITCH
 * ----------
 * getCleanBroadcastListAction wrapped its admin check in
 *
 *     if (process.env.ADMIN_OVERRIDE !== "true") { ...check... }
 *     else { logger.info("[Broadcast] Generating clean list in TEST MODE") }
 *
 * so setting one variable made the endpoint public. What it returns is the
 * platform's entire deduplicated mailing list — around 37,000 real email
 * addresses, per the function's own header — and previewBroadcastAction and
 * collectRecipients both route through it, so the same switch opened those too.
 *
 * ADMIN_OVERRIDE appeared EXACTLY ONCE in the whole repository: in that
 * condition. Nothing sets it, no script exports it, no test uses it, and it is
 * documented nowhere. It bought nothing and cost the guard on the user list.
 *
 * Not live, and that is the whole point of removing it rather than narrowing it:
 * it is the sort of flag that stays harmless until somebody copies a .env into a
 * deploy config, and then is not.
 *
 * THE ONE THAT WAS ALREADY OPEN
 * -----------------------------
 * getBroadcastHistoryAction had no session check at all. It returns the SUBJECT
 * AND BODY of every email, SMS and in-app broadcast the platform has sent, and
 * who sent each one.
 *
 * It sat in action-auth-baseline.json, whose triage note says what remains there
 * is "public listings, pre-auth flows, and callbacks whose credential is the
 * reference itself". This is none of those. It most likely survived triage
 * because "broadcast" reads as outbound and public — the messages are, the log
 * of them is not.
 *
 * That is the argument the baseline file makes about itself, and it is right:
 * "Do not read presence in this list as a judgement that the action is safe."
 * This one was found by auditing the FILE, not the list.
 *
 * Every caller of both functions is already an admin surface —
 * /admin/communications/history, /admin/communications/broadcast, and the two
 * /api/admin/broadcast routes — so nothing legitimate changes.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const ADMIN = 'admin-1';
const USER = 'user-1';

const mockCleanList = jest.fn(async () => ({
    success: true as const,
    error: null,
    data: { count: 2, originalDocCount: 3, recipients: [{ email: 'a@e.com' }, { email: 'b@e.com' }], moduleStats: {} },
})) as jest.Mock<any>;

jest.mock('@/lib/broadcast-logic', () => ({
    getCleanBroadcastList: (...a: any[]) => mockCleanList(...a),
}));

function setSession(id: string | null, roles: string[] = []) {
    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve(
        id === null
            ? { session: null, error: { error: 'Authentication required' } }
            : { session: { user: { id, email: `${id}@e.com`, name: id, roles } }, error: null }
    ));
}

function setLogs(rows: any[] = []) {
    (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve({
        exists: true,
        empty: rows.length === 0,
        size: rows.length,
        docs: rows.map((r, i) => ({ id: `log-${i}`, data: () => r })),
        data: () => ({}),
    }));
}

const LOG_ROW = {
    subject: 'Internal: pricing change Monday',
    body: 'Team, we are raising the export levy on Monday.',
    audience: 'all',
    totalRecipients: 36_924,
    sentBy: ADMIN,
};

describe('the mailing list needs an admin, whatever the environment says', () => {
    const realOverride = process.env.ADMIN_OVERRIDE;

    beforeEach(() => {
        jest.clearAllMocks();
        setLogs([]);
    });

    afterEach(() => {
        if (realOverride === undefined) delete process.env.ADMIN_OVERRIDE;
        else process.env.ADMIN_OVERRIDE = realOverride;
    });

    async function cleanList() {
        const { getCleanBroadcastListAction } = await import('@/app/actions/broadcast');
        return getCleanBroadcastListAction() as any;
    }

    it('refuses an unauthenticated caller even with ADMIN_OVERRIDE set', async () => {
        // THE test. This is what one environment variable used to switch off.
        process.env.ADMIN_OVERRIDE = 'true';
        setSession(null);

        const r = await cleanList();

        expect(r.success).toBe(false);
        expect(mockCleanList).not.toHaveBeenCalled();
    });

    it('refuses a signed-in non-admin even with ADMIN_OVERRIDE set', async () => {
        process.env.ADMIN_OVERRIDE = 'true';
        setSession(USER, ['seller']);

        const r = await cleanList();

        expect(r.success).toBe(false);
        expect(mockCleanList).not.toHaveBeenCalled();
    });

    it('serves an admin', async () => {
        // Vacuity guard: refusing everyone would break the broadcast tool.
        setSession(ADMIN, ['admin']);

        const r = await cleanList();

        expect(r.success).toBe(true);
        expect(mockCleanList).toHaveBeenCalled();
    });

    it('reads no override variable at all', async () => {
        // Asserted on the source because the behavioural tests above would also
        // pass against a narrower override — one keyed to NODE_ENV, say, which
        // is the obvious "fix" and is the same defect with a better disguise.
        const { readFileSync } = await import('fs');
        const { join } = await import('path');
        const code = readFileSync(join(process.cwd(), 'src/app/actions/broadcast.ts'), 'utf-8')
            .split('\n')
            .filter((l) => {
                const t = l.trim();
                return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
            })
            .join('\n');

        expect(code).not.toContain('ADMIN_OVERRIDE');
        expect(code).not.toMatch(/process\.env\.\w+\s*[!=]==?\s*["']true["']/);
    });

    it('the flag exists nowhere in the repository', async () => {
        const { execSync } = await import('child_process');
        const hits = execSync('grep -rn "ADMIN_OVERRIDE" src || true', { encoding: 'utf-8', cwd: process.cwd() })
            .split('\n')
            .filter((l) => l.trim() && !l.includes('__tests__'))
            .filter((l) => {
                const body = l.slice(l.indexOf(':', l.indexOf(':') + 1) + 1).trim();
                return !body.startsWith('//') && !body.startsWith('*');
            });

        expect(hits).toEqual([]);
    });
});

describe('the broadcast history is not public', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setLogs([LOG_ROW]);
    });

    async function history() {
        const { getBroadcastHistoryAction } = await import('@/app/actions/broadcast');
        return getBroadcastHistoryAction() as any;
    }

    it('refuses an unauthenticated caller', async () => {
        // THE test. It returns the subject and body of every message sent.
        setSession(null);

        const r = await history();

        expect(r.success).toBe(false);
        expect(JSON.stringify(r)).not.toContain('pricing change');
    });

    it('refuses a signed-in non-admin', async () => {
        setSession(USER, ['seller']);

        const r = await history();

        expect(r.success).toBe(false);
        expect(JSON.stringify(r)).not.toContain('raising the export levy');
    });

    it('serves an admin the history', async () => {
        // Vacuity guard. /admin/communications/history is the real caller.
        setSession(ADMIN, ['admin']);

        const r = await history();

        expect(r.success).toBe(true);
        expect(JSON.stringify(r.data)).toContain('pricing change');
    });

    it('is off the unguarded baseline', async () => {
        // The ratchet demands removal once an entry reaches a guard, and this
        // one genuinely refuses rather than merely reading the session.
        const baseline = await import('./action-auth-baseline.json');

        expect((baseline as any).unguarded ?? (baseline as any).default?.unguarded)
            .not.toContain('app/actions/broadcast.ts::getBroadcastHistoryAction');
    });
});

describe('the paths that route through the list', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setLogs([]);
    });

    it('the preview refuses a non-admin', async () => {
        // previewBroadcastAction and collectRecipients both delegate to
        // getCleanBroadcastListAction, so the override opened them too. Pinned
        // so a future refactor cannot give either its own weaker path.
        setSession(USER, ['seller']);

        const { previewBroadcastAction } = await import('@/app/actions/broadcast');
        const r: any = await previewBroadcastAction({} as any);

        expect(r.success).toBe(false);
    });

    it('collectRecipients yields nothing to a non-admin', async () => {
        setSession(USER, ['seller']);

        const { collectRecipients } = await import('@/app/actions/broadcast');

        expect(await collectRecipients()).toEqual([]);
    });

    it('both work for an admin', async () => {
        // Vacuity guard for the two above.
        setSession(ADMIN, ['admin']);

        const { previewBroadcastAction, collectRecipients } = await import('@/app/actions/broadcast');

        expect((await previewBroadcastAction({} as any) as any).success).toBe(true);
        expect((await collectRecipients()).length).toBe(2);
    });
});
