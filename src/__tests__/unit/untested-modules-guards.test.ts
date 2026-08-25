/**
 * @jest-environment node
 */

/**
 * The five action modules that had no tests at all.
 *
 *   sms-broadcast.ts      799 lines — texts up to ~41,000 people, at real cost
 *   in-app-broadcast.ts   539 lines — notifies every user
 *   messages.ts           556 lines — user-to-user conversations
 *   maintenance.ts        147 lines — repairs data, resets cache, deletes drafts
 *   data-recovery.ts      224 lines — rewrites service registrations
 *
 * WHY THEY HAD NO COVERAGE
 * ------------------------
 * They use `.select()` and query `.all()`, and neither existed in jest.setup.js
 * until the harness audit. Any test reaching those paths threw
 * `x is not a function`, the try/catch swallowed it, and the test saw a generic
 * failure. Nothing tripped over the missing stubs because nothing tested the
 * files — the two gaps hid each other.
 *
 * WHAT THIS LOCKS IN
 * ------------------
 * All five were read by hand and found correct. That verification is worth
 * nothing once it is only in a commit message, so the properties are asserted
 * here:
 *
 *   - every destructive or costly action refuses a non-admin
 *   - a broadcast with no recipients sends nothing rather than reporting success
 *   - conversation reads propagate the service's access check
 *
 * WHAT IS NOT ASSERTED, DELIBERATELY
 * ----------------------------------
 * A recipient cap on sms-broadcast. There is none — an admin can text every
 * user in one call, with no confirmation step and no ceiling. That is a real
 * safety gap, but capping it is a product decision about what an admin may do,
 * not a defect to fix unilaterally. Recorded here rather than silently imposed.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const ADMIN = 'admin-1';
const MEMBER = 'member-1';

const mockSendSms = jest.fn(async () => ({ success: true }));

jest.mock('@/lib/africastalking', () => ({
    sendSms: (...a: any[]) => (mockSendSms as any)(...a),
    smsEscrowReleased: jest.fn(), smsDisputeResolved: jest.fn(),
}));
jest.mock('@/lib/audit-log', () => ({
    recordAdminAction: (p: any) => (global as any).mockRecordAdminAction(p),
    createAdminAuditLog: jest.fn(async () => ({})),
    logAdminAction: jest.fn(async () => ({})),
    logAdminFinancialAction: jest.fn(async () => ({})),
}));
jest.mock('@/app/actions/notifications', () => ({
    createNotificationAction: jest.fn(async () => ({})),
    createBulkNotificationsAction: jest.fn(async () => ({})),
}));
/**
 * requireAdmin MUST be mocked, and this was learned the hard way.
 *
 * The first version of this file did not mock it. Every "refuses a non-admin"
 * assertion passed — but for the wrong reason: the real requireAdmin calls
 * auth() and reads the database, both of which fail under test, so it returned
 * `{ error }` no matter what the test set up. The assertions would have passed
 * with the guard deleted.
 *
 * A sibling test that expected SUCCESS is what exposed it, by failing while
 * everything around it was green — the same shape as the wallet feature toggle.
 */
const mockRequireAdmin = jest.fn() as jest.Mock<any>;
jest.mock('@/lib/require-admin', () => ({
    requireAdmin: (...a: any[]) => mockRequireAdmin(...a),
}));

jest.mock('@/lib/cache-invalidation', () => ({
    invalidateUserCache: jest.fn(async () => ({})),
    invalidateAdminGlobalStats: jest.fn(async () => ({})),
    invalidateAllCaches: jest.fn(async () => ({})),
}));

/**
 * requireAdmin returns `{ userId } | { error }` — an object either way. Callers
 * must test `"error" in authCheck`; `if (!admin)` never fires. Every module
 * here uses the correct form, which was checked before these tests were
 * written and is the reason they can be written at all.
 */
function setAdmin(is: boolean) {
    mockRequireAdmin.mockResolvedValue(is ? { userId: ADMIN } : { error: 'Unauthenticated' });
    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id: is ? ADMIN : MEMBER, email: 'a@e.com', roles: is ? ['admin'] : [] } },
        error: null,
    }));
    (global as any).mockIsAdmin?.mockReturnValue(is);
}

function setDocs(docs: any[] = []) {
    (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve({
        exists: true, empty: docs.length === 0, docs, data: () => ({}),
    }));
}

