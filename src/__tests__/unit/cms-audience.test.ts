/**
 * @jest-environment node
 */

/**
 * The audience was whichever one the caller asked to be in.
 *
 * THE DEFECT
 * ----------
 * `targetAudience` is an access control. The admin CMS page offers it as a
 * dropdown — "all", "members", "exporters", "vendors", "admins" — so
 * announcements addressed to staff alone genuinely exist. Membership was
 * decided from the ARGUMENT:
 *
 *     if (a.targetAudience !== "all" && a.targetAudience !== targetAudience)
 *         return false;
 *
 * so `getActiveAnnouncementsAction("admins")` returned every admin-only
 * announcement. And this endpoint takes no session at all —
 * action-auth-baseline.json lists it as deliberately public, which is right for
 * a landing-page notice. The two together mean anyone, signed in or not, could
 * read internal notices by naming the audience they wanted to belong to.
 *
 * Nothing in the UI passes anything but "all", which is exactly why this
 * survived: the defect is only reachable by calling the server action directly,
 * and every export of a "use server" file is a reachable endpoint.
 *
 * THE FIX
 * -------
 * Entitlement is computed from the caller's roles. The parameter is kept as a
 * NARROWING filter, so it can only ever reduce what entitlement already allowed
 * — both existing callers pass "all" or nothing and see what they always saw.
 * Staying public is preserved: "all" is in the entitled set even with no
 * session.
 *
 * TWO SILENT FAILURES ALONGSIDE
 * -----------------------------
 * A banner is displayed by `now >= startDate && now <= endDate`. An unparseable
 * date becomes Invalid Date, every comparison against it is false, and the
 * banner never appears — while the action returns success and the admin page
 * lists it as live. Same for an end date before the start. Both rejected now.
 *
 * The union types on these actions are TypeScript, erased before the request
 * arrives; they constrain the admin page's callsite and nothing else. For
 * targetAudience that matters, because an unrecognised value is now an
 * announcement nobody is entitled to see.
 *
 * A WRITER WHOSE ROWS COULD NEVER BE READ
 * ---------------------------------------
 * admin-communications.ts has its own createAnnouncementAction writing to the
 * same collection, with `message` but no `content` and no targetAudience. The
 * reader maps `content`, and undefined was neither "all" nor the requested
 * audience — so every row it wrote was invisible, before this change and after.
 * It has no callers, which is the only reason nobody noticed. Fixed there rather
 * than worked around here.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

jest.mock('@/lib/audit-log', () => ({
    recordAdminAction: (p: any) => (global as any).mockRecordAdminAction(p),
    createAdminAuditLog: jest.fn(async () => ({})),
    logAdminAction: jest.fn(async () => ({})),
}));

function setSession(id: string | null, roles: string[] = []) {
    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve(
        id === null
            ? { session: null, error: { error: 'Authentication required' } }
            : { session: { user: { id, email: `${id}@e.com`, name: id, roles } }, error: null }
    ));
}

const ROWS = [
    { title: 'Public notice', content: 'c', type: 'info', targetAudience: 'all', priority: 'low', active: true },
    { title: 'Staff only', content: 'c', type: 'warning', targetAudience: 'admins', priority: 'urgent', active: true },
    { title: 'Sellers', content: 'c', type: 'info', targetAudience: 'vendors', priority: 'low', active: true },
    { title: 'Legacy row', content: 'c', type: 'info', targetAudience: undefined, priority: 'low', active: true },
];

function setAnnouncements(rows: any[] = ROWS) {
    (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve({
        exists: true,
        empty: rows.length === 0,
        size: rows.length,
        docs: rows.map((r, i) => ({ id: `a-${i}`, data: () => r })),
        data: () => ({}),
    }));
}

async function announcements(audience?: string) {
    const { getActiveAnnouncementsAction } = await import('@/app/actions/cms');
    return audience === undefined
        ? getActiveAnnouncementsAction()
        : getActiveAnnouncementsAction(audience);
}

const titles = (list: any[]) => list.map((a) => a.title).sort();

describe('you only get the audiences you are actually in', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setAnnouncements();
    });

    it('refuses to hand admin-only notices to a signed-out caller', async () => {
        // THE test. No session, and "admins" asked for by name.
        setSession(null);

        const list = await announcements('admins');

        expect(titles(list)).toEqual(['Public notice']);
    });

    it('refuses to hand them to a signed-in non-admin', async () => {
        setSession('user-1', ['seller']);

        const list = await announcements('admins');

        expect(titles(list)).toEqual(['Public notice']);
    });

    it('serves them to an actual admin', async () => {
        // Vacuity guard. Refusing everyone would delete the feature rather than
        // secure it — targeted announcements have to reach their target.
        setSession('admin-1', ['admin']);

        const list = await announcements('admins');

        expect(titles(list)).toEqual(['Public notice', 'Staff only']);
    });

    it('serves a vendor notice to a seller and not to anyone else', async () => {
        setSession('seller-1', ['seller']);
        expect(titles(await announcements('vendors'))).toEqual(['Public notice', 'Sellers']);

        setSession('user-2', ['general_user']);
        expect(titles(await announcements('vendors'))).toEqual(['Public notice']);
    });

    it('keeps the endpoint public for universal notices', async () => {
        // Being unauthenticated is a recorded decision in the auth baseline and
        // is preserved: a landing-page notice is the point of this endpoint.
        setSession(null);

        expect(titles(await announcements())).toEqual(['Public notice']);
    });

    it('does not widen what the existing callers see', async () => {
        // AnnouncementBanner passes nothing and the admin page passes "all".
        // An admin asking for "all" must still get only universal notices —
        // the parameter narrows, it does not select.
        setSession('admin-1', ['admin']);

        expect(titles(await announcements('all'))).toEqual(['Public notice']);
    });

    it('drops a row whose audience is not recognised', async () => {
        // Fails closed. A row with no targetAudience — which is what
        // admin-communications.ts used to write — is not an audience anyone is
        // in, so it is never served rather than served to everybody.
        setSession('admin-1', ['admin']);

        const list = await announcements('admins');

        expect(titles(list)).not.toContain('Legacy row');
    });

    it('still hides an expired announcement', async () => {
        // Pre-existing behaviour, pinned so the new filter cannot bypass it.
        setAnnouncements([
            { title: 'Expired', content: 'c', targetAudience: 'all', active: true, expiresAt: new Date(Date.now() - 86_400_000) },
            { title: 'Current', content: 'c', targetAudience: 'all', active: true, expiresAt: new Date(Date.now() + 86_400_000) },
        ]);
        setSession('user-1', []);

        expect(titles(await announcements())).toEqual(['Current']);
    });
});

describe('an announcement nobody could ever see is not written', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setAnnouncements([]);
        setSession('admin-1', ['admin']);
    });

    const valid = {
        title: 'T', content: 'C', type: 'info' as const,
        targetAudience: 'all' as const, priority: 'low' as const, adminId: 'admin-1',
    };

    async function create(overrides: Record<string, any> = {}) {
        const { createAnnouncementAction } = await import('@/app/actions/cms');
        return createAnnouncementAction({ ...valid, ...overrides } as any) as any;
    }

    it('refuses an unrecognised audience', async () => {
        // The union type is erased at the server-action boundary, and the read
        // path now decides entitlement from this field.
        const r = await create({ targetAudience: 'everyone' });

        expect(r.success).toBe(false);
        expect((global as any).mockFirestoreAdd).not.toHaveBeenCalled();
    });

    it('refuses an unparseable expiry', async () => {
        const r = await create({ expiresAt: 'next tuesday' });

        expect(r.success).toBe(false);
    });

    it('still creates a valid announcement', async () => {
        // Vacuity guard.
        const r = await create();

        expect(r.success).toBe(true);
        expect((global as any).mockFirestoreAdd).toHaveBeenCalled();
    });

    it('records the acting admin, not the adminId in the request', async () => {
        // Pre-existing and pinned: `adminId` is a vestigial parameter and must
        // stay ignored.
        await create({ adminId: 'someone-else' });

        const written = (global as any).mockFirestoreAdd.mock.calls
            .map((c: any[]) => c[c.length - 1])
            .find((d: any) => d && 'targetAudience' in d);

        expect(written?.createdBy).toBe('admin-1');
    });

    it('refuses a non-admin', async () => {
        setSession('user-1', ['seller']);

        const r = await create();

        expect(r.success).toBe(false);
        expect((global as any).mockFirestoreAdd).not.toHaveBeenCalled();
    });
});

describe('a banner that could never appear is not written', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setAnnouncements([]);
        setSession('admin-1', ['admin']);
    });

    const valid = {
        title: 'T', message: 'M', type: 'promotional' as const,
        startDate: new Date().toISOString(),
        endDate: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        position: 'top' as const, adminId: 'admin-1',
    };

    async function create(overrides: Record<string, any> = {}) {
        const { createBannerAction } = await import('@/app/actions/cms');
        return createBannerAction({ ...valid, ...overrides } as any) as any;
    }

    it('refuses an unparseable start date', async () => {
        // Invalid Date makes `now >= start` false forever, so the banner never
        // shows while the action reports success.
        const r = await create({ startDate: 'soon' });

        expect(r.success).toBe(false);
        expect((global as any).mockFirestoreAdd).not.toHaveBeenCalled();
    });

    it('refuses an end date before the start', async () => {
        const r = await create({
            startDate: new Date(Date.now() + 86_400_000).toISOString(),
            endDate: new Date().toISOString(),
        });

        expect(r.success).toBe(false);
    });

    it('still creates a valid banner', async () => {
        // Vacuity guard.
        const r = await create();

        expect(r.success).toBe(true);
    });

    it('refuses a non-admin', async () => {
        setSession('user-1', ['seller']);

        expect((await create()).success).toBe(false);
    });
});

describe('the other announcement writer produces a readable row', () => {
    it('writes content and an audience the reader recognises', async () => {
        // admin-communications.ts wrote `message` with no `content` and no
        // targetAudience, so the only reader of this collection could never
        // return its rows. Asserted on the source because that action takes a
        // FormData/prevState pair meant for useActionState and has no callers to
        // drive it through.
        const { readFileSync } = await import('fs');
        const { join } = await import('path');
        const src = readFileSync(join(process.cwd(), 'src/app/actions/admin-communications.ts'), 'utf-8');

        const write = src.slice(src.indexOf('COLLECTIONS.ANNOUNCEMENTS'));
        const literal = write.slice(0, write.indexOf('});'));

        expect(literal).toContain('content: message');
        expect(literal).toContain('targetAudience: "all"');
    });
});