describe('sms-broadcast — the costliest action in the codebase', () => {
    beforeEach(() => { jest.clearAllMocks(); setDocs(); });

    it('refuses a non-admin before collecting a single recipient', async () => {
        setAdmin(false);
        const { sendSmsBroadcastAction } = await import('@/app/actions/sms-broadcast');

        const r: any = await sendSmsBroadcastAction({} as any, 'hello');

        // Asserts the REASON. `success === false` is also true when no
        // recipient matches, so the weaker assertion passed with the guard
        // deleted — caught by mutation, not by reading.
        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/unauthori[sz]ed|admin/i);
        expect(mockSendSms).not.toHaveBeenCalled();
    });

    it('sends nothing when no recipient matches, and says so', async () => {
        // Reporting success on an empty send would let a mis-filtered broadcast
        // look like it worked.
        setAdmin(true);
        setDocs([]);
        const { sendSmsBroadcastAction } = await import('@/app/actions/sms-broadcast');

        const r: any = await sendSmsBroadcastAction({} as any, 'hello');

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/no recipients/i);
        expect(mockSendSms).not.toHaveBeenCalled();
    });

    it('reads recipients uncapped', async () => {
        // The file's own comment: "a broadcast that reaches the first 5,000 of
        // ~41,000 recipients and reports success is worse than one that takes
        // longer." .all() bypasses the default row cap, and it was unmockable
        // until the harness audit — so this could never have been asserted.
        const { readFileSync } = await import('fs');
        const { join } = await import('path');
        const src = readFileSync(join(process.cwd(), 'src/app/actions/sms-broadcast.ts'), 'utf-8');

        expect(src).toContain('.all()');
    });

    it('previews without sending', async () => {
        setAdmin(true);
        const { previewSmsBroadcastAction } = await import('@/app/actions/sms-broadcast');

        await previewSmsBroadcastAction({} as any).catch(() => undefined);

        expect(mockSendSms).not.toHaveBeenCalled();
    });
});

describe('in-app-broadcast', () => {
    beforeEach(() => { jest.clearAllMocks(); setDocs(); });

    it('refuses a non-admin', async () => {
        setAdmin(false);
        const { sendInAppBroadcastAction } = await import('@/app/actions/in-app-broadcast');

        const r: any = await sendInAppBroadcastAction({} as any, 'title', 'body').catch((e: any) => ({
            success: false, error: String(e?.message ?? e),
        }));

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/unauthori[sz]ed|admin/i);
    });

    it('refuses a non-admin from the recipient collector too', async () => {
        // collectRecipientUserIds is exported separately, so it is its own
        // endpoint and needs its own guard — the sibling problem that has
        // recurred all week.
        setAdmin(false);
        const { collectRecipientUserIds } = await import('@/app/actions/in-app-broadcast');

        await expect(collectRecipientUserIds({} as any)).rejects.toThrow(/unauthori[sz]ed/i);
    });
});

describe('maintenance — four destructive actions, none previously tested', () => {
    beforeEach(() => { jest.clearAllMocks(); setDocs(); });

    const cases: Array<[string, string]> = [
        ['repairDataAction', 'rewrites documents'],
        ['runConsistencyCheckAction', 'reads every collection'],
        ['hardResetCacheAction', 'drops every cache'],
        ['cleanupAbandonedDraftsAction', 'DELETES draft records'],
    ];

    for (const [name, what] of cases) {
        it(`${name} refuses a non-admin (${what})`, async () => {
            setAdmin(false);
            const mod: any = await import('@/app/actions/maintenance');

            const r = await mod[name]().catch((e: any) => ({ success: false, error: String(e) }));

            // The reason, not just the outcome: repairDataAction fails for
            // other causes under test, so `success === false` alone passed with
            // its guard removed.
            expect(r.success).toBe(false);
            expect(String(r.error)).toMatch(/unauthori[sz]ed|admin/i);
        });
    }
});

describe('data-recovery', () => {
    beforeEach(() => { jest.clearAllMocks(); setDocs(); });

    it('refuses a non-admin', async () => {
        // It rewrites serviceRegistrations across every user, which decides
        // module access and payment status.
        setAdmin(false);
        const { runServiceRegistrationRecoveryAction } = await import('@/app/actions/data-recovery');

        // It catches its own throw and returns structured output rather than
        // rejecting — checked rather than assumed, because the first version of
        // this test expected a rejection and was simply wrong about the code.
        const r: any = await runServiceRegistrationRecoveryAction();

        expect(r.success).toBe(false);
        expect(JSON.stringify(r.stats?.errors ?? [])).toMatch(/unauthori[sz]ed/i);
        expect(r.stats?.fixedCount).toBe(0);
    });
});

describe('messages — conversation access', () => {
    it('hands the caller identity to the service on every read and write', async () => {
        // getMessages/sendMessage/markAsRead each call
        // validateConversationAccess(conversation, userId, roles) and throw
        // "Access denied" when it fails — verified by reading
        // infrastructure/messaging/service.ts.
        //
        // The property that must not regress is at THIS layer: the action has
        // to pass session.user.id through. An action that passed a
        // caller-supplied id, or none, would leave the service checking the
        // wrong thing while still looking guarded.
        const { readFileSync } = await import('fs');
        const { join } = await import('path');
        const src = readFileSync(join(process.cwd(), 'src/app/actions/messages.ts'), 'utf-8');

        for (const fn of ['getMessages', 'sendMessage', 'markAsRead']) {
            const call = src.slice(src.indexOf(`messagingService.${fn}(`));
            expect(call.slice(0, 200)).toContain('session.user.id');
        }
    });
});
